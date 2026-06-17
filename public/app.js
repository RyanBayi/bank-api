const state = {
  clients: [],
  accounts: [],
  transactions: [],
  summary: { clientCount: 0, accountCount: 0, transactionCount: 0, totalBalance: 0 },
  lastReceipt: null
};

const moneyFormatter = new Intl.NumberFormat("fr-CM", { style: "currency", currency: "XAF", maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

const selectors = {
  clientCount: document.querySelector("#clientCount"),
  accountCount: document.querySelector("#accountCount"),
  totalBalance: document.querySelector("#totalBalance"),
  transactionCount: document.querySelector("#transactionCount"),
  clientsList: document.querySelector("#clientsList"),
  accountsList: document.querySelector("#accountsList"),
  transactionsList: document.querySelector("#transactionsList"),
  clientForm: document.querySelector("#clientForm"),
  clientFormTitle: document.querySelector("#clientFormTitle"),
  clientSearchForm: document.querySelector("#clientSearchForm"),
  resetClientForm: document.querySelector("#resetClientForm"),
  accountForm: document.querySelector("#accountForm"),
  operationForm: document.querySelector("#operationForm"),
  operationAccountSearch: document.querySelector("#operationAccountSearch"),
  transferFromSearch: document.querySelector("#transferFromSearch"),
  transferToSearch: document.querySelector("#transferToSearch"),
  transferForm: document.querySelector("#transferForm"),
  transferType: document.querySelector("#transferType"),
  receiptBox: document.querySelector("#receiptBox"),
  printReceiptButton: document.querySelector("#printReceiptButton"),
  refreshButton: document.querySelector("#refreshButton"),
  themeToggle: document.querySelector("#themeToggle"),
  themeToggleLabel: document.querySelector("#themeToggleLabel"),
  toast: document.querySelector("#toast"),
  tabButtons: document.querySelectorAll(".tabButton"),
  tabPanels: document.querySelectorAll(".tabPanel")
};

const accountTypes = {
  CURRENT: "Compte courant",
  SAVINGS: "Compte épargne",
  BUSINESS: "Compte entreprise",
  JOINT: "Compte joint"
};

const kycLabels = {
  PENDING: "KYC en attente",
  VERIFIED: "KYC vérifié",
  REJECTED: "KYC rejeté"
};

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("darkTheme", isDark);
  selectors.themeToggle.setAttribute("aria-pressed", String(isDark));
  selectors.themeToggle.querySelector(".themeIcon").textContent = isDark ? "☀" : "☾";
  selectors.themeToggleLabel.textContent = isDark ? "Mode jour" : "Mode nuit";
}

function loadThemePreference() {
  const savedTheme = localStorage.getItem("bankTheme");
  if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function formatMoney(value) {
  return moneyFormatter.format(Number(value || 0));
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

function showToast(message, isError = false) {
  selectors.toast.textContent = message;
  selectors.toast.style.background = isError ? "#9b2f18" : "#20231f";
  selectors.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => selectors.toast.classList.remove("visible"), 3200);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Requête impossible");
  return payload;
}

function getFormPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function withLoading(form, task) {
  const button = form.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.classList.add("isLoading");
  }
  try {
    return await task();
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("isLoading");
    }
  }
}

function updateMetric(element, value) {
  const nextValue = String(value);
  if (element.textContent === nextValue) return;
  element.textContent = nextValue;
  element.classList.remove("valuePulse");
  void element.offsetWidth;
  element.classList.add("valuePulse");
}

function setTab(tabName) {
  selectors.tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
  selectors.tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `${tabName}Tab`));
}

function renderSummary() {
  updateMetric(selectors.clientCount, state.summary.clientCount || 0);
  updateMetric(selectors.accountCount, state.summary.accountCount || 0);
  updateMetric(selectors.totalBalance, formatMoney(state.summary.totalBalance));
  updateMetric(selectors.transactionCount, state.summary.transactionCount || 0);
}

