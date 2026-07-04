package com.bank.api.repository;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

@Component
public class DatabaseManager {

    @Value("${app.db.url}")
    private String url;

    @PostConstruct
    public void init() throws SQLException {
        try (Connection conn = getConnection();
             Statement stmt = conn.createStatement()) {

            stmt.execute("PRAGMA journal_mode = WAL");
            stmt.execute("PRAGMA foreign_keys = ON");

            stmt.execute("""
                CREATE TABLE IF NOT EXISTS clients (
                    id TEXT PRIMARY KEY,
                    first_name TEXT,
                    last_name TEXT,
                    address TEXT,
                    phone TEXT,
                    email TEXT,
                    identity_number TEXT,
                    photo TEXT,
                    kyc_status TEXT,
                    archived INTEGER DEFAULT 0,
                    created_at TEXT,
                    updated_at TEXT
                )
            """);

            stmt.execute("""
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY,
                    client_id TEXT,
                    owner_name TEXT,
                    account_number TEXT,
                    type TEXT,
                    status TEXT DEFAULT 'ACTIVE',
                    balance_cents INTEGER DEFAULT 0,
                    opened_at TEXT,
                    closed_at TEXT,
                    created_at TEXT,
                    FOREIGN KEY(client_id) REFERENCES clients(id)
                )
            """);

            stmt.execute("""
                CREATE TABLE IF NOT EXISTS transactions (
                    id TEXT PRIMARY KEY,
                    receipt_number TEXT,
                    account_id TEXT,
                    related_account_id TEXT,
                    type TEXT,
                    transfer_type TEXT,
                    amount_cents INTEGER,
                    balance_after_cents INTEGER,
                    created_at TEXT,
                    description TEXT,
                    destination_bank TEXT,
                    beneficiary_name TEXT,
                    gateway_name TEXT,
                    gateway_reference TEXT,
                    FOREIGN KEY(account_id) REFERENCES accounts(id)
                )
            """);
        }
    }

    public Connection getConnection() throws SQLException {
        return DriverManager.getConnection(url);
    }
}
