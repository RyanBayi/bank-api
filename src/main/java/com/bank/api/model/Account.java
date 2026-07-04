package com.bank.api.model;

import java.time.Instant;

public record Account(
    String id,
    String clientId,
    String clientName,
    String ownerName,
    String accountNumber,
    String type,
    String status,
    double balance,
    Instant openedAt,
    Instant closedAt,
    Instant createdAt
) {}
