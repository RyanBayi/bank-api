const path = require("path");
const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
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

let db;

function createDbConnection(filename) {
  const connection = new Database(filename);
  return {
    async exec(sql) {
      connection.exec(sql);
    },
    async run(sql, params = []) {
      return connection.prepare(sql).run(...(Array.isArray(params) ? params : []));
    },
    async get(sql, params = []) {
      return connection.prepare(sql).get(...(Array.isArray(params) ? params : []));
    },
    async all(sql, params = []) {
      return connection.prepare(sql).all(...(Array.isArray(params) ? params : []));
    }
  };
}

async function loadDb() {
  db = createDbConnection(dbFile.endsWith(".json") ? dbFile.replace(".json", ".db") : dbFile);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      firstName TEXT,
      lastName TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      identityNumber TEXT,
      photo TEXT,
      kycStatus TEXT,
      archived INTEGER,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      clientId TEXT,
      ownerName TEXT,
      accountNumber TEXT,
      type TEXT,
      status TEXT,
      balanceCents INTEGER,
      openedAt TEXT,
      createdAt TEXT,
      FOREIGN KEY(clientId) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      receiptNumber TEXT,
      accountId TEXT,
      relatedAccountId TEXT,
      type TEXT,
      transferType TEXT,
      amountCents INTEGER,
      balanceAfterCents INTEGER,
      createdAt TEXT,
      description TEXT,
      destinationBank TEXT,
      beneficiaryName TEXT,
      gatewayName TEXT,
      gatewayReference TEXT,
      FOREIGN KEY(accountId) REFERENCES accounts(id)
    );
  `);
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

async function clientToResponse(client) {
  const accountCount = (await db.get("SELECT COUNT(*) as count FROM accounts WHERE clientId = ? AND status != 'CLOSED'", [client.id])).count;
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
    accountCount,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt
  };
}

async function accountToResponse(account) {
  const client = await db.get("SELECT * FROM clients WHERE id = ?", [account.clientId]);
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

async function receiptToResponse(transaction) {
  const account = await getAccountById(transaction.accountId);
  const client = await getClientById(account.clientId);
  return {
    receiptNumber: transaction.receiptNumber,
    transaction: transactionToResponse(transaction),
    account: accountToResponse(account),
    client: clientToResponse(client),
    issuedAt: new Date().toISOString()
  };
}

async function getClientById(id) {
  const client = await db.get("SELECT * FROM clients WHERE id = ?", [id]);
  if (!client) throw new NotFoundError("Client introuvable");
  return client;
}

async function getClientByEmail(email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const client = await db.get("SELECT * FROM clients WHERE LOWER(email) = ? AND archived = 0", [cleanEmail]);
  if (!client) throw new NotFoundError("Client introuvable ou archivé");
  return client;
}

async function getAccountById(id) {
  const account = await db.get("SELECT * FROM accounts WHERE id = ?", [id]);
  if (!account) throw new NotFoundError("Compte introuvable");
  return account;
}

function ensureActiveAccount(account) {
  if (account.status === "CLOSED") throw new ValidationError("Compte fermé");
}

async function createTransaction({ accountId, relatedAccountId, type, transferType, amountCents, balanceAfterCents, description, destinationBank, beneficiaryName, gatewayName, gatewayReference }) {
  const tx = {
    id: randomUUID(),
    receiptNumber: `REC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(100000 + Math.random() * 900000)}`,
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

  await db.run(`
    INSERT INTO transactions (id, receiptNumber, accountId, relatedAccountId, type, transferType, amountCents, balanceAfterCents, createdAt, description, destinationBank, beneficiaryName, gatewayName, gatewayReference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [tx.id, tx.receiptNumber, tx.accountId, tx.relatedAccountId, tx.type, tx.transferType, tx.amountCents, tx.balanceAfterCents, tx.createdAt, tx.description, tx.destinationBank, tx.beneficiaryName, tx.gatewayName, tx.gatewayReference]);

  return tx;
}

