package com.bank.api.controller;

import com.bank.api.model.*;
import com.bank.api.service.ClientService;
import com.bank.api.service.TransferService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class AuthController {

    private final ClientService clientService;

    public AuthController(ClientService clientService) {
        this.clientService = clientService;
    }

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest request) {
        if ("admin".equals(request.username()) && "admin".equals(request.password())) {
            return new LoginResponse("admin", null);
        }

        if (request.email() != null && !request.email().isBlank()) {
            Client client = clientService.getClientByEmail(request.email());
            return new LoginResponse("client", client);
        }

        throw new com.bank.api.exception.ValidationException("Email ou identifiants incorrects");
    }
}
