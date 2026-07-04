package com.bank.api.service;

import com.bank.api.exception.*;
import com.bank.api.model.*;
import com.bank.api.repository.DatabaseManager;
import org.springframework.stereotype.Service;

import java.sql.*;
import java.time.Instant;
import java.util.*;

@Service
public class TransferService {

    private final DatabaseManager db;

    public TransferService(DatabaseManager db) {
        this.db = db;
    }

    static final Set<String> TRANSFER_TYPES = Set.of("INTERNAL", "EXTERNAL_BANK", "PAYMENT_GATEWAY");
    static final Set<String> ACCOUNT_TYPES = Set.of("CURRENT", "SAVINGS", "BUSINESS", "JOINT");

    // ── Transfer ──────────────────────────────────────────────

    public TransferResult transfer(TransferRequest req) {
        try (Connection conn = db.getConnection()) {
            conn.setAutoCommit(false);
            try {
                TransferResult result = doTransfer(conn, req);
                conn.commit();
                return result;
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    private TransferResult doTransfer(Connection conn, TransferRequest req) throws SQLException {
        String fromId = requireString(req.fromAccountId(), "fromAccountId");
        String transferType = TRANSFER_TYPES.contains(req.transferType()) ? req.transferType() : "INTERNAL";
        long amountCents = parseMoneyToCents(req.amount(), "amount");
        String description = cleanString(req.description(), 140, "Virement");

        AccountRow fromAccount = getAccountById(conn, fromId);
        ensureActive(fromAccount);
        if (fromAccount.balanceCents < amountCents) {
            throw new InsufficientFundsException("Fonds insuffisants");
        }

        long newFromBalance = fromAccount.balanceCents - amountCents;
        updateBalance(conn, fromId, newFromBalance);

        if ("INTERNAL".equals(transferType)) {
            String toId = requireString(req.toAccountId(), "toAccountId");
            if (fromId.equals(toId)) {
                throw new ValidationException("Les comptes source et destinataire doivent être différents");
            }
            AccountRow toAccount = getAccountById(conn, toId);
            ensureActive(toAccount);
            long newToBalance = toAccount.balanceCents + amountCents;
            updateBalance(conn, toId, newToBalance);

            TxRow withdrawal = createTransaction(conn, fromId, toId, "TRANSFER_OUT", transferType,
                    amountCents, newFromBalance, description, null, null, null, null);
            TxRow depositTx = createTransaction(conn, toId, fromId, "TRANSFER_IN", transferType,
                    amountCents, newToBalance, description, null, null, null, null);

            toAccount = getAccountById(conn, toId);
            fromAccount = getAccountById(conn, fromId);

            return new TransferResult(
                    toAccountResponse(fromAccount, conn),
                    toAccountResponse(toAccount, conn),
                    List.of(toTransactionResponse(withdrawal), toTransactionResponse(depositTx)),
                    toReceipt(withdrawal, conn)
            );
        }

        String txType = "PAYMENT_GATEWAY".equals(transferType) ? "GATEWAY_TRANSFER_OUT" : "EXTERNAL_TRANSFER_OUT";
        String beneficiary = requireString(req.beneficiaryName(), "beneficiaryName", 140);
        String bank = cleanString(req.destinationBank(), 120, null);
        String gwName = cleanString(req.gatewayName(), 120, null);
        String gwRef = cleanString(req.gatewayReference(), 120, null);

        TxRow tx = createTransaction(conn, fromId, null, txType, transferType,
                amountCents, newFromBalance, description, bank, beneficiary, gwName, gwRef);

        fromAccount = getAccountById(conn, fromId);
        return new TransferResult(
                toAccountResponse(fromAccount, conn),
                null,
                List.of(toTransactionResponse(tx)),
                toReceipt(tx, conn)
        );
    }

    // ── Deposit ───────────────────────────────────────────────

    public OperationResult deposit(String accountId, double amount, String description) {
        try (Connection conn = db.getConnection()) {
            conn.setAutoCommit(false);
            try {
                long amountCents = parseMoneyToCents(amount, "amount");
                AccountRow account = getAccountById(conn, accountId);
                ensureActive(account);
                long newBalance = account.balanceCents + amountCents;
                updateBalance(conn, accountId, newBalance);

                TxRow tx = createTransaction(conn, accountId, null, "DEPOSIT", null,
                        amountCents, newBalance,
                        cleanString(description, 140, "Dépôt espèces"),
                        null, null, null, null);

                conn.commit();
                account = getAccountById(conn, accountId);
                return new OperationResult(
                        toAccountResponse(account, conn),
                        toTransactionResponse(tx),
                        toReceipt(tx, conn)
                );
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    // ── Withdraw ──────────────────────────────────────────────

    public OperationResult withdraw(String accountId, double amount, String description) {
        try (Connection conn = db.getConnection()) {
            conn.setAutoCommit(false);
            try {
                long amountCents = parseMoneyToCents(amount, "amount");
                AccountRow account = getAccountById(conn, accountId);
                ensureActive(account);
                if (account.balanceCents < amountCents) {
                    throw new InsufficientFundsException("Fonds insuffisants");
                }
                long newBalance = account.balanceCents - amountCents;
                updateBalance(conn, accountId, newBalance);

                TxRow tx = createTransaction(conn, accountId, null, "WITHDRAWAL", null,
                        amountCents, newBalance,
                        cleanString(description, 140, "Retrait espèces"),
                        null, null, null, null);

                conn.commit();
                account = getAccountById(conn, accountId);
                return new OperationResult(
                        toAccountResponse(account, conn),
                        toTransactionResponse(tx),
                        toReceipt(tx, conn)
                );
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    // ── Transactions ──────────────────────────────────────────

    public List<Transaction> listTransactions(String accountId, int limit) {
        int safeLimit = (limit > 0 && limit <= 500) ? limit : 100;
        try (Connection conn = db.getConnection()) {
            if (accountId != null && !accountId.isBlank()) {
                getAccountById(conn, accountId); // validates exists
                try (PreparedStatement ps = conn.prepareStatement(
                        "SELECT * FROM transactions WHERE account_id = ? OR related_account_id = ? ORDER BY created_at DESC LIMIT ?")) {
                    ps.setString(1, accountId);
                    ps.setString(2, accountId);
                    ps.setInt(3, safeLimit);
                    return mapTransactions(ps);
                }
            } else {
                try (PreparedStatement ps = conn.prepareStatement(
                        "SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?")) {
                    ps.setInt(1, safeLimit);
                    return mapTransactions(ps);
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    private List<Transaction> mapTransactions(PreparedStatement ps) throws SQLException {
        List<Transaction> list = new ArrayList<>();
        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                list.add(new Transaction(
                        rs.getString("id"), rs.getString("receipt_number"),
                        rs.getString("account_id"), rs.getString("related_account_id"),
                        rs.getString("type"), rs.getString("transfer_type"),
                        rs.getLong("amount_cents") / 100.0,
                        rs.getLong("balance_after_cents") / 100.0,
                        parseInstant(rs.getString("created_at")),
                        nz(rs.getString("description")), nz(rs.getString("destination_bank")),
                        nz(rs.getString("beneficiary_name")), nz(rs.getString("gateway_name")),
                        nz(rs.getString("gateway_reference"))
                ));
            }
        }
        return list;
    }

    // ── Receipt ───────────────────────────────────────────────

    public Receipt getReceiptByTransactionId(String id) {
        try (Connection conn = db.getConnection()) {
            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT * FROM transactions WHERE id = ? OR receipt_number = ?")) {
                ps.setString(1, id);
                ps.setString(2, id);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) throw new NotFoundException("Reçu introuvable");
                    TxRow tx = new TxRow(
                            rs.getString("id"), rs.getString("receipt_number"),
                            rs.getString("account_id"), rs.getString("related_account_id"),
                            rs.getString("type"), rs.getString("transfer_type"),
                            rs.getLong("amount_cents"), rs.getLong("balance_after_cents"),
                            rs.getString("created_at"), rs.getString("description"),
                            rs.getString("destination_bank"), rs.getString("beneficiary_name"),
                            rs.getString("gateway_name"), rs.getString("gateway_reference")
                    );
                    return toReceipt(tx, conn);
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    // ── Summary ───────────────────────────────────────────────

    public Summary getSummary() {
        try (Connection conn = db.getConnection();
             Statement stmt = conn.createStatement()) {

            int clientCount, archivedCount, accountCount, closedCount, txCount;
            double totalBalance;

            try (ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM clients WHERE archived = 0")) {
                clientCount = rs.next() ? rs.getInt(1) : 0;
            }
            try (ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM clients WHERE archived = 1")) {
                archivedCount = rs.next() ? rs.getInt(1) : 0;
            }
            try (ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM accounts WHERE status != 'CLOSED'")) {
                accountCount = rs.next() ? rs.getInt(1) : 0;
            }
            try (ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM accounts WHERE status = 'CLOSED'")) {
                closedCount = rs.next() ? rs.getInt(1) : 0;
            }
            try (ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM transactions")) {
                txCount = rs.next() ? rs.getInt(1) : 0;
            }
            try (ResultSet rs = stmt.executeQuery("SELECT COALESCE(SUM(balance_cents), 0) FROM accounts WHERE status != 'CLOSED'")) {
                totalBalance = rs.next() ? rs.getLong(1) / 100.0 : 0;
            }

            return new Summary(clientCount, archivedCount, accountCount, closedCount, txCount, totalBalance);
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    // ── DB helpers ────────────────────────────────────────────

    record AccountRow(String id, String clientId, String ownerName, String accountNumber,
                      String type, String status, long balanceCents, String openedAt,
                      String closedAt, String createdAt) {}

    record TxRow(String id, String receiptNumber, String accountId, String relatedAccountId,
                 String type, String transferType, long amountCents, long balanceAfterCents,
                 String createdAt, String desc, String destBank, String benName,
                 String gwName, String gwRef) {}

    AccountRow getAccountById(Connection conn, String id) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT * FROM accounts WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new NotFoundException("Compte introuvable");
                return new AccountRow(
                        rs.getString("id"), rs.getString("client_id"), rs.getString("owner_name"),
                        rs.getString("account_number"), rs.getString("type"), rs.getString("status"),
                        rs.getLong("balance_cents"), rs.getString("opened_at"),
                        rs.getString("closed_at"), rs.getString("created_at")
                );
            }
        }
    }

    void ensureActive(AccountRow acc) {
        if ("CLOSED".equals(acc.status())) throw new ValidationException("Compte fermé");
    }

    void updateBalance(Connection conn, String accountId, long balanceCents) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE accounts SET balance_cents = ? WHERE id = ?")) {
            ps.setLong(1, balanceCents);
            ps.setString(2, accountId);
            ps.executeUpdate();
        }
    }

    TxRow createTransaction(Connection conn, String accountId, String relatedAccountId,
                            String type, String transferType, long amountCents, long balanceAfterCents,
                            String description, String destinationBank, String beneficiaryName,
                            String gatewayName, String gatewayReference) throws SQLException {
        String id = UUID.randomUUID().toString();
        String receiptNumber = "REC-" + Instant.now().toString().substring(0, 10).replace("-", "") +
                "-" + (100000 + new Random().nextInt(900000));
        String now = Instant.now().toString();

        try (PreparedStatement ps = conn.prepareStatement("""
                INSERT INTO transactions (id, receipt_number, account_id, related_account_id,
                type, transfer_type, amount_cents, balance_after_cents, created_at,
                description, destination_bank, beneficiary_name, gateway_name, gateway_reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            ps.setString(1, id);
            ps.setString(2, receiptNumber);
            ps.setString(3, accountId);
            ps.setString(4, relatedAccountId);
            ps.setString(5, type);
            ps.setString(6, transferType);
            ps.setLong(7, amountCents);
            ps.setLong(8, balanceAfterCents);
            ps.setString(9, now);
            ps.setString(10, description);
            ps.setString(11, destinationBank);
            ps.setString(12, beneficiaryName);
            ps.setString(13, gatewayName);
            ps.setString(14, gatewayReference);
            ps.executeUpdate();
        }

        return new TxRow(id, receiptNumber, accountId, relatedAccountId, type, transferType,
                amountCents, balanceAfterCents, now, description, destinationBank,
                beneficiaryName, gatewayName, gatewayReference);
    }

    // ── Response builders ─────────────────────────────────────

    Account toAccountResponse(AccountRow row, Connection conn) throws SQLException {
        String clientName = row.ownerName();
        if (row.clientId() != null) {
            try (PreparedStatement ps = conn.prepareStatement("SELECT first_name, last_name FROM clients WHERE id = ?")) {
                ps.setString(1, row.clientId());
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        clientName = (rs.getString("first_name") + " " + rs.getString("last_name")).trim();
                    }
                }
            }
        }
        return new Account(row.id(), row.clientId(), clientName, clientName,
                row.accountNumber(), row.type(), row.status(),
                row.balanceCents() / 100.0, parseInstant(row.openedAt()),
                parseInstant(row.closedAt()), parseInstant(row.createdAt()));
    }

    Transaction toTransactionResponse(TxRow tx) {
        return new Transaction(tx.id(), tx.receiptNumber(), tx.accountId(), tx.relatedAccountId(),
                tx.type(), tx.transferType(), tx.amountCents() / 100.0, tx.balanceAfterCents() / 100.0,
                parseInstant(tx.createdAt()), nz(tx.desc()), nz(tx.destBank()), nz(tx.benName()),
                nz(tx.gwName()), nz(tx.gwRef()));
    }

    Receipt toReceipt(TxRow tx, Connection conn) throws SQLException {
        AccountRow account = getAccountById(conn, tx.accountId());
        Client client = null;
        if (account.clientId() != null) {
            try (PreparedStatement ps = conn.prepareStatement("SELECT * FROM clients WHERE id = ?")) {
                ps.setString(1, account.clientId());
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        String fullName = (rs.getString("first_name") + " " + rs.getString("last_name")).trim();
                        client = new Client(rs.getString("id"), rs.getString("first_name"),
                                rs.getString("last_name"), fullName,
                                nz(rs.getString("address")), nz(rs.getString("phone")), nz(rs.getString("email")),
                                nz(rs.getString("identity_number")), nz(rs.getString("photo")),
                                rs.getString("kyc_status"), rs.getInt("archived") != 0, 0,
                                parseInstant(rs.getString("created_at")), parseInstant(rs.getString("updated_at")));
                    }
                }
            }
        }
        return new Receipt(tx.receiptNumber(), toTransactionResponse(tx),
                toAccountResponse(account, conn), client, Instant.now());
    }

    // ── Validation helpers ────────────────────────────────────

    static long parseMoneyToCents(double value, String fieldName) {
        if (value <= 0) throw new ValidationException(fieldName + " doit être > 0");
        long cents = Math.round(value * 100);
        if (cents <= 0) throw new ValidationException(fieldName + " doit être > 0");
        return cents;
    }

    static long parseMoneyToCentsAllowZero(double value, String fieldName) {
        if (value < 0) throw new ValidationException(fieldName + " doit être >= 0");
        return Math.round(value * 100);
    }

    static String cleanString(String value, int max, String fallback) {
        if (value == null || value.isBlank()) return fallback;
        return value.trim().length() > max ? value.trim().substring(0, max) : value.trim();
    }

    static String requireString(String value, String fieldName) {
        return requireString(value, fieldName, 180);
    }

    static String requireString(String value, String fieldName, int max) {
        String cleaned = cleanString(value, max, null);
        if (cleaned == null || cleaned.isEmpty()) throw new ValidationException(fieldName + " est obligatoire");
        return cleaned;
    }

    static String generateAccountNumber() {
        return "ALT-" + String.format("%06d", System.currentTimeMillis() % 1_000_000)
                + "-" + (1000 + new Random().nextInt(9000));
    }

    static Instant parseInstant(String iso) {
        return iso != null && !iso.isEmpty() ? Instant.parse(iso) : null;
    }

    static String nz(String s) { return s == null ? "" : s; }
}