function setClientSelectOptions(select) {
  select.innerHTML = "";
  if (!state.clients.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Aucun client disponible";
    select.append(option);
    return;
  }
  for (const client of state.clients) {
    const option = document.createElement("option");
    option.value = client.id;
    option.textContent = `${client.fullName} · ${kycLabels[client.kycStatus]}`;
    select.append(option);
  }
}

function setAccountSelectOptions(select, { excludeId, filterTerm } = {}) {
  select.innerHTML = "";
  let accounts = state.accounts.filter((account) => account.status !== "CLOSED" && account.id !== excludeId);

  if (filterTerm) {
    const term = filterTerm.toLowerCase();
    accounts = accounts.filter((acc) => 
      acc.clientName.toLowerCase().includes(term) || 
      acc.accountNumber.toLowerCase().includes(term)
    );
  }

  if (!accounts.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Aucun compte disponible";
    select.append(option);
    return;
  }
  for (const account of accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = `${account.clientName} (${account.accountNumber})`;
    select.append(option);
  }
}

function syncSelects() {
  setClientSelectOptions(selectors.accountForm.elements.clientId);
  setAccountSelectOptions(selectors.operationForm.elements.accountId, { 
    filterTerm: selectors.operationAccountSearch.value 
  });
  setAccountSelectOptions(selectors.transferForm.elements.fromAccountId, { 
    filterTerm: selectors.transferFromSearch.value 
  });
  setAccountSelectOptions(selectors.transferForm.elements.toAccountId, { 
    excludeId: selectors.transferForm.elements.fromAccountId.value,
    filterTerm: selectors.transferToSearch.value
  });
}

function renderClients() {
  selectors.clientsList.innerHTML = "";
  if (!state.clients.length) {
    selectors.clientsList.innerHTML = '<p class="emptyState">Ajoutez un client pour commencer.</p>';
    return;
  }
  state.clients.forEach((client, index) => {
    const row = document.createElement("article");
    row.className = "clientRow";
    row.style.setProperty("--row-index", index);
    row.innerHTML = `
      <div class="clientAvatar"></div>
      <div class="clientInfo">
        <div class="accountName"></div>
        <div class="accountId"></div>
        <div class="clientMeta"></div>
      </div>
      <div class="rowActions">
        ${client.kycStatus === "PENDING" ? '<button class="ghostButton verifyClientBtn" type="button">Vérifier</button>' : ""}
        <button class="ghostButton editClientBtn" type="button">Modifier</button>
        <button class="ghostButton archiveClientBtn" type="button">Archiver</button>
        <button class="ghostButton deleteClientBtn" type="button">Supprimer</button>
      </div>
    `;
    const avatar = row.querySelector(".clientAvatar");
    if (client.photo) avatar.style.backgroundImage = `url("${client.photo}")`;
    avatar.textContent = client.photo ? "" : `${client.firstName[0] || ""}${client.lastName[0] || ""}`;
    row.querySelector(".accountName").textContent = client.fullName;
    row.querySelector(".accountId").textContent = `${client.email || "email non renseigné"} · ${client.phone || "téléphone non renseigné"}`;
    row.querySelector(".clientMeta").textContent = `${kycLabels[client.kycStatus]} · ${client.accountCount} compte(s) · pièce ${client.identityNumber || "non renseignée"}`;
    if (client.kycStatus === "PENDING") {
      row.querySelector(".verifyClientBtn").addEventListener("click", () => verifyClient(client.id));
    }
    row.querySelector(".editClientBtn").addEventListener("click", () => fillClientForm(client));
    row.querySelector(".archiveClientBtn").addEventListener("click", () => archiveClient(client.id));
    row.querySelector(".deleteClientBtn").addEventListener("click", () => deleteClient(client.id));
    selectors.clientsList.append(row);
  });
}

