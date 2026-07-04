package com.bank.api.model;

public record TransferRequest(
    String fromAccountId,
    String toAccountId,
    String transferType,
    double amount,
    String beneficiaryName,
    String destinationBank,
    String gatewayName,
    String gatewayReference,
    String description
) {}
