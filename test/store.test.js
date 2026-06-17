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
    expect(() => store.getClientById(client.id)).toThrow();
  });
});
