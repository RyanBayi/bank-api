package com.bank.api.service;

import com.bank.api.exception.*;
import com.bank.api.model.*;
import com.bank.api.repository.DatabaseManager;
import org.springframework.stereotype.Service;

import java.sql.*;
import java.time.Instant;
import java.util.*;

@Service
public class ClientService {

    private final DatabaseManager db;

    public ClientService(DatabaseManager db) {
        this.db = db;
    }

    // ── Create ────────────────────────────────────────────────

    public Client createClient(ClientInput input) {
        try (Connection conn = db.getConnection()) {
            String id = UUID.randomUUID().toString();
            String now = Instant.now().toString();
            String firstName = TransferService.requireString(input.firstName(), "firstName");
            String lastName = TransferService.requireString(input.lastName(), "lastName");
            String address = TransferService.cleanString(input.address(), 240, "");
            String phone = TransferService.cleanString(input.phone(), 40, "");
            String email = validateEmail(TransferService.cleanString(input.email(), 160, ""));
            String identityNumber = TransferService.cleanString(input.identityNumber(), 80, "");
            String photo = TransferService.cleanString(input.photo(), 1200, "");
            String kycStatus = Set.of("PENDING", "VERIFIED", "REJECTED").contains(input.kycStatus())
                    ? input.kycStatus() : "PENDING";

            try (PreparedStatement ps = conn.prepareStatement("""
                    INSERT INTO clients (id, first_name, last_name, address, phone, email,
                    identity_number, photo, kyc_status, archived, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                    """)) {
                ps.setString(1, id);
                ps.setString(2, firstName);
                ps.setString(3, lastName);
                ps.setString(4, address);
                ps.setString(5, phone);
                ps.setString(6, email);
                ps.setString(7, identityNumber);
                ps.setString(8, photo);
                ps.setString(9, kycStatus);
                ps.setString(10, now);
                ps.setString(11, now);
                ps.executeUpdate();
            }

            return toClientResponse(getClientByIdInternal(conn, id), conn);
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    // ── Read ──────────────────────────────────────────────────

    public Client getClientById(String id) {
        try (Connection conn = db.getConnection()) {
            return toClientResponse(getClientByIdInternal(conn, id), conn);
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    public Client getClientByEmail(String email) {
        try (Connection conn = db.getConnection()) {
            String cleanEmail = email != null ? email.trim().toLowerCase() : "";
            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT * FROM clients WHERE LOWER(email) = ? AND archived = 0")) {
                ps.setString(1, cleanEmail);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) throw new NotFoundException("Client introuvable ou archivé");
                    return toClientResponse(mapClientRow(rs), conn);
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    public List<Client> listClients(String q, boolean includeArchived) {
        try (Connection conn = db.getConnection()) {
            StringBuilder query = new StringBuilder("SELECT * FROM clients WHERE 1=1");
            List<String> params = new ArrayList<>();

            if (!includeArchived) query.append(" AND archived = 0");
            String term = TransferService.cleanString(q, 120, "").toLowerCase();
            if (!term.isEmpty()) {
                query.append(" AND (LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR LOWER(email) LIKE ?)");
                String like = "%" + term + "%";
                params.add(like); params.add(like); params.add(like);
            }
            query.append(" ORDER BY created_at DESC");

            try (PreparedStatement ps = conn.prepareStatement(query.toString())) {
                for (int i = 0; i < params.size(); i++) ps.setString(i + 1, params.get(i));
                try (ResultSet rs = ps.executeQuery()) {
                    List<Client> clients = new ArrayList<>();
                    while (rs.next()) clients.add(toClientResponse(mapClientRow(rs), conn));
                    return clients;
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    // ── Update ────────────────────────────────────────────────

    public Client updateClient(String id, ClientInput input) {
        try (Connection conn = db.getConnection()) {
            ClientRow client = getClientByIdInternal(conn, id);
            String now = Instant.now().toString();

            String firstName = input.firstName() != null ? TransferService.requireString(input.firstName(), "firstName") : client.firstName;
            String lastName = input.lastName() != null ? TransferService.requireString(input.lastName(), "lastName") : client.lastName;
            String address = input.address() != null ? TransferService.cleanString(input.address(), 240, "") : client.address;
            String phone = input.phone() != null ? TransferService.cleanString(input.phone(), 40, "") : client.phone;
            String email = input.email() != null ? validateEmail(TransferService.cleanString(input.email(), 160, "")) : client.email;
            String identityNumber = input.identityNumber() != null ? TransferService.cleanString(input.identityNumber(), 80, "") : client.identityNumber;
            String photo = input.photo() != null ? TransferService.cleanString(input.photo(), 1200, "") : client.photo;
            String kycStatus = input.kycStatus() != null
                    ? (Set.of("PENDING", "VERIFIED", "REJECTED").contains(input.kycStatus()) ? input.kycStatus() : client.kycStatus)
                    : client.kycStatus;

            try (PreparedStatement ps = conn.prepareStatement("""
                    UPDATE clients SET first_name=?, last_name=?, address=?, phone=?, email=?,
                    identity_number=?, photo=?, kyc_status=?, updated_at=? WHERE id=?
                    """)) {
                ps.setString(1, firstName);
                ps.setString(2, lastName);
                ps.setString(3, address);
                ps.setString(4, phone);
                ps.setString(5, email);
                ps.setString(6, identityNumber);
                ps.setString(7, photo);
                ps.setString(8, kycStatus);
                ps.setString(9, now);
                ps.setString(10, id);
                ps.executeUpdate();
            }

            return toClientResponse(getClientByIdInternal(conn, id), conn);
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    // ── Archive / Delete ──────────────────────────────────────

    public Client archiveClient(String id) {
        try (Connection conn = db.getConnection()) {
            getClientByIdInternal(conn, id);
            String now = Instant.now().toString();
            try (PreparedStatement ps = conn.prepareStatement(
                    "UPDATE clients SET archived = 1, updated_at = ? WHERE id = ?")) {
                ps.setString(1, now);
                ps.setString(2, id);
                ps.executeUpdate();
            }
            return toClientResponse(getClientByIdInternal(conn, id), conn);
        } catch (SQLException e) {
            throw new RuntimeException("Erreur base de données", e);
        }
    }

    public void deleteClient(String id) {
        try (Connection conn = db.getConnection()) {
            conn.setAutoCommit(false);
            try {
                getClientByIdInternal(conn, id);
                try (PreparedStatement ps = conn.prepareStatement(
                        "SELECT id FROM accounts WHERE client_id = ? AND status != 'CLOSED'")) {
                    ps.setString(1, id);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next()) throw new ValidationException(
                                "Fermez les comptes actifs avant de supprimer ce client");
                    }
                }
                try (PreparedStatement ps = conn.prepareStatement(
                        "DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE client_id = ?)")) {
                    ps.setString(1, id);
                    ps.executeUpdate();
                }
                try (PreparedStatement ps = conn.prepareStatement(
                        "DELETE FROM accounts WHERE client_id = ?")) {
                    ps.setString(1, id);
                    ps.executeUpdate();
                }
                try (PreparedStatement ps = conn.prepareStatement(
                        "DELETE FROM clients WHERE id = ?")) {
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

    record ClientRow(String id, String firstName, String lastName, String address, String phone,
                     String email, String identityNumber, String photo, String kycStatus,
                     boolean archived, String createdAt, String updatedAt) {}

    private ClientRow mapClientRow(ResultSet rs) throws SQLException {
        return new ClientRow(
                rs.getString("id"), rs.getString("first_name"), rs.getString("last_name"),
                TransferService.nz(rs.getString("address")), TransferService.nz(rs.getString("phone")),
                TransferService.nz(rs.getString("email")), TransferService.nz(rs.getString("identity_number")),
                TransferService.nz(rs.getString("photo")), rs.getString("kyc_status"),
                rs.getInt("archived") != 0,
                rs.getString("created_at"), rs.getString("updated_at")
        );
    }

    ClientRow getClientByIdInternal(Connection conn, String id) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("SELECT * FROM clients WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new NotFoundException("Client introuvable");
                return mapClientRow(rs);
            }
        }
    }

    Client toClientResponse(ClientRow row, Connection conn) throws SQLException {
        int accountCount = 0;
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT COUNT(*) FROM accounts WHERE client_id = ? AND status != 'CLOSED'")) {
            ps.setString(1, row.id);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) accountCount = rs.getInt(1);
            }
        }
        return new Client(row.id, row.firstName, row.lastName,
                (row.firstName + " " + row.lastName).trim(),
                row.address, row.phone, row.email, row.identityNumber, row.photo,
                row.kycStatus, row.archived, accountCount,
                TransferService.parseInstant(row.createdAt),
                TransferService.parseInstant(row.updatedAt));
    }

    private static String validateEmail(String email) {
        if (email != null && !email.isEmpty() && !email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw new ValidationException("email invalide");
        }
        return email;
    }
}
