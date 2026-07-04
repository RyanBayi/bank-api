package com.bank.api.controller;

import com.bank.api.model.*;
import com.bank.api.service.AccountService;
import com.bank.api.service.TransferService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class AccountController {

    private final AccountService accountService;
    private final TransferService transferService;

    public AccountController(AccountService accountService, TransferService transferService) {
        this.accountService = accountService;
        this.transferService = transferService;
    }

    @GetMapping("/accounts")
    public List<Account> listAccounts(
            @RequestParam(required = false) String clientId,
            @RequestParam(required = false, defaultValue = "false") boolean includeClosed) {
        return accountService.listAccounts(clientId, includeClosed);
    }

    @PostMapping("/accounts")
    public ResponseEntity<Account> createAccount(@RequestBody CreateAccountRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(accountService.createAccount(request));
    }

    @GetMapping("/accounts/{id}")
    public Account getAccount(@PathVariable String id) {
        return accountService.getAccountById(id);
    }

    @DeleteMapping("/accounts/{id}")
    public ResponseEntity<Void> deleteAccount(@PathVariable String id) {
        accountService.deleteAccount(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/accounts/{id}/close")
    public Account closeAccount(@PathVariable String id) {
        return accountService.closeAccount(id);
    }

    @GetMapping("/accounts/{id}/transactions")
    public List<Transaction> listAccountTransactions(
            @PathVariable String id,
            @RequestParam(required = false, defaultValue = "100") int limit) {
        return transferService.listTransactions(id, limit);
    }

    @PostMapping("/accounts/{id}/deposit")
    public OperationResult deposit(@PathVariable String id, @RequestBody MoneyOperationRequest request) {
        return transferService.deposit(id, request.amount(), request.description());
    }

    @PostMapping("/accounts/{id}/withdraw")
    public OperationResult withdraw(@PathVariable String id, @RequestBody MoneyOperationRequest request) {
        return transferService.withdraw(id, request.amount(), request.description());
    }

    @GetMapping("/clients/{id}/accounts")
    public List<Account> listClientAccounts(
            @PathVariable String id,
            @RequestParam(required = false, defaultValue = "false") boolean includeClosed) {
        return accountService.listAccounts(id, includeClosed);
    }
}
