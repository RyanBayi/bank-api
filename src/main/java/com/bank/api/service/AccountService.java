package com.bank.api.service;

import com.bank.api.exception.*;
import com.bank.api.model.*;
import com.bank.api.repository.DatabaseManager;
import org.springframework.stereotype.Service;

import java.sql.*;
import java.time.Instant;
import java.util.*;

@Service
public class AccountService {

    private final DatabaseManager db;
    private final ClientService clientService;
    private final TransferService transferService;

    public AccountService(DatabaseManager db, ClientService clientService, TransferService transferService) {
        this.db = db;
        this.clientService = clientService;
        this.transferService = transferService;
    }

    // ── Create ────────────────────────────────────────────────

    public Account createAccount(CreateAccountRequest req) {
        try (Connection conn = db.getConnection()) {
            conn.setAutoCommit(false);
            try {
                Account result = doCreateAccount(conn, req);
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

    private Account doCreateAccount(Connection conn, CreateAccountRequest req) throws SQLException {
        String clientId = TransferService.cleanString(req.clientId(), 80, null);
        ClientService.ClientRow client = null;

        if (clientId != null && !clientId.isEmpty()) {
            client = clientService.getClientByIdInternal(conn, clientId);
        }

        if (client == null) {
            // implicit client creation
            String cid = UUID.randomUUID().toString();
            String now = Instant.now().toString();
            String firstName = TransferService.requireString(
                    req.firstName() != null ? req.firstName() : req.type(), "firstName");
            String lastName = TransferService.requireString(
                    req.lastName() != null ? req.lastName() : "Altas", "lastName");

            try (PreparedStatement ps = conn.prepareStatement("""
                    INSERT INTO clients (id, first_name, last_name, address, phone, email,
                    identity_number, photo, kyc_status, archived, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                    """)) {
                ps.setString(1, cid);
                ps.setString(2, firstName);
                ps.setString(3, lastName);
                ps.setString(4, TransferService.cleanString(req.address(), 240, ""));
                ps.setString(5, TransferService.cleanString(req.phone(), 40, ""));
                ps.setString(6, TransferService.cleanString(req.email(), 160, ""));
                ps.setString(7, TransferService.cleanString(req.identityNumber(), 80, ""));
                ps.setString(8, TransferService.cleanString(req.photo(), 1200, ""));
                ps.setString(9, Set.of("PENDING", "VERIFIED", "REJECTED").contains(req.kycStatus())
                        ? req.kycStatus() : "PENDING");
                ps.setString(10, now);
                ps.setString(11, now);
                ps.executeUpdate();
            }
            client = clientService.getClientByIdInternal(conn, cid);
        }

        if (client.archived()) throw new ValidationException(
                "Impossible d'ouvrir un compte pour un client archivé");

        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT id FROM accounts WHERE client_id = ? AND status != 'CLOSED'")) {
            ps.setString(1, client.id());
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) throw new ValidationException(
                        "Ce client possède déjà un compte actif. Une seule relation bancaire par client est autorisée.");
            }
        }

        String type = TransferService.ACCOUNT_TYPES.contains(req.type()) ? req.type() : "CURRENT";
        long initialDepositCents = TransferService.parseMoneyToCentsAllowZero(req.initialDeposit(), "initialDeposit");
        String now = Instant.now().toString();
        String accountId = UUID.randomUUID().toString();
        String accountNumber = TransferService.generateAccountNumber();

        try (PreparedStatement ps = conn.prepareStatement("""
                INSERT INTO accounts (id, client_id, owner_name, account_number, type, status,
                balance_cents, opened_at, created_at)
                VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
                """)) {
            String fullName = (client.firstName() + " " + client.lastName()).trim();
            ps.setString(1, accountId);
            ps.setString(2, client.id());
            ps.setString(3, fullName);
            ps.setString(4, accountNumber);
            ps.setString(5, type);
            ps.setLong(6, initialDepositCents);
            ps.setString(7, now);
            ps.setString(8, now);
            ps.executeUpdate();
        }

        if (initialDepositCents > 0) {
            transferService.createTransaction(conn, accountId, null, "DEPOSIT", null,
                    initialDepositCents, initialDepositCents,
                    "Dépôt initial à l'ouverture du compte",
                    null, null, null, null);
        }

        return toAccountResponse(getAccountByIdInternal(conn, accountId), conn);
    }

