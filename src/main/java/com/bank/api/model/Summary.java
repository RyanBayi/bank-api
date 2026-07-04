package com.bank.api.model;

public record Summary(
    int clientCount,
    int archivedClientCount,
    int accountCount,
    int closedAccountCount,
    int transactionCount,
    double totalBalance
) {}