function renderAccounts() {
  selectors.accountsList.innerHTML = "";
  if (!state.accounts.length) {
    selectors.accountsList.innerHTML = '<p class="emptyState">Ouvrez un compte bancaire pour un client.</p>';
    return;
  }
  state.accounts.forEach((account, index) => {
    const row = document.createElement("article");
    row.className = "accountRow";
    row.style.setProperty("--row-index", index);
    row.innerHTML = `
      <div class="accountMain">
        <div>
          <div class="accountName"></div>
          <div class="accountId"></div>
          <div class="clientMeta"></div>
        </div>
        <div class="balance"></div>
      </div>
      <div class="rowActions">
        <button class="ghostButton closeAccountBtn" type="button">Fermer</button>
        <button class="ghostButton deleteAccountBtn" type="button">Supprimer</button>
      </div>
    `;
    row.querySelector(".accountName").textContent = account.clientName;
    row.querySelector(".accountId").textContent = `${account.accountNumber} · ${accountTypes[account.type]}`;
    row.querySelector(".clientMeta").textContent = `Statut ${account.status} · ouvert le ${formatDate(account.openedAt)}`;
    row.querySelector(".balance").textContent = formatMoney(account.balance);
    row.querySelector(".closeAccountBtn").addEventListener("click", () => closeAccount(account.id));
    row.querySelector(".deleteAccountBtn").addEventListener("click", () => deleteAccount(account.id));
    selectors.accountsList.append(row);
  });
}

function transactionLabel(type) {
  return {
    DEPOSIT: "Dépôt",
    WITHDRAWAL: "Retrait",
    TRANSFER_OUT: "Virement envoyé",
    TRANSFER_IN: "Virement reçu",
    EXTERNAL_TRANSFER_OUT: "Virement externe",
    GATEWAY_TRANSFER_OUT: "Passerelle paiement"
  }[type] || type;
}

function isPositiveTransaction(type) {
  return type === "DEPOSIT" || type === "TRANSFER_IN";
}

function renderTransactions() {
  selectors.transactionsList.innerHTML = "";
  if (!state.transactions.length) {
    selectors.transactionsList.innerHTML = '<p class="emptyState">Aucune transaction pour le moment.</p>';
    return;
  }
  state.transactions.forEach((transaction, index) => {
    const row = document.createElement("article");
    const positive = isPositiveTransaction(transaction.type);
    row.className = "transactionRow";
    row.style.setProperty("--row-index", index);
    row.innerHTML = `
      <div class="transactionMain">
        <div>
          <div class="transactionType"></div>
          <div class="transactionMeta"></div>
        </div>
        <div class="amount ${positive ? "positive" : "negative"}"></div>
      </div>
      <div class="transactionDate"></div>
    `;
    row.querySelector(".transactionType").textContent = transactionLabel(transaction.type);
    row.querySelector(".transactionMeta").textContent = transaction.description || transaction.receiptNumber;
    row.querySelector(".amount").textContent = `${positive ? "+" : "-"} ${formatMoney(transaction.amount)}`;
    row.querySelector(".transactionDate").textContent = `${transaction.receiptNumber} · ${formatDate(transaction.createdAt)} · solde après ${formatMoney(transaction.balanceAfter)}`;
    selectors.transactionsList.append(row);
  });
}

function renderReceipt(receipt) {
  state.lastReceipt = receipt;
  if (!receipt) {
    selectors.receiptBox.className = "receiptBox emptyState";
    selectors.receiptBox.textContent = "Aucune opération récente.";
    return;
  }
  const tx = receipt.transaction;
  const client = receipt.client;
  const account = receipt.account;

  selectors.receiptBox.className = "receiptBox print-document";
  selectors.receiptBox.innerHTML = `
    <div class="receipt-header">
      <div class="bank-brand">ALTAS BANK</div>
      <div class="receipt-type">TICKET D'OPÉRATION</div>
    </div>
    
    <div class="receipt-body">
      <div class="receipt-section">
        <h3>CLIENT & COMPTE</h3>
        <p><span>Titulaire:</span> <strong>${client.fullName}</strong></p>
        <p><span>N° Compte:</span> <strong>${account.accountNumber}</strong></p>
      </div>
      
      <div class="receipt-section">
        <h3>TRANSACTION</h3>
        <p><span>Réf:</span> <strong>${tx.receiptNumber}</strong></p>
        <p><span>Type:</span> <strong>${transactionLabel(tx.type)}</strong></p>
        <p><span>Date:</span> <strong>${formatDate(tx.createdAt)}</strong></p>
      </div>

      <div class="receipt-amount-box">
        <div class="amount-line">
          <span>MONTANT</span>
          <strong>${formatMoney(tx.amount)}</strong>
        </div>
        <div class="amount-line total">
          <span>SOLDE FINAL</span>
          <strong>${formatMoney(tx.balanceAfter)}</strong>
        </div>
      </div>
    </div>
    
    <div class="receipt-footer">
      <p>Merci de votre confiance.</p>
      <p>ID: ${tx.id.slice(0, 8)}</p>
    </div>
  `;
}