    // ── Read ──────────────────────────────────────────────────

    public Account getAccountById(String id) {
        try (Connection conn = db.getConnection()) {
            return toAccountResponse(getAccountByIdInternal(conn, id), conn);
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    public List<Account> listAccounts(String clientId, boolean includeClosed) {
        try (Connection conn = db.getConnection()) {
            StringBuilder query = new StringBuilder("SELECT * FROM accounts WHERE 1=1");
            List<String> params = new ArrayList<>();

            if (clientId != null && !clientId.isBlank()) {
                clientService.getClientByIdInternal(conn, clientId); // validates exists
                query.append(" AND client_id = ?");
                params.add(clientId);
            }
            if (!includeClosed) query.append(" AND status != 'CLOSED'");
            query.append(" ORDER BY opened_at DESC");

            try (PreparedStatement ps = conn.prepareStatement(query.toString())) {
                for (int i = 0; i < params.size(); i++) ps.setString(i + 1, params.get(i));
                try (ResultSet rs = ps.executeQuery()) {
                    List<Account> accounts = new ArrayList<>();
                    while (rs.next()) accounts.add(toAccountResponse(mapAccountRow(rs), conn));
                    return accounts;
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    // ── Close / Delete ────────────────────────────────────────

    public Account closeAccount(String id) {
        try (Connection conn = db.getConnection()) {
            AccountRow account = getAccountByIdInternal(conn, id);
            if ("CLOSED".equals(account.status)) return toAccountResponse(account, conn);
            if (account.balanceCents != 0) throw new ValidationException(
                    "Le solde doit être à 0 avant fermeture");

            try (PreparedStatement ps = conn.prepareStatement(
                    "UPDATE accounts SET status = 'CLOSED' WHERE id = ?")) {
                ps.setString(1, id);
                ps.executeUpdate();
            }
            return toAccountResponse(getAccountByIdInternal(conn, id), conn);
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    public void deleteAccount(String id) {
        try (Connection conn = db.getConnection()) {
            conn.setAutoCommit(false);
            try {
                AccountRow account = getAccountByIdInternal(conn, id);
                if (account.balanceCents != 0) throw new ValidationException(
                        "Le solde doit être à 0 avant suppression");

                try (PreparedStatement ps = conn.prepareStatement(
                        "DELETE FROM transactions WHERE account_id = ? OR related_account_id = ?")) {
                    ps.setString(1, id);
                    ps.setString(2, id);
                    ps.executeUpdate();
                }
                try (PreparedStatement ps = conn.prepareStatement(
                        "DELETE FROM accounts WHERE id = ?")) {
                    ps.setString(1, id);
                    ps.executeUpdate();
                }
                conn.commit();
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    // ── Internal helpers ──────────────────────────────────────

    record AccountRow(String id, String clientId, String ownerName, String accountNumber,
                      String type, String status, long balanceCents, String openedAt,
                      String closedAt, String createdAt) {}

    private AccountRow mapAccountRow(ResultSet rs) throws SQLException {
        return new AccountRow(
                rs.getString("id"), rs.getString("client_id"), rs.getString("owner_name"),
                rs.getString("account_number"), rs.getString("type"), rs.getString("status"),
                rs.getLong("balance_cents"), rs.getString("opened_at"),
                rs.getString("closed_at"), rs.getString("created_at")
        );
    }

    AccountRow getAccountByIdInternal(Connection conn, String id) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("SELECT * FROM accounts WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new NotFoundException("Compte introuvable");
                return mapAccountRow(rs);
            }
        }
    }

    Account toAccountResponse(AccountRow row, Connection conn) throws SQLException {
        String clientName = row.ownerName();
        if (row.clientId() != null) {
            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT first_name, last_name FROM clients WHERE id = ?")) {
                ps.setString(1, row.clientId());
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        clientName = (rs.getString("first_name") + " " + rs.getString("last_name")).trim();
                    }
                }
            } catch (NotFoundException ignored) {
                // client may have been deleted
            }
        }
        return new Account(row.id(), row.clientId(), clientName, clientName,
                row.accountNumber(), row.type(), row.status(),
                row.balanceCents() / 100.0,
                TransferService.parseInstant(row.openedAt()),
                TransferService.parseInstant(row.closedAt()),
                TransferService.parseInstant(row.createdAt()));
    }
}
