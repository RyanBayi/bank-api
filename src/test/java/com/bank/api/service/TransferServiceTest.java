package com.bank.api.service;

import com.bank.api.exception.*;
import com.bank.api.model.*;
import com.bank.api.repository.DatabaseManager;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;

import java.sql.*;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class TransferServiceTest {

    // In-memory SQLite for tests
    private static DatabaseManager db;
    private TransferService transferService;
    private ClientService clientService;
    private AccountService accountService;
    private Connection conn;

    @BeforeAll
    static void initDb() throws Exception {
        db = new DatabaseManager();
        ReflectionTestUtils.setField(db, "url", "jdbc:sqlite:target/test_transfer.db");
        db.init();
    }

    @BeforeEach
    void setUp() throws Exception {
        conn = db.getConnection();
        // Clean slate
        try (Statement stmt = conn.createStatement()) {
            stmt.execute("DELETE FROM transactions");
            stmt.execute("DELETE FROM accounts");
            stmt.execute("DELETE FROM clients");
        }
        transferService = new TransferService(db);
        clientService = new ClientService(db);
        accountService = new AccountService(db, clientService, transferService);
    }

    @AfterAll
    static void tearDownClass() throws Exception {
        new java.io.File("target/test_transfer.db").delete();
    }

    // ── Deposit ───────────────────────────────────────────────

    @Test
    void deposit_shouldIncreaseBalance() {
        Client client = clientService.createClient(new ClientInput(
                "Jean", "Dupont", "", "", "jean@test.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 0, null, null, null, null, null, null, null, null));

        OperationResult result = transferService.deposit(account.id(), 100.0, "Dépôt test");

        assertEquals(100.0, result.account().balance());
        assertEquals("DEPOSIT", result.transaction().type());
        assertNotNull(result.receipt());
        assertNotNull(result.receipt().receiptNumber());
    }

    @Test
    void deposit_negativeAmount_shouldThrow() {
        Client client = clientService.createClient(new ClientInput(
                "Jean", "Dupont", "", "", "jean2@test.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 0, null, null, null, null, null, null, null, null));

        assertThrows(ValidationException.class, () ->
                transferService.deposit(account.id(), -10.0, "Dépôt négatif"));
    }

    @Test
    void deposit_zeroAmount_shouldThrow() {
        Client client = clientService.createClient(new ClientInput(
                "Jean", "Dupont", "", "", "jean3@test.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 0, null, null, null, null, null, null, null, null));

        assertThrows(ValidationException.class, () ->
                transferService.deposit(account.id(), 0, "Dépôt zéro"));
    }

    @Test
    void deposit_closedAccount_shouldThrow() {
        Client client = clientService.createClient(new ClientInput(
                "Jean", "Dupont", "", "", "jean4@test.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 0, null, null, null, null, null, null, null, null));
        accountService.closeAccount(account.id());

        assertThrows(ValidationException.class, () ->
                transferService.deposit(account.id(), 50.0, "Dépôt compte fermé"));
    }

    // ── Withdraw ──────────────────────────────────────────────

    @Test
    void withdraw_shouldDecreaseBalance() {
        Client client = clientService.createClient(new ClientInput(
                "Marie", "Curie", "", "", "marie@test.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 500.0, null, null, null, null, null, null, null, null));

        OperationResult result = transferService.withdraw(account.id(), 200.0, "Retrait test");

        assertEquals(300.0, result.account().balance());
        assertEquals("WITHDRAWAL", result.transaction().type());
        assertNotNull(result.receipt());
    }

    @Test
    void withdraw_insufficientFunds_shouldThrow() {
        Client client = clientService.createClient(new ClientInput(
                "Marie", "Curie", "", "", "marie2@test.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 100.0, null, null, null, null, null, null, null, null));

        assertThrows(InsufficientFundsException.class, () ->
                transferService.withdraw(account.id(), 150.0, "Retrait excessif"));
    }

    // ── Transfer ──────────────────────────────────────────────

    @Test
    void internalTransfer_shouldMoveMoney() {
        Client c1 = clientService.createClient(new ClientInput(
                "Alice", "Martin", "", "", "alice@test.com", "", "", "PENDING"));
        Client c2 = clientService.createClient(new ClientInput(
                "Bob", "Robert", "", "", "bob@test.com", "", "", "PENDING"));
        Account a1 = accountService.createAccount(new CreateAccountRequest(
                c1.id(), "CURRENT", 1000.0, null, null, null, null, null, null, null, null));
        Account a2 = accountService.createAccount(new CreateAccountRequest(
                c2.id(), "SAVINGS", 500.0, null, null, null, null, null, null, null, null));

        TransferResult result = transferService.transfer(new TransferRequest(
                a1.id(), a2.id(), "INTERNAL", 300.0, null, null, null, null, "Virement test"));

        assertEquals(700.0, result.fromAccount().balance());
        assertEquals(800.0, result.toAccount().balance());
        assertEquals(2, result.transactions().size());
        assertEquals("TRANSFER_OUT", result.transactions().get(0).type());
        assertEquals("TRANSFER_IN", result.transactions().get(1).type());
        assertNotNull(result.receipt());
    }

    @Test
    void transfer_sameAccount_shouldThrow() {
        Client client = clientService.createClient(new ClientInput(
                "Test", "User", "", "", "test@transfer.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 500.0, null, null, null, null, null, null, null, null));

        assertThrows(ValidationException.class, () ->
                transferService.transfer(new TransferRequest(
                        account.id(), account.id(), "INTERNAL", 100.0, null, null, null, null, null)));
    }

    @Test
    void transfer_insufficientFunds_shouldThrow() {
        Client c1 = clientService.createClient(new ClientInput(
                "Poor", "User", "", "", "poor@test.com", "", "", "PENDING"));
        Client c2 = clientService.createClient(new ClientInput(
                "Rich", "User", "", "", "rich@test.com", "", "", "PENDING"));
        Account a1 = accountService.createAccount(new CreateAccountRequest(
                c1.id(), "CURRENT", 50.0, null, null, null, null, null, null, null, null));
        Account a2 = accountService.createAccount(new CreateAccountRequest(
                c2.id(), "SAVINGS", 5000.0, null, null, null, null, null, null, null, null));

        assertThrows(InsufficientFundsException.class, () ->
                transferService.transfer(new TransferRequest(
                        a1.id(), a2.id(), "INTERNAL", 100.0, null, null, null, null, null)));
    }

    // ── Transactions ──────────────────────────────────────────

    @Test
    void listTransactions_shouldReturnHistory() {
        Client client = clientService.createClient(new ClientInput(
                "Histo", "User", "", "", "histo@test.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 500.0, null, null, null, null, null, null, null, null));

        transferService.deposit(account.id(), 100.0, "Dépôt 1");
        transferService.withdraw(account.id(), 50.0, "Retrait 1");

        List<Transaction> txs = transferService.listTransactions(account.id(), 100);
        assertTrue(txs.size() >= 2);
    }

    // ── Receipt ───────────────────────────────────────────────

    @Test
    void getReceipt_shouldReturnReceipt() {
        Client client = clientService.createClient(new ClientInput(
                "Receipt", "User", "", "", "receipt@test.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 100.0, null, null, null, null, null, null, null, null));

        OperationResult op = transferService.deposit(account.id(), 50.0, "Test");
        Receipt receipt = transferService.getReceiptByTransactionId(op.transaction().id());

        assertEquals(op.transaction().id(), receipt.transaction().id());
        assertNotNull(receipt.receiptNumber());
        assertNotNull(receipt.account());
        assertEquals(150.0, receipt.account().balance());
    }

    @Test
    void getReceipt_notFound_shouldThrow() {
        assertThrows(NotFoundException.class, () ->
                transferService.getReceiptByTransactionId("nonexistent-id"));
    }

    @Test
    void getReceipt_byReceiptNumber_shouldWork() {
        Client client = clientService.createClient(new ClientInput(
                "Rec2", "User", "", "", "rec2@test.com", "", "", "PENDING"));
        Account account = accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 100.0, null, null, null, null, null, null, null, null));

        OperationResult op = transferService.deposit(account.id(), 50.0, "Test");
        Receipt receipt = transferService.getReceiptByTransactionId(op.receipt().receiptNumber());

        assertEquals(op.transaction().id(), receipt.transaction().id());
    }

    // ── Summary ───────────────────────────────────────────────

    @Test
    void getSummary_shouldReturnStats() {
        Client client = clientService.createClient(new ClientInput(
                "Sum", "User", "", "", "sum@test.com", "", "", "PENDING"));
        accountService.createAccount(new CreateAccountRequest(
                client.id(), "CURRENT", 100.0, null, null, null, null, null, null, null, null));

        Summary summary = transferService.getSummary();

        assertTrue(summary.clientCount() >= 1);
        assertTrue(summary.accountCount() >= 1);
        assertTrue(summary.totalBalance() >= 100.0);
    }
}
