package com.bank.api.model;

import java.time.Instant;

public record Transaction(
    String id,
    String receiptNumber,
    String accountId,
    String relatedAccountId,
    String type,
    String transferType,
    double amount,
    double balanceAfter,
    Instant createdAt,
    String description,
    String destinationBank,
    String beneficiaryName,
    String gatewayName,
    String gatewayReference
) {}
