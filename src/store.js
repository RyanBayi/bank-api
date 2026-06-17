const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const FALLBACK_DATA_DIR = path.join(process.env.TMPDIR || "/tmp", "ict304-gestion-banque-api");
const ACCOUNT_TYPES = new Set(["CURRENT", "SAVINGS", "BUSINESS", "JOINT"]);
const TRANSFER_TYPES = new Set(["INTERNAL", "EXTERNAL_BANK", "PAYMENT_GATEWAY"]);

let dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
let dbFile = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(dataDir, "db.json");

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
    this.code = "NOT_FOUND";
  }
}

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ValidationError";
    this.code = "VALIDATION_ERROR";
    this.details = details;
  }
}

class InsufficientFundsError extends Error {
  constructor(message) {
    super(message);
    this.name = "InsufficientFundsError";
    this.code = "INSUFFICIENT_FUNDS";
  }
}

let db = { clients: [], accounts: [], transactions: [] };
let saveChain = Promise.resolve();

async function ensureDbFile() {
  const attempts = [];
  if (process.env.DB_FILE) {
    attempts.push({ dataDir: path.dirname(dbFile), dbFile });
  } else {
    attempts.push({ dataDir, dbFile });
    if (!process.env.DATA_DIR) {
      attempts.push({ dataDir: FALLBACK_DATA_DIR, dbFile: path.join(FALLBACK_DATA_DIR, "db.json") });
    }
  }

  let lastErr;
  for (const attempt of attempts) {
    try {
      await fs.mkdir(attempt.dataDir, { recursive: true });
      try {
        await fs.access(attempt.dbFile);
      } catch {
        await fs.writeFile(attempt.dbFile, JSON.stringify(db, null, 2), "utf8");
      }
      dataDir = attempt.dataDir;
      dbFile = attempt.dbFile;
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function loadDb() {
  await ensureDbFile();
  const raw = await fs.readFile(dbFile, "utf8");
  const parsed = JSON.parse(raw || "{}");
  db = normalizeDb(parsed);
}

function normalizeDb(parsed) {
  const next = {
    clients: Array.isArray(parsed.clients) ? parsed.clients : [],
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : []
  };

  for (const account of next.accounts) {
    if (!account.clientId) {
      const legacyName = String(account.ownerName || "Client historique").trim();
      const client = createClientRecord({
        firstName: legacyName.split(/\s+/u).slice(0, -1).join(" ") || legacyName,
        lastName: legacyName.split(/\s+/u).slice(-1).join(" ") || "Historique",
        address: "",
        phone: "",
        email: "",
        identityNumber: "",
        photo: "",
        kycStatus: "PENDING"
      });
      next.clients.push(client);
      account.clientId = client.id;
    }
    account.type = ACCOUNT_TYPES.has(account.type) ? account.type : "CURRENT";
    account.status = account.status || "ACTIVE";
    account.accountNumber = account.accountNumber || generateAccountNumber();
    account.openedAt = account.openedAt || account.createdAt || new Date().toISOString();
  }

  return next;
}

function persistDb() {
  saveChain = saveChain
    .then(() => fs.writeFile(dbFile, JSON.stringify(db, null, 2), "utf8"))
    .catch((err) => {
      console.error("Erreur lors de la sauvegarde db.json:", err);
    });
  return saveChain;
}

function parseMoneyToCents(value, { allowZero = false, fieldName = "amount" } = {}) {
  if (value === undefined || value === null) throw new ValidationError(`${fieldName} est obligatoire`);
  const raw = String(value).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/u.test(raw)) throw new ValidationError(`${fieldName} doit être un nombre (max 2 décimales)`);

  const [intPart, decPart = ""] = raw.split(".");
  const cents = Number(intPart) * 100 + Number((decPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new ValidationError(`${fieldName} est trop grand`);
  if (allowZero ? cents < 0 : cents <= 0) throw new ValidationError(`${fieldName} doit être ${allowZero ? ">= 0" : "> 0"}`);
  return cents;
}

function centsToMoney(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function cleanString(value, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function requireString(value, fieldName, max = 180) {
  const cleaned = cleanString(value, max);
  if (!cleaned) throw new ValidationError(`${fieldName} est obligatoire`);
  return cleaned;
}

function validateEmail(email) {
  const cleaned = cleanString(email, 160);
  if (cleaned && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(cleaned)) throw new ValidationError("email invalide");
  return cleaned;
}

function generateAccountNumber() {
  return `ALT-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function createClientRecord(payload) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    firstName: requireString(payload.firstName, "firstName"),
    lastName: requireString(payload.lastName, "lastName"),
    address: cleanString(payload.address, 240),
    phone: cleanString(payload.phone, 40),
    email: validateEmail(payload.email),
    identityNumber: cleanString(payload.identityNumber, 80),
    photo: payload.photo && payload.photo.trim() !== "" ? cleanString(payload.photo, 1200) : "",
    kycStatus: ["PENDING", "VERIFIED", "REJECTED"].includes(payload.kycStatus) ? payload.kycStatus : "PENDING",
    archived: Boolean(payload.archived),
    createdAt: now,
    updatedAt: now
  };
}

function clientToResponse(client) {
  return {
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    fullName: `${client.firstName} ${client.lastName}`.trim(),
    address: client.address,
    phone: client.phone,
    email: client.email,
    identityNumber: client.identityNumber,
    photo: client.photo,
    kycStatus: client.kycStatus,
    archived: Boolean(client.archived),
    accountCount: db.accounts.filter((account) => account.clientId === client.id && account.status !== "CLOSED").length,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt
  };
}

function accountToResponse(account) {
  const client = db.clients.find((item) => item.id === account.clientId);
  return {
    id: account.id,
    clientId: account.clientId,
    clientName: client ? `${client.firstName} ${client.lastName}`.trim() : account.ownerName || "Client inconnu",
    ownerName: client ? `${client.firstName} ${client.lastName}`.trim() : account.ownerName || "Client inconnu",
    accountNumber: account.accountNumber,
    type: account.type,
    status: account.status,
    balance: centsToMoney(account.balanceCents),
    openedAt: account.openedAt,
    closedAt: account.closedAt || null,
    createdAt: account.createdAt || account.openedAt
  };
}

function transactionToResponse(transaction) {
  return {
    id: transaction.id,
    receiptNumber: transaction.receiptNumber,
    accountId: transaction.accountId,
    relatedAccountId: transaction.relatedAccountId || null,
    type: transaction.type,
    transferType: transaction.transferType || null,
    amount: centsToMoney(transaction.amountCents),
    balanceAfter: centsToMoney(transaction.balanceAfterCents),
    createdAt: transaction.createdAt,
    description: transaction.description || "",
    destinationBank: transaction.destinationBank || "",
    beneficiaryName: transaction.beneficiaryName || "",
    gatewayName: transaction.gatewayName || "",
    gatewayReference: transaction.gatewayReference || ""
  };
}

function receiptToResponse(transaction) {
  const account = getAccountById(transaction.accountId);
  const client = getClientById(account.clientId);
  return {
    receiptNumber: transaction.receiptNumber,
    transaction: transactionToResponse(transaction),
    account: accountToResponse(account),
    client: clientToResponse(client),
    issuedAt: new Date().toISOString()
  };
}

function findClientIndexById(id) {
  return db.clients.findIndex((client) => client.id === id);
}

function getClientById(id) {
  const idx = findClientIndexById(id);
  if (idx === -1) throw new NotFoundError("Client introuvable");
  return db.clients[idx];
}

function findAccountIndexById(id) {
  return db.accounts.findIndex((account) => account.id === id);
}

function getAccountById(id) {
  const idx = findAccountIndexById(id);
  if (idx === -1) throw new NotFoundError("Compte introuvable");
  return db.accounts[idx];
}

function ensureActiveAccount(account) {
  if (account.status === "CLOSED") throw new ValidationError("Compte fermé");
}

function createTransaction({ accountId, relatedAccountId, type, transferType, amountCents, balanceAfterCents, description, destinationBank, beneficiaryName, gatewayName, gatewayReference }) {
  const tx = {
    id: randomUUID(),
    receiptNumber: `REC-${new Date().toISOString().slice(0, 10).replace(/-/gu, "")}-${Math.floor(100000 + Math.random() * 900000)}`,
    accountId,
    relatedAccountId,
    type,
    transferType,
    amountCents,
    balanceAfterCents,
    createdAt: new Date().toISOString(),
    description,
    destinationBank,
    beneficiaryName,
    gatewayName,
    gatewayReference
  };
  db.transactions.push(tx);
  return tx;
}

async function createClient(payload) {
  const client = createClientRecord(payload);
  db.clients.push(client);
  await persistDb();
  return clientToResponse(client);
}

async function updateClient(id, payload) {
  const client = getClientById(id);
  if (payload.firstName !== undefined) client.firstName = requireString(payload.firstName, "firstName");
  if (payload.lastName !== undefined) client.lastName = requireString(payload.lastName, "lastName");
  if (payload.address !== undefined) client.address = cleanString(payload.address, 240);
  if (payload.phone !== undefined) client.phone = cleanString(payload.phone, 40);
  if (payload.email !== undefined) client.email = validateEmail(payload.email);
  if (payload.identityNumber !== undefined) client.identityNumber = cleanString(payload.identityNumber, 80);
  if (payload.photo !== undefined) client.photo = cleanString(payload.photo, 1200);
  if (payload.kycStatus !== undefined) {
    if (!["PENDING", "VERIFIED", "REJECTED"].includes(payload.kycStatus)) throw new ValidationError("kycStatus invalide");
    client.kycStatus = payload.kycStatus;
  }
  client.updatedAt = new Date().toISOString();
  await persistDb();
  return clientToResponse(client);
}

async function listClients({ q, includeArchived = false } = {}) {
  const term = cleanString(q, 120).toLowerCase();
  return db.clients
    .filter((client) => includeArchived || !client.archived)
    .filter((client) => {
      if (!term) return true;
      return [client.firstName, client.lastName, client.email, client.phone, client.identityNumber]
        .join(" ")
        .toLowerCase()
        .includes(term);
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(clientToResponse);
}

async function archiveClient(id) {
  const client = getClientById(id);
  client.archived = true;
  client.updatedAt = new Date().toISOString();
  await persistDb();
  return clientToResponse(client);
}

async function deleteClient(id) {
  getClientById(id);
  const activeAccounts = db.accounts.filter((account) => account.clientId === id && account.status !== "CLOSED");
  if (activeAccounts.length > 0) throw new ValidationError("Fermez les comptes actifs avant de supprimer ce client");
  db.clients = db.clients.filter((client) => client.id !== id);
  db.accounts = db.accounts.filter((account) => account.clientId !== id);
  db.transactions = db.transactions.filter((tx) => db.accounts.some((account) => account.id === tx.accountId));
  await persistDb();
}

async function createAccount(payload) {
  const clientId = cleanString(payload.clientId);
  let client;
  if (clientId) {
    client = getClientById(clientId);
  } else {
    client = await createClient({
      firstName: payload.firstName || payload.ownerName || "Client",
      lastName: payload.lastName || "Altas",
      address: payload.address,
      phone: payload.phone,
      email: payload.email,
      identityNumber: payload.identityNumber,
      photo: payload.photo,
      kycStatus: payload.kycStatus
    });
    client = getClientById(client.id);
  }

  if (client.archived) throw new ValidationError("Impossible d'ouvrir un compte pour un client archivé");

  const hasActiveAccount = db.accounts.some((acc) => acc.clientId === client.id && acc.status !== "CLOSED");
  if (hasActiveAccount) {
    throw new ValidationError("Ce client possède déjà un compte actif. Une seule relation bancaire par client est autorisée.");
  }

  const type = ACCOUNT_TYPES.has(payload.type) ? payload.type : "CURRENT";
  const initialDepositCents = payload.initialDeposit === undefined ? 0 : parseMoneyToCents(payload.initialDeposit, { allowZero: true, fieldName: "initialDeposit" });
  const now = new Date().toISOString();
  const account = {
    id: randomUUID(),
    clientId: client.id,
    ownerName: `${client.firstName} ${client.lastName}`.trim(),
    accountNumber: generateAccountNumber(),
    type,
    status: "ACTIVE",
    balanceCents: initialDepositCents,
    openedAt: now,
    createdAt: now
  };
  db.accounts.push(account);

  if (initialDepositCents > 0) {
    createTransaction({
      accountId: account.id,
      type: "DEPOSIT",
      amountCents: initialDepositCents,
      balanceAfterCents: account.balanceCents,
      description: "Dépôt initial à l'ouverture du compte"
    });
  }

  await persistDb();
  return accountToResponse(account);
}

async function closeAccount(id) {
  const account = getAccountById(id);
  if (account.status === "CLOSED") return accountToResponse(account);
  if (account.balanceCents !== 0) throw new ValidationError("Le solde doit être à 0 avant fermeture");
  account.status = "CLOSED";
  account.closedAt = new Date().toISOString();
  await persistDb();
  return accountToResponse(account);
}

async function deleteAccount(id) {
  const account = getAccountById(id);
  if (account.balanceCents !== 0) throw new ValidationError("Le solde doit être à 0 avant suppression");
  db.accounts = db.accounts.filter((item) => item.id !== id);
  db.transactions = db.transactions.filter((tx) => tx.accountId !== id && tx.relatedAccountId !== id);
  await persistDb();
}

async function listAccounts({ clientId, includeClosed = false } = {}) {
  if (clientId) getClientById(clientId);
  return db.accounts
    .filter((account) => !clientId || account.clientId === clientId)
    .filter((account) => includeClosed || account.status !== "CLOSED")
    .sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)))
    .map(accountToResponse);
}

async function listTransactions({ accountId, limit = 100 } = {}) {
  if (accountId) getAccountById(accountId);
  const normalizedLimit = Number(limit);
  const safeLimit = Number.isInteger(normalizedLimit) && normalizedLimit > 0 && normalizedLimit <= 500 ? normalizedLimit : 100;
  return db.transactions
    .filter((tx) => !accountId || tx.accountId === accountId || tx.relatedAccountId === accountId)
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, safeLimit)
    .map(transactionToResponse);
}

async function getSummary() {
  const activeAccounts = db.accounts.filter((account) => account.status !== "CLOSED");
  const totalBalanceCents = activeAccounts.reduce((sum, account) => sum + Number(account.balanceCents || 0), 0);
  return {
    clientCount: db.clients.filter((client) => !client.archived).length,
    archivedClientCount: db.clients.filter((client) => client.archived).length,
    accountCount: activeAccounts.length,
    closedAccountCount: db.accounts.length - activeAccounts.length,
    transactionCount: db.transactions.length,
    totalBalance: centsToMoney(totalBalanceCents)
  };
}

async function deposit(accountId, amount, description = "Dépôt espèces") {
  const amountCents = parseMoneyToCents(amount, { fieldName: "amount" });
  const account = getAccountById(accountId);
  ensureActiveAccount(account);
  account.balanceCents += amountCents;
  const transaction = createTransaction({
    accountId,
    type: "DEPOSIT",
    amountCents,
    balanceAfterCents: account.balanceCents,
    description: cleanString(description, 140)
  });
  await persistDb();
  return { account: accountToResponse(account), transaction: transactionToResponse(transaction), receipt: receiptToResponse(transaction) };
}

async function withdraw(accountId, amount, description = "Retrait espèces") {
  const amountCents = parseMoneyToCents(amount, { fieldName: "amount" });
  const account = getAccountById(accountId);
  ensureActiveAccount(account);
  if (account.balanceCents < amountCents) throw new InsufficientFundsError("Fonds insuffisants");
  account.balanceCents -= amountCents;
  const transaction = createTransaction({
    accountId,
    type: "WITHDRAWAL",
    amountCents,
    balanceAfterCents: account.balanceCents,
    description: cleanString(description, 140)
  });
  await persistDb();
  return { account: accountToResponse(account), transaction: transactionToResponse(transaction), receipt: receiptToResponse(transaction) };
}

async function transfer(payload) {
  const fromId = requireString(payload.fromAccountId, "fromAccountId");
  const transferType = TRANSFER_TYPES.has(payload.transferType) ? payload.transferType : "INTERNAL";
  const amountCents = parseMoneyToCents(payload.amount, { fieldName: "amount" });
  const fromAccount = getAccountById(fromId);
  ensureActiveAccount(fromAccount);
  if (fromAccount.balanceCents < amountCents) throw new InsufficientFundsError("Fonds insuffisants");

  const description = cleanString(payload.description || "Virement", 140);
  fromAccount.balanceCents -= amountCents;

  if (transferType === "INTERNAL") {
    const toId = requireString(payload.toAccountId, "toAccountId");
    if (fromId === toId) throw new ValidationError("Les comptes source et destinataire doivent être différents");
    const toAccount = getAccountById(toId);
    ensureActiveAccount(toAccount);
    toAccount.balanceCents += amountCents;
    const withdrawal = createTransaction({
      accountId: fromId,
      relatedAccountId: toId,
      type: "TRANSFER_OUT",
      transferType,
      amountCents,
      balanceAfterCents: fromAccount.balanceCents,
      description
    });
    const depositTx = createTransaction({
      accountId: toId,
      relatedAccountId: fromId,
      type: "TRANSFER_IN",
      transferType,
      amountCents,
      balanceAfterCents: toAccount.balanceCents,
      description
    });
    await persistDb();
    return {
      fromAccount: accountToResponse(fromAccount),
      toAccount: accountToResponse(toAccount),
      transactions: [transactionToResponse(withdrawal), transactionToResponse(depositTx)],
      receipt: receiptToResponse(withdrawal)
    };
  }

  const transaction = createTransaction({
    accountId: fromId,
    type: transferType === "PAYMENT_GATEWAY" ? "GATEWAY_TRANSFER_OUT" : "EXTERNAL_TRANSFER_OUT",
    transferType,
    amountCents,
    balanceAfterCents: fromAccount.balanceCents,
    description,
    destinationBank: cleanString(payload.destinationBank, 120),
    beneficiaryName: requireString(payload.beneficiaryName, "beneficiaryName", 140),
    gatewayName: cleanString(payload.gatewayName, 120),
    gatewayReference: cleanString(payload.gatewayReference, 120)
  });
  await persistDb();
  return {
    fromAccount: accountToResponse(fromAccount),
    transactions: [transactionToResponse(transaction)],
    receipt: receiptToResponse(transaction)
  };
}

function getReceiptByTransactionId(id) {
  const transaction = db.transactions.find((tx) => tx.id === id || tx.receiptNumber === id);
  if (!transaction) throw new NotFoundError("Reçu introuvable");
  return receiptToResponse(transaction);
}

module.exports = {
  ACCOUNT_TYPES,
  TRANSFER_TYPES,
  loadDb,
  clientToResponse,
  accountToResponse,
  transactionToResponse,
  receiptToResponse,
  centsToMoney,
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
};
