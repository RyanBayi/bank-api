package com.bank.api.model;

public record CreateAccountRequest(
    String clientId,
    String type,
    double initialDeposit,
    String firstName,
    String lastName,
    String address,
    String phone,
    String email,
    String identityNumber,
    String photo,
    String kycStatus
) {}
