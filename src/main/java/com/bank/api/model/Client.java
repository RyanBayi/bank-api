package com.bank.api.model;

import java.time.Instant;

public record Client(
    String id,
    String firstName,
    String lastName,
    String fullName,
    String address,
    String phone,
    String email,
    String identityNumber,
    String photo,
    String kycStatus,
    boolean archived,
    int accountCount,
    Instant createdAt,
    Instant updatedAt
) {}