async function createClient(payload) {
  const client = createClientRecord(payload);
  await db.run(`
    INSERT INTO clients (id, firstName, lastName, address, phone, email, identityNumber, photo, kycStatus, archived, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    client.id, client.firstName, client.lastName, client.address, 
    client.phone, client.email, client.identityNumber, client.photo, 
    client.kycStatus, client.archived ? 1 : 0, client.createdAt, client.updatedAt
  ]);
  return await clientToResponse(client);
}

async function updateClient(id, payload) {
  const client = await getClientById(id);
  const updates = [];
  const params = [];

  const addUpdate = (field, value) => {
    updates.push(`${field} = ?`);
    params.push(value);
    client[field] = value;
  };

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

  await db.run(`
    UPDATE clients SET 
      firstName = ?, lastName = ?, address = ?, phone = ?, email = ?, 
      identityNumber = ?, photo = ?, kycStatus = ?, updatedAt = ?
    WHERE id = ?
  `, [
    client.firstName, client.lastName, client.address, client.phone, client.email,
    client.identityNumber, client.photo, client.kycStatus, client.updatedAt, id
  ]);

  return await clientToResponse(client);
}

async function listClients({ q, includeArchived = false } = {}) {
  const term = cleanString(q, 120).toLowerCase();
  let query = "SELECT * FROM clients WHERE 1=1";
  const params = [];

  if (!includeArchived) query += " AND archived = 0";
  if (term) {
    query += " AND (LOWER(firstName) LIKE ? OR LOWER(lastName) LIKE ? OR LOWER(email) LIKE ?)";
    params.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }

  query += " ORDER BY createdAt DESC";
  const clients = await db.all(query, params);
  return Promise.all(clients.map(clientToResponse));
}

async function archiveClient(id) {
  const now = new Date().toISOString();
  await db.run("UPDATE clients SET archived = 1, updatedAt = ? WHERE id = ?", [now, id]);
  return await clientToResponse(await getClientById(id));
}

async function deleteClient(id) {
  await getClientById(id);
  const active = await db.get("SELECT id FROM accounts WHERE clientId = ? AND status != 'CLOSED'", [id]);
  if (active) throw new ValidationError("Fermez les comptes actifs avant de supprimer ce client");
  
  await db.run("DELETE FROM transactions WHERE accountId IN (SELECT id FROM accounts WHERE clientId = ?)", [id]);
  await db.run("DELETE FROM accounts WHERE clientId = ?", [id]);
  await db.run("DELETE FROM clients WHERE id = ?", [id]);
}

async function createAccount(payload) {
  const clientId = cleanString(payload.clientId);
  let client;
  if (clientId) {
    client = await getClientById(clientId);
  } 
  
  if (!client) {
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
    client = await getClientById(client.id);
  }

  if (client.archived) throw new ValidationError("Impossible d'ouvrir un compte pour un client archivé");

  const hasActiveAccount = await db.get("SELECT id FROM accounts WHERE clientId = ? AND status != 'CLOSED'", [client.id]);
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

  await db.run(`
    INSERT INTO accounts (id, clientId, ownerName, accountNumber, type, status, balanceCents, openedAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [account.id, account.clientId, account.ownerName, account.accountNumber, account.type, account.status, account.balanceCents, account.openedAt, account.createdAt]);

  if (initialDepositCents > 0) {
    await createTransaction({
      accountId: account.id,
      type: "DEPOSIT",
      amountCents: initialDepositCents,
      balanceAfterCents: account.balanceCents,
      description: "Dépôt initial à l'ouverture du compte"
    });
  }

  return await accountToResponse(account);
}

async function closeAccount(id) {
  const account = await getAccountById(id);
  if (account.status === "CLOSED") return await accountToResponse(account);
  if (account.balanceCents !== 0) throw new ValidationError("Le solde doit être à 0 avant fermeture");
  
  const now = new Date().toISOString();
  await db.run("UPDATE accounts SET status = 'CLOSED' WHERE id = ?", [id]);
  return await accountToResponse(await getAccountById(id));
}

async function deleteAccount(id) {
  const account = await getAccountById(id);
  if (account.balanceCents !== 0) throw new ValidationError("Le solde doit être à 0 avant suppression");
  
  await db.run("DELETE FROM transactions WHERE accountId = ? OR relatedAccountId = ?", [id, id]);
  await db.run("DELETE FROM accounts WHERE id = ?", [id]);
}

async function listAccounts({ clientId, includeClosed = false } = {}) {
  let query = "SELECT * FROM accounts WHERE 1=1";
  const params = [];

  if (clientId) {
    await getClientById(clientId);
    query += " AND clientId = ?";
    params.push(clientId);
  }
  if (!includeClosed) query += " AND status != 'CLOSED'";

  query += " ORDER BY openedAt DESC";
  const accounts = await db.all(query, params);
  return Promise.all(accounts.map(accountToResponse));
}

async function listTransactions({ accountId, limit = 100 } = {}) {
  const normalizedLimit = Number(limit);
  const safeLimit = Number.isInteger(normalizedLimit) && normalizedLimit > 0 && normalizedLimit <= 500 ? normalizedLimit : 100;
  
  let query = "SELECT * FROM transactions WHERE 1=1";
  const params = [];

  if (accountId) {
    await getAccountById(accountId);
    query += " AND (accountId = ? OR relatedAccountId = ?)";
    params.push(accountId, accountId);
  }

  query += " ORDER BY createdAt DESC LIMIT ?";
  params.push(safeLimit);
  
  const txs = await db.all(query, params);
  return txs.map(transactionToResponse);
}

async function getSummary() {
  const clientCount = (await db.get("SELECT COUNT(*) as count FROM clients WHERE archived = 0")).count;
  const archivedCount = (await db.get("SELECT COUNT(*) as count FROM clients WHERE archived = 1")).count;
  const accountCount = (await db.get("SELECT COUNT(*) as count FROM accounts WHERE status != 'CLOSED'")).count;
  const closedCount = (await db.get("SELECT COUNT(*) as count FROM accounts WHERE status = 'CLOSED'")).count;
  const txCount = (await db.get("SELECT COUNT(*) as count FROM transactions")).count;
  const totalBalance = (await db.get("SELECT SUM(balanceCents) as total FROM accounts WHERE status != 'CLOSED'")).total || 0;

  return {
    clientCount,
    archivedClientCount: archivedCount,
    accountCount,
    closedAccountCount: closedCount,
    transactionCount: txCount,
    totalBalance: centsToMoney(totalBalance)
  };
}

async function deposit(accountId, amount, description = "Dépôt espèces") {
  const amountCents = parseMoneyToCents(amount, { fieldName: "amount" });
  const account = await getAccountById(accountId);
  ensureActiveAccount(account);
  account.balanceCents += amountCents;
  
  await db.run("UPDATE accounts SET balanceCents = ? WHERE id = ?", [account.balanceCents, accountId]);
  
  const transaction = await createTransaction({
    accountId,
    type: "DEPOSIT",
    amountCents,
    balanceAfterCents: account.balanceCents,
    description: cleanString(description, 140)
  });

  return { 
    account: await accountToResponse(account), 
    transaction: transactionToResponse(transaction), 
    receipt: await receiptToResponse(transaction) 
  };
}

async function withdraw(accountId, amount, description = "Retrait espèces") {
  const amountCents = parseMoneyToCents(amount, { fieldName: "amount" });
  const account = await getAccountById(accountId);
  ensureActiveAccount(account);
  if (account.balanceCents < amountCents) throw new InsufficientFundsError("Fonds insuffisants");
  account.balanceCents -= amountCents;

  await db.run("UPDATE accounts SET balanceCents = ? WHERE id = ?", [account.balanceCents, accountId]);

  const transaction = await createTransaction({
    accountId,
    type: "WITHDRAWAL",
    amountCents,
    balanceAfterCents: account.balanceCents,
    description: cleanString(description, 140)
  });

  return { 
    account: await accountToResponse(account), 
    transaction: transactionToResponse(transaction), 
    receipt: await receiptToResponse(transaction) 
  };
}

async function transfer(payload) {
  const fromId = requireString(payload.fromAccountId, "fromAccountId");
  const transferType = TRANSFER_TYPES.has(payload.transferType) ? payload.transferType : "INTERNAL";
  const amountCents = parseMoneyToCents(payload.amount, { fieldName: "amount" });
  const fromAccount = await getAccountById(fromId);
  ensureActiveAccount(fromAccount);
  if (fromAccount.balanceCents < amountCents) throw new InsufficientFundsError("Fonds insuffisants");

  const description = cleanString(payload.description || "Virement", 140);
  fromAccount.balanceCents -= amountCents;

  if (transferType === "INTERNAL") {
    const toId = requireString(payload.toAccountId, "toAccountId");
    if (fromId === toId) throw new ValidationError("Les comptes source et destinataire doivent être différents");
    const toAccount = await getAccountById(toId);
    ensureActiveAccount(toAccount);
    toAccount.balanceCents += amountCents;

    await db.run("UPDATE accounts SET balanceCents = ? WHERE id = ?", [fromAccount.balanceCents, fromId]);
    await db.run("UPDATE accounts SET balanceCents = ? WHERE id = ?", [toAccount.balanceCents, toId]);

    const withdrawal = await createTransaction({
      accountId: fromId,
      relatedAccountId: toId,
      type: "TRANSFER_OUT",
      transferType,
      amountCents,
      balanceAfterCents: fromAccount.balanceCents,
      description
    });
    const depositTx = await createTransaction({
      accountId: toId,
      relatedAccountId: fromId,
      type: "TRANSFER_IN",
      transferType,
      amountCents,
      balanceAfterCents: toAccount.balanceCents,
      description
    });

    return {
      fromAccount: await accountToResponse(fromAccount),
      toAccount: await accountToResponse(toAccount),
      transactions: [transactionToResponse(withdrawal), transactionToResponse(depositTx)],
      receipt: await receiptToResponse(withdrawal)
    };
  }

  await db.run("UPDATE accounts SET balanceCents = ? WHERE id = ?", [fromAccount.balanceCents, fromId]);

  const transaction = await createTransaction({
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

  return {
    fromAccount: await accountToResponse(fromAccount),
    transactions: [transactionToResponse(transaction)],
    receipt: await receiptToResponse(transaction)
  };
}

async function getReceiptByTransactionId(id) {
  const transaction = await db.get("SELECT * FROM transactions WHERE id = ? OR receiptNumber = ?", [id, id]);
  if (!transaction) throw new NotFoundError("Reçu introuvable");
  return await receiptToResponse(transaction);
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
  getClientByEmail,
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