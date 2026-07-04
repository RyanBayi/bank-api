package com.bank.api.model;

import java.util.List;

public record TransferResult(
    Account fromAccount,
    Account toAccount,
    List<Transaction> transactions,
    Receipt receipt
) {}
