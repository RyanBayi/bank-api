package com.bank.api.controller;

import com.bank.api.model.*;
import com.bank.api.service.ClientService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class ClientController {

    private final ClientService clientService;

    public ClientController(ClientService clientService) {
        this.clientService = clientService;
    }

    @GetMapping("/clients")
    public List<Client> listClients(
            @RequestParam(required = false) String q,
            @RequestParam(required = false, defaultValue = "false") boolean includeArchived) {
        return clientService.listClients(q, includeArchived);
    }

    @PostMapping("/clients")
    public ResponseEntity<Client> createClient(@RequestBody ClientInput input) {
        return ResponseEntity.status(HttpStatus.CREATED).body(clientService.createClient(input));
    }

    @GetMapping("/clients/{id}")
    public Client getClient(@PathVariable String id) {
        return clientService.getClientById(id);
    }

    @PutMapping("/clients/{id}")
    public Client updateClient(@PathVariable String id, @RequestBody ClientInput input) {
        return clientService.updateClient(id, input);
    }

    @PostMapping("/clients/{id}/archive")
    public Client archiveClient(@PathVariable String id) {
        return clientService.archiveClient(id);
    }

    @DeleteMapping("/clients/{id}")
    public ResponseEntity<Void> deleteClient(@PathVariable String id) {
        clientService.deleteClient(id);
        return ResponseEntity.noContent().build();
    }
}
