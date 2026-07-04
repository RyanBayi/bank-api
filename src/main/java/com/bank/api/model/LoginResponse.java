package com.bank.api.model;

public record LoginResponse(
    String role,
    Client client
) {}
