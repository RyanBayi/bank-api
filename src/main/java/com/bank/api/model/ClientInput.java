package com.bank.api.model;

public record ClientInput(
    String firstName,
    String lastName,
    String address,
    String phone,
    String email,
    String identityNumber,
    String photo,
    String kycStatus
) {}
