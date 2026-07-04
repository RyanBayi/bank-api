package com.bank.api.model;

public record OperationResult(
    Account account,
    Transaction transaction,
    Receipt receipt
) {}
