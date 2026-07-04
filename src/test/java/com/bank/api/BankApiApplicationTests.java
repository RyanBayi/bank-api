package com.bank.api;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest
@TestPropertySource(properties = "app.db.url=jdbc:sqlite:target/test_context.db")
class BankApiApplicationTests {

    @Test
    void contextLoads() {
    }
}
