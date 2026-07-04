package com.bank.api.controller;

import com.bank.api.model.*;
import com.bank.api.service.TransferService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class TransferController {

    private final TransferService transferService;

    public TransferController(TransferService transferService) {
        this.transferService = transferService;
    }

    @PostMapping("/transfers")
    public ResponseEntity<TransferResult> transfer(@RequestBody TransferRequest request) {
        TransferResult result = transferService.transfer(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(result);
    }

    @GetMapping("/transactions")
    public List<Transaction> listTransactions(@RequestParam(required = false, defaultValue = "100") int limit) {
        return transferService.listTransactions(null, limit);
    }

    @GetMapping("/receipts/{id}")
    public Receipt getReceipt(@PathVariable String id) {
        return transferService.getReceiptByTransactionId(id);
    }

    @GetMapping("/summary")
    public Summary getSummary() {
        return transferService.getSummary();
    }
}
