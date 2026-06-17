const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const {
  loadDb,
  clientToResponse,
  accountToResponse,
  createClient,
  updateClient,
  listClients,
  getClientById,
  archiveClient,
  deleteClient,
  createAccount,
  closeAccount,
  deleteAccount,
  deposit,
  withdraw,
  transfer,
  listAccounts,
  listTransactions,
  getSummary,
  getAccountById,
  getReceiptByTransactionId,
  NotFoundError,
  ValidationError,
  InsufficientFundsError
} = require("./store");

const PORT = Number(process.env.PORT || 8080);
const HOST = String(process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1"));
const OPENAPI_FILE = path.join(process.cwd(), "openapi.json");
const PUBLIC_DIR = path.join(process.cwd(), "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' unpkg.com; style-src 'self' 'unsafe-inline' unpkg.com; img-src 'self' data: *;");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function sendStatic(res, requestPathname) {
  const relativePath = requestPathname === "/app" || requestPathname === "/app/" ? "index.html" : requestPathname.replace(/^\/app\//u, "");
  const resolvedPath = path.resolve(PUBLIC_DIR, relativePath);
  if (!resolvedPath.startsWith(PUBLIC_DIR + path.sep) && resolvedPath !== path.join(PUBLIC_DIR, "index.html")) {
    return sendJson(res, 404, { error: "NOT_FOUND", message: "Fichier introuvable" });
  }

  try {
    const content = await fs.readFile(resolvedPath);
    const contentType = MIME_TYPES[path.extname(resolvedPath).toLowerCase()] || "application/octet-stream";
    setSecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": "no-store"
    });
    res.end(content);
  } catch (err) {
    if (err && err.code === "ENOENT") return sendJson(res, 404, { error: "NOT_FOUND", message: "Fichier introuvable" });
    throw err;
  }
}

async function readJsonBody(req, { maxBytes = 1_000_000 } = {}) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new ValidationError("Content-Type doit être application/json");
  }

  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new ValidationError("Body trop grand");
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) throw new ValidationError("Body JSON vide");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("JSON invalide");
  }
}

function normalizePathname(pathname) {
  if (!pathname) return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function errorToHttp(err) {
  if (err instanceof ValidationError) {
    return { status: 400, body: { error: err.code, message: err.message, details: err.details } };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: err.code, message: err.message } };
  }
  if (err instanceof InsufficientFundsError) {
    return { status: 409, body: { error: err.code, message: err.message } };
  }
  return { status: 500, body: { error: "INTERNAL_ERROR", message: "Erreur interne du serveur" } };
}

function swaggerHtml() {
  const swaggerUiVersion = "5.17.14";
  const cssUrl = `https://unpkg.com/swagger-ui-dist@${swaggerUiVersion}/swagger-ui.css`;
  const bundleUrl = `https://unpkg.com/swagger-ui-dist@${swaggerUiVersion}/swagger-ui-bundle.js`;
  const presetUrl = `https://unpkg.com/swagger-ui-dist@${swaggerUiVersion}/swagger-ui-standalone-preset.js`;

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Swagger UI — Gestion Banque</title>
    <link rel="stylesheet" href="${cssUrl}" />
    <style>body{margin:0;background:#fafafa}</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${bundleUrl}" crossorigin></script>
    <script src="${presetUrl}" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout"
      });
    </script>
  </body>