function render() {
  renderSummary();
  renderClients();
  renderAccounts();
  renderTransactions();
  syncSelects();
  updateTransferFields();
}

async function loadDashboard(query = "") {
  const params = query ? `?q=${encodeURIComponent(query)}` : "";
  const [clients, accounts, transactions, summary] = await Promise.all([
    requestJson(`/api/clients${params}`),
    requestJson("/api/accounts"),
    requestJson("/api/transactions?limit=60"),
    requestJson("/api/summary")
  ]);
  state.clients = clients;
  state.accounts = accounts;
  state.transactions = transactions;
  state.summary = summary;
  render();
}

function fillClientForm(client) {
  selectors.clientFormTitle.textContent = "Modifier client";
  selectors.clientForm.elements.clientId.value = client.id;
  selectors.clientForm.elements.firstName.value = client.firstName;
  selectors.clientForm.elements.lastName.value = client.lastName;
  selectors.clientForm.elements.address.value = client.address || "";
  selectors.clientForm.elements.phone.value = client.phone || "";
  selectors.clientForm.elements.email.value = client.email || "";
  selectors.clientForm.elements.identityNumber.value = client.identityNumber || "";
  selectors.clientForm.elements.photo.value = client.photo || "";
  selectors.clientForm.elements.kycStatus.value = client.kycStatus;
  setTab("clients");
}

