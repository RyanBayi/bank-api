import { describe, test, assert, expect } from "vitest";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function freshStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bank-api-test-"));
  process.env.DB_FILE = path.join(dir, "db.json");
  delete require.cache[require.resolve("../src/store")];
  const store = require("../src/store");
  await store.loadDb();
  return store;
}

describe("Bank Store Logic", () => {
  test("crée un compte avec dépôt initial et transaction", async () => {
    const store = await freshStore();
    const account = await store.createAccount({ ownerName: "Alice", initialDeposit: 1500 });
    const accounts = await store.listAccounts();
    const transactions = await store.listTransactions();

    assert.equal(account.ownerName, "Alice Altas");
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].balance, 1500);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].type, "DEPOSIT");
  });

  test("refuse un retrait supérieur au solde", async () => {
    const store = await freshStore();
    const account = await store.createAccount({ ownerName: "Bob", initialDeposit: 2000 });

    await expect(store.withdraw(account.id, 2500)).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS"
    });
  });

  test("effectue un virement atomique entre deux comptes", async () => {
    const store = await freshStore();
    const alice = await store.createAccount({ ownerName: "Alice", initialDeposit: 5000 });
    const bob = await store.createAccount({ ownerName: "Bob", initialDeposit: 1000 });

    const result = await store.transfer({
      fromAccountId: alice.id,
      toAccountId: bob.id,
      amount: 1250,
      description: "Paiement facture"
    });
    const accounts = await store.listAccounts();
    const transactions = await store.listTransactions();

    assert.equal(result.fromAccount.balance, 3750);
    assert.equal(result.toAccount.balance, 2250);
    assert.equal(accounts.find((account) => account.id === alice.id).balance, 3750);
    assert.equal(accounts.find((account) => account.id === bob.id).balance, 2250);
    assert.equal(transactions.filter((tx) => tx.type.startsWith("TRANSFER")).length, 2);
  });

  test("calcule le résumé global", async () => {
    const store = await freshStore();
    await store.createAccount({ ownerName: "Alice", initialDeposit: 1000 });
    await store.createAccount({ ownerName: "Bob", initialDeposit: 2000 });

    const summary = await store.getSummary();

    assert.equal(summary.accountCount, 2);
    assert.equal(summary.transactionCount, 2);
    assert.equal(summary.totalBalance, 3000);
  });

  test("effectue un virement vers une banque externe", async () => {
    const store = await freshStore();
    const alice = await store.createAccount({ ownerName: "Alice", initialDeposit: 1000 });

    const result = await store.transfer({
      fromAccountId: alice.id,
      transferType: "EXTERNAL_BANK",
      amount: 500,
      beneficiaryName: "Jean Dupont",
      destinationBank: "Banque Centrale",
      description: "Loyer"
    });

    assert.equal(result.fromAccount.balance, 500);
    assert.equal(result.transactions[0].type, "EXTERNAL_TRANSFER_OUT");
    assert.equal(result.transactions[0].beneficiaryName, "Jean Dupont");
  });

  test("effectue un virement via une passerelle de paiement", async () => {
    const store = await freshStore();
    const alice = await store.createAccount({ ownerName: "Alice", initialDeposit: 1000 });

    const result = await store.transfer({
      fromAccountId: alice.id,
      transferType: "PAYMENT_GATEWAY",
      amount: 200,
      beneficiaryName: "Boutique En Ligne",
      gatewayName: "Stripe",
      gatewayReference: "TXN-123"
    });

    assert.equal(result.fromAccount.balance, 800);
    assert.equal(result.transactions[0].type, "GATEWAY_TRANSFER_OUT");
  });

  test("refuse un virement interne vers le même compte", async () => {
    const store = await freshStore();
    const alice = await store.createAccount({ ownerName: "Alice", initialDeposit: 1000 });

    await expect(store.transfer({
      fromAccountId: alice.id,
      toAccountId: alice.id,
      amount: 100
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("archive et supprime un client", async () => {
    const store = await freshStore();
    const client = await store.createClient({ firstName: "Marc", lastName: "Solo" });
    
    const archived = await store.archiveClient(client.id);
    assert.strictEqual(archived.archived, true);

    await store.deleteClient(client.id);
    await expect(store.getClientById(client.id)).rejects.toThrow();
  });

  test("met à jour les informations d'un client", async () => {
    const store = await freshStore();
    const client = await store.createClient({ firstName: "Jean", lastName: "Bono" });
    const updated = await store.updateClient(client.id, { firstName: "Jacques", email: "jacques@bono.com" });
    assert.equal(updated.firstName, "Jacques");
    assert.equal(updated.email, "jacques@bono.com");
  });

  test("liste et recherche des clients", async () => {
    const store = await freshStore();
    await store.createClient({ firstName: "Alice", lastName: "Z" });
    await store.createClient({ firstName: "Bob", lastName: "Y" });
    
    const all = await store.listClients();
    assert.equal(all.length, 2);
    
    const search = await store.listClients({ q: "Alice" });
    assert.equal(search.length, 1);
    assert.equal(search[0].firstName, "Alice");
  });

  test("effectue un dépôt et un retrait", async () => {
    const store = await freshStore();
    const account = await store.createAccount({ ownerName: "Alice", initialDeposit: 100 });
    
    const dep = await store.deposit(account.id, 50, "Cadeau");
    assert.equal(dep.account.balance, 150);
    
    const wit = await store.withdraw(account.id, 30, "Courses");
    assert.equal(wit.account.balance, 120);
  });

  test("gère la fermeture et suppression de compte", async () => {
    const store = await freshStore();
    const account = await store.createAccount({ ownerName: "Alice", initialDeposit: 0 });
    
    await store.closeAccount(account.id);
    const closed = await store.getAccountById(account.id);
    assert.equal(closed.status, "CLOSED");
    
    await store.deleteAccount(account.id);
    await expect(store.getAccountById(account.id)).rejects.toThrow();
  });

  test("récupère un reçu par numéro de reçu", async () => {
    const store = await freshStore();
    const account = await store.createAccount({ ownerName: "Alice", initialDeposit: 100 });
    const txs = await store.listTransactions({ accountId: account.id });
    const receipt = await store.getReceiptByTransactionId(txs[0].receiptNumber);
    assert.equal(receipt.transaction.receiptNumber, txs[0].receiptNumber);
  });

  test("valide les contraintes de sécurité et formats", async () => {
    const store = await freshStore();
    
    // Test format monétaire invalide
    await expect(store.createAccount({ ownerName: "A", initialDeposit: "abc" }))
      .rejects.toThrow("initialDeposit doit être un nombre");
    
    // Test email invalide
    await expect(store.createClient({ firstName: "A", lastName: "B", email: "pas-un-email" }))
      .rejects.toThrow("email invalide");
    
    // Test KYC invalide lors d'une mise à jour
    const client = await store.createClient({ firstName: "A", lastName: "B" });
    await expect(store.updateClient(client.id, { kycStatus: "INVALID" }))
      .rejects.toThrow("kycStatus invalide");
  });
  
  test("empêche les opérations sur comptes fermés ou clients archivés", async () => {
    const store = await freshStore();
    const client = await store.createClient({ firstName: "A", lastName: "B" });
    const account = await store.createAccount({ clientId: client.id, initialDeposit: 100 });
    
    // Empêcher l'ouverture de compte pour un client archivé
    await store.archiveClient(client.id);
    await expect(store.createAccount({ clientId: client.id }))
      .rejects.toThrow("Impossible d'ouvrir un compte pour un client archivé");

    // Empêcher l'ouverture de plusieurs comptes actifs
    const client2 = await store.createClient({ firstName: "B", lastName: "C" });
    await store.createAccount({ clientId: client2.id });
    await expect(store.createAccount({ clientId: client2.id }))
      .rejects.toThrow("Ce client possède déjà un compte actif");

    // Empêcher dépôt sur compte fermé
    await store.withdraw(account.id, 100);
    await store.closeAccount(account.id);
    await expect(store.deposit(account.id, 50)).rejects.toThrow("Compte fermé");
  });

  test("couvre les filtres de listing et limites", async () => {
    const store = await freshStore();
    const alice = await store.createAccount({ ownerName: "Alice", initialDeposit: 100 });
    
    const accounts = await store.listAccounts({ clientId: alice.clientId });
    assert.equal(accounts.length, 1);

    const txs = await store.listTransactions({ accountId: alice.id, limit: 10 });
    assert.equal(txs.length, 1);
  });
});
