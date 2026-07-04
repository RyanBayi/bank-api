package com.bank.api.model;

import java.time.Instant;

public record Receipt(
    String receiptNumber,
    Transaction transaction,
    Account account,
    Client client,
    Instant issuedAt
) {}
