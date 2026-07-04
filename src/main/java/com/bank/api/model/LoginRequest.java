package com.bank.api.model;

public record LoginRequest(
    String email,
    String username,
    String password
) {}
