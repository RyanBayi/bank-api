package com.bank.api.model;

public record MoneyOperationRequest(
    double amount,
    String description
) {}