async function verifyClient(id) {
  if (!confirm("Marquer ce client comme vérifié ?")) return;
  try {
    await requestJson(`/api/clients/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ kycStatus: "VERIFIED" })
    });
    await loadDashboard();
    showToast("Client vérifié.");
  } catch (err) {
    showToast(err.message, true);
  }
}

function resetClientForm() {
  selectors.clientForm.reset();
  selectors.clientForm.elements.clientId.value = "";
  selectors.clientFormTitle.textContent = "Nouveau client";
}

async function archiveClient(id) {
  if (!confirm("Archiver ce client ?")) return;
  try {
    await requestJson(`/api/clients/${encodeURIComponent(id)}/archive`, { method: "POST", body: "{}" });
    await loadDashboard();
    showToast("Client archivé.");
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteClient(id) {
  if (!confirm("Supprimer ce client ? Les comptes actifs doivent être fermés.")) return;
  try {
    await requestJson(`/api/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadDashboard();
    showToast("Client supprimé.");
  } catch (err) {
    showToast(err.message, true);
  }
}

async function closeAccount(id) {
  if (!confirm("Fermer ce compte ? Le solde doit être à 0.")) return;
  try {
    await requestJson(`/api/accounts/${encodeURIComponent(id)}/close`, { method: "POST", body: "{}" });
    await loadDashboard();
    showToast("Compte fermé.");
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteAccount(id) {
  if (!confirm("Supprimer ce compte ? Le solde doit être à 0.")) return;
  try {
    await requestJson(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadDashboard();
    showToast("Compte supprimé.");
  } catch (err) {
    showToast(err.message, true);
  }
}

function updateTransferFields() {
  const type = selectors.transferType.value;
  document.querySelectorAll(".internalOnly").forEach((el) => el.hidden = type !== "INTERNAL");
  document.querySelectorAll(".externalOnly").forEach((el) => el.hidden = type === "INTERNAL");
  document.querySelectorAll(".bankOnly").forEach((el) => el.hidden = type !== "EXTERNAL_BANK");
  document.querySelectorAll(".gatewayOnly").forEach((el) => el.hidden = type !== "PAYMENT_GATEWAY");
  setAccountSelectOptions(selectors.transferForm.elements.toAccountId, { excludeId: selectors.transferForm.elements.fromAccountId.value });
}

selectors.operationAccountSearch.addEventListener("input", syncSelects);
selectors.transferFromSearch.addEventListener("input", syncSelects);
selectors.transferToSearch.addEventListener("input", syncSelects);

selectors.tabButtons.forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
});

selectors.clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = getFormPayload(form);
  const clientId = payload.clientId;
  delete payload.clientId;
  try {
    await withLoading(form, async () => {
      if (clientId) {
        await requestJson(`/api/clients/${encodeURIComponent(clientId)}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await requestJson("/api/clients", { method: "POST", body: JSON.stringify(payload) });
      }
      resetClientForm();
      await loadDashboard();
    });
    showToast(clientId ? "Client modifié." : "Client créé.");
  } catch (err) {
    showToast(err.message, true);
  }
});

selectors.clientSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await loadDashboard(getFormPayload(event.currentTarget).q);
  } catch (err) {
    showToast(err.message, true);
  }
});

selectors.resetClientForm.addEventListener("click", resetClientForm);

selectors.accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = getFormPayload(form);
  
  if (!payload.clientId) {
    showToast("Veuillez d'abord sélectionner ou créer un client.", true);
    return;
  }

  try {
    await withLoading(form, async () => {
      await requestJson("/api/accounts", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      await loadDashboard();
    });
    showToast("Compte ouvert.");
  } catch (err) {
    showToast(err.message, true);
  }
});

selectors.operationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = getFormPayload(form);
  try {
    await withLoading(form, async () => {
      const result = await requestJson(`/api/accounts/${encodeURIComponent(payload.accountId)}/${payload.operationType}`, {
        method: "POST",
        body: JSON.stringify({ amount: payload.amount, description: payload.description })
      });
      renderReceipt(result.receipt);
      form.elements.amount.value = "";
      form.elements.description.value = "";
      await loadDashboard();
    });
    showToast("Opération validée.");
  } catch (err) {
    showToast(err.message, true);
  }
});

selectors.transferForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = getFormPayload(form);
  if (payload.transferType === "INTERNAL") {
    delete payload.beneficiaryName;
    delete payload.destinationBank;
    delete payload.gatewayName;
    delete payload.gatewayReference;
  }
  try {
    await withLoading(form, async () => {
      const result = await requestJson("/api/transfers", { method: "POST", body: JSON.stringify(payload) });
      renderReceipt(result.receipt);
      form.elements.amount.value = "";
      form.elements.description.value = "";
      await loadDashboard();
    });
    showToast("Transfert effectué.");
  } catch (err) {
    showToast(err.message, true);
  }
});

selectors.transferType.addEventListener("change", updateTransferFields);
selectors.transferForm.elements.fromAccountId.addEventListener("change", updateTransferFields);

selectors.printReceiptButton.addEventListener("click", () => {
  if (!state.lastReceipt) {
    showToast("Aucun reçu à imprimer.", true);
    return;
  }
  window.print();
});

selectors.refreshButton.addEventListener("click", () => {
  loadDashboard().then(() => showToast("Données actualisées.")).catch((err) => showToast(err.message, true));
});

selectors.themeToggle.addEventListener("click", () => {
  const nextTheme = document.body.classList.contains("darkTheme") ? "light" : "dark";
  localStorage.setItem("bankTheme", nextTheme);
  applyTheme(nextTheme);
});

applyTheme(loadThemePreference());
loadDashboard().catch((err) => showToast(err.message, true));
