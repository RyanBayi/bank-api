/** @vitest-environment node */
import { describe, test, expect, beforeAll } from "vitest";

describe("Server Integration", () => {
  // Ce test permet d'importer server.js et de couvrir ses lignes de code
  test("le serveur démarre et répond au health check", async () => {
    // On utilise un port différent pour le test
    process.env.PORT = "9999";
    
    // Importer le serveur (cela lance main())
    require("../src/server.js");

    // Attendre un court instant que le serveur soit prêt
    await new Promise(resolve => setTimeout(resolve, 500));

    const res = await fetch("http://127.0.0.1:9999/healthz");
    expect(res.status).toBe(200);
  });

  test("POST /api/login - authentification admin", async () => {
    const res = await fetch("http://127.0.0.1:9999/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.role).toBe("admin");
  });

  test("POST /api/login - échec authentification", async () => {
    const res = await fetch("http://127.0.0.1:9999/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "wrong", password: "wrong" })
    });
    expect(res.status).toBe(400);
  });

  test("GET / - redirection vers l'app", async () => {
    const res = await fetch("http://127.0.0.1:9999/", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/app/");
  });

  test("POST /api/login - authentification client réussie", async () => {
    const email = `login-${Date.now()}-${Math.random()}@test.com`;
    const client = await (await fetch("http://127.0.0.1:9999/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Login", lastName: "Test", email })
    })).json();

    const res = await fetch("http://127.0.0.1:9999/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.role).toBe("client");
    expect(data.client.id).toBe(client.id);
  });

  test("POST /api/login - email inconnu (404)", async () => {
    const email = `unknown-${Date.now()}@client.com`;
    const res = await fetch("http://127.0.0.1:9999/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/clients - création d'un client", async () => {
    const email = `it-${Date.now()}@test.com`;
    const res = await fetch("http://127.0.0.1:9999/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Integration",
        lastName: "Test",
        email
      })
    });
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.fullName).toBe("Integration Test");
    return data;
  });

  test("Cycle de vie client et compte via API", async () => {
    const email = `bob-${Date.now()}@life.com`;
    // 1. Création
    const client = await (await fetch("http://127.0.0.1:9999/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Bob", lastName: "Lifecycle", email })
    })).json();

    // 2. Mise à jour (PUT)
    const updateRes = await fetch(`http://127.0.0.1:9999/api/clients/${client.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "555-0000" })
    });
    expect(updateRes.status).toBe(200);

    // 2.5 Récupération individuelle (GET /api/clients/:id)
    const getRes = await fetch(`http://127.0.0.1:9999/api/clients/${client.id}`);
    expect(getRes.status).toBe(200);

    // 3. Création de compte
    const account = await (await fetch("http://127.0.0.1:9999/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client.id, initialDeposit: 100 })
    })).json();
    expect(account.balance).toBe(100);

    // 4. Liste des comptes du client
    const listRes = await fetch(`http://127.0.0.1:9999/api/clients/${client.id}/accounts`);
    const accounts = await listRes.json();
    expect(accounts.length).toBe(1);

    // 5. Archivage
    const archiveRes = await fetch(`http://127.0.0.1:9999/api/clients/${client.id}/archive`, { method: "POST" });
    expect(archiveRes.status).toBe(200);

    // 5.5 Vider le compte avant fermeture (requis par store.js car solde doit être 0)
    await fetch(`http://127.0.0.1:9999/api/accounts/${account.id}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 100, description: "Mise à zéro pour fermeture" })
    });

    // 6. Suppression (DELETE) - On ferme d'abord le compte
    await fetch(`http://127.0.0.1:9999/api/accounts/${account.id}/close`, { method: "POST" });
    const delRes = await fetch(`http://127.0.0.1:9999/api/clients/${client.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);
  });

  test("Gestion des erreurs API (404 et 400)", async () => {
    // Route inexistante
    const res404 = await fetch("http://127.0.0.1:9999/api/not-a-route");
    expect(res404.status).toBe(404);

    // Client inexistant
    const resNoClient = await fetch("http://127.0.0.1:9999/api/clients/999");
    expect(resNoClient.status).toBe(404);

    // Validation échouée (Body vide)
    const resBad = await fetch("http://127.0.0.1:9999/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    expect(resBad.status).toBe(400);
  });

  test("Opérations financières et erreurs (Withdraw/Transfer/Receipt)", async () => {
    const email = `rich-${Date.now()}@money.com`;
    // 1. Setup client et compte
    const client = await (await fetch("http://127.0.0.1:9999/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Rich", lastName: "Client", email })
    })).json();

    const account = await (await fetch("http://127.0.0.1:9999/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client.id, initialDeposit: 500 })
    })).json();

    // 2. Retrait réussi
    const withdrawRes = await fetch(`http://127.0.0.1:9999/api/accounts/${account.id}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 100, description: "Retrait test" })
    });
    const withdrawData = await withdrawRes.json();
    expect(withdrawRes.status).toBe(200);

    // 3. Récupération du reçu
    const receiptRes = await fetch(`http://127.0.0.1:9999/api/receipts/${withdrawData.transaction.id}`);
    expect(receiptRes.status).toBe(200);

    // 4. Erreur : Fonds insuffisants (409)
    const brokeRes = await fetch(`http://127.0.0.1:9999/api/accounts/${account.id}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 10000 })
    });
    expect(brokeRes.status).toBe(409);

    // 5. Suppression de compte (doit échouer car solde != 0)
    const delFail = await fetch(`http://127.0.0.1:9999/api/accounts/${account.id}`, { method: "DELETE" });
    expect(delFail.status).toBe(400); // ValidationError

    // 6. Réussir la suppression (après retrait du reste : 500 initial - 100 retiré = 400)
    await fetch(`http://127.0.0.1:9999/api/accounts/${account.id}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 400, description: "Vider le reste" })
    });
    const delSuccess = await fetch(`http://127.0.0.1:9999/api/accounts/${account.id}`, { method: "DELETE" });
    expect(delSuccess.status).toBe(204);
  });

  test("POST /api/transfers - virement interne réussi", async () => {
    const email1 = `exp-${Date.now()}@a.com`;
    const email2 = `dest-${Date.now()}@b.com`;
    const c1 = await (await fetch("http://127.0.0.1:9999/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Exp", lastName: "A", email: email1 })
    })).json();
    const c2 = await (await fetch("http://127.0.0.1:9999/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Dest", lastName: "B", email: email2 })
    })).json();

    const a1 = await (await fetch("http://127.0.0.1:9999/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: c1.id, initialDeposit: 1000 })
    })).json();
    const a2 = await (await fetch("http://127.0.0.1:9999/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: c2.id, initialDeposit: 0 })
    })).json();

    const res = await fetch("http://127.0.0.1:9999/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromAccountId: a1.id, toAccountId: a2.id, amount: 500, description: "Virement" })
    });
    expect(res.status).toBe(201);
  });

  test("Consultation des ressources globales et documentation", async () => {
    expect((await fetch("http://127.0.0.1:9999/api/summary")).status).toBe(200);
    expect((await fetch("http://127.0.0.1:9999/api/transactions")).status).toBe(200);
    expect((await fetch("http://127.0.0.1:9999/openapi.json")).status).toBe(200);
    expect((await fetch("http://127.0.0.1:9999/swagger-ui/index.html")).status).toBe(200);
  });

  test("Recherche et filtrage via API (GET /api/clients et GET /api/accounts)", async () => {
    const name = `Searchable-${Date.now()}`;
    await fetch("http://127.0.0.1:9999/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: name, lastName: "Client", email: `${name}@test.com` })
    });

    const resClients = await fetch(`http://127.0.0.1:9999/api/clients?q=${name}`);
    const clients = await resClients.json();
    expect(resClients.status).toBe(200);
    expect(clients.some(c => c.firstName === name)).toBe(true);

    const resAccounts = await fetch("http://127.0.0.1:9999/api/accounts");
    expect(resAccounts.status).toBe(200);
  });
});