</html>`;
}

function matchPath(pattern, pathname) {
  const match = pattern.exec(pathname);
  return match ? match.groups || {} : null;
}

async function main() {
  await loadDb();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathname = normalizePathname(url.pathname);
    const method = String(req.method || "GET").toUpperCase();

    try {
      if (method === "GET" && pathname === "/") return redirect(res, "/app/");
      if (method === "GET" && pathname === "/healthz") return sendText(res, 200, "ok");

      if (method === "GET" && (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/app/"))) {
        return sendStatic(res, pathname);
      }

      if (method === "GET" && pathname === "/openapi.json") {
        const content = await fs.readFile(OPENAPI_FILE, "utf8");
        return sendText(res, 200, content, "application/json; charset=utf-8");
      }

      if (method === "GET" && (pathname === "/swagger-ui" || pathname === "/swagger-ui/")) {
        return redirect(res, "/swagger-ui/index.html");
      }
      if (method === "GET" && pathname === "/swagger-ui/index.html") {
        return sendText(res, 200, swaggerHtml(), "text/html; charset=utf-8");
      }

      // API routes
      if (pathname === "/api/clients" && method === "GET") {
        const clients = await listClients({
          q: url.searchParams.get("q"),
          includeArchived: url.searchParams.get("includeArchived") === "true"
        });
        return sendJson(res, 200, clients);
      }

      if (pathname === "/api/clients" && method === "POST") {
        const body = await readJsonBody(req);
        const client = await createClient(body);
        return sendJson(res, 201, client);
      }

      if (pathname === "/api/accounts" && method === "POST") {
        const body = await readJsonBody(req);
        const account = await createAccount(body);
        return sendJson(res, 201, account);
      }

      const clientById = matchPath(/^\/api\/clients\/(?<id>[^/]+)$/u, pathname);
      if (clientById && method === "GET") {
        return sendJson(res, 200, clientToResponse(getClientById(clientById.id)));
      }

      if (clientById && method === "PUT") {
        const body = await readJsonBody(req);
        const client = await updateClient(clientById.id, body);
        return sendJson(res, 200, client);
      }

      if (clientById && method === "DELETE") {
        await deleteClient(clientById.id);
        res.writeHead(204);
        return res.end();
      }

      const archiveClientRoute = matchPath(/^\/api\/clients\/(?<id>[^/]+)\/archive$/u, pathname);
      if (archiveClientRoute && method === "POST") {
        const client = await archiveClient(archiveClientRoute.id);
        return sendJson(res, 200, client);
      }

      const clientAccountsRoute = matchPath(/^\/api\/clients\/(?<id>[^/]+)\/accounts$/u, pathname);
      if (clientAccountsRoute && method === "GET") {
        const accounts = await listAccounts({
          clientId: clientAccountsRoute.id,
          includeClosed: url.searchParams.get("includeClosed") === "true"
        });
        return sendJson(res, 200, accounts);
      }

      if (pathname === "/api/accounts" && method === "GET") {
        const accounts = await listAccounts({
          clientId: url.searchParams.get("clientId"),
          includeClosed: url.searchParams.get("includeClosed") === "true"
        });
        return sendJson(res, 200, accounts);
      }

      if (pathname === "/api/summary" && method === "GET") {
        const summary = await getSummary();
        return sendJson(res, 200, summary);
      }

      if (pathname === "/api/transactions" && method === "GET") {
        const transactions = await listTransactions({ limit: url.searchParams.get("limit") });
        return sendJson(res, 200, transactions);
      }

      const accountById = matchPath(/^\/api\/accounts\/(?<id>[^/]+)$/u, pathname);
      if (accountById && method === "GET") {
        const account = getAccountById(accountById.id);
        return sendJson(res, 200, accountToResponse(account));
      }

      if (accountById && method === "DELETE") {
        await deleteAccount(accountById.id);
        res.writeHead(204);
        return res.end();
      }

      const closeAccountRoute = matchPath(/^\/api\/accounts\/(?<id>[^/]+)\/close$/u, pathname);
      if (closeAccountRoute && method === "POST") {
        const account = await closeAccount(closeAccountRoute.id);
        return sendJson(res, 200, account);
      }

      const accountTransactionsRoute = matchPath(/^\/api\/accounts\/(?<id>[^/]+)\/transactions$/u, pathname);
      if (accountTransactionsRoute && method === "GET") {
        const transactions = await listTransactions({ accountId: accountTransactionsRoute.id, limit: url.searchParams.get("limit") });
        return sendJson(res, 200, transactions);
      }

      const depositRoute = matchPath(/^\/api\/accounts\/(?<id>[^/]+)\/deposit$/u, pathname);
      if (depositRoute && method === "POST") {
        const body = await readJsonBody(req);
        const result = await deposit(depositRoute.id, body.amount, body.description);
        return sendJson(res, 200, result);
      }

      const withdrawRoute = matchPath(/^\/api\/accounts\/(?<id>[^/]+)\/withdraw$/u, pathname);
      if (withdrawRoute && method === "POST") {
        const body = await readJsonBody(req);
        const result = await withdraw(withdrawRoute.id, body.amount, body.description);
        return sendJson(res, 200, result);
      }

      if (pathname === "/api/transfers" && method === "POST") {
        const body = await readJsonBody(req);
        const result = await transfer(body);
        return sendJson(res, 201, result);
      }

      const receiptRoute = matchPath(/^\/api\/receipts\/(?<id>[^/]+)$/u, pathname);
      if (receiptRoute && method === "GET") {
        const receipt = getReceiptByTransactionId(receiptRoute.id);
        return sendJson(res, 200, receipt);
      }

      return sendJson(res, 404, { error: "NOT_FOUND", message: "Route introuvable" });
    } catch (err) {
      const mapped = errorToHttp(err);
      return sendJson(res, mapped.status, mapped.body);
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`API démarrée (listen ${HOST}:${PORT})`);
    console.log("Application : /app/");
    console.log("Swagger UI : /swagger-ui/index.html");
  });
}

main().catch((err) => {
  console.error("Impossible de démarrer le serveur:", err);
  process.exitCode = 1;
});
