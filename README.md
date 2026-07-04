# Altas — API Bancaire Java

Application de gestion bancaire avec API REST, tableau de bord web, reçus et stockage SQLite.
Portage Java 21 / Spring Boot 3.3.5 depuis le projet Node.js original.

## Fonctionnalités

- **Gestion des clients** : création, modification, recherche, archivage, suppression contrôlée
- **KYC** : statut `PENDING`, `VERIFIED`, `REJECTED`, pièce d'identité et photo URL
- **Comptes multiples par client** : courant, épargne, entreprise, joint
- **Ouverture, fermeture et suppression contrôlée de comptes**
- **Dépôts et retraits** avec mise à jour automatique du solde
- **Reçus imprimables** pour les opérations
- **Transferts** : internes, vers autre banque et via passerelle de paiement
- **Historique des opérations**

## Prérequis

- Java 21+
- Maven 3.9+ (ou utiliser `./mvnw` inclus)

## Démarrer

```bash
# Compiler et tester
./mvnw test

# Lancer l'application (port 8080 par défaut)
./mvnw spring-boot:run
```

Puis ouvrir :
- Application : `http://localhost:8080/app/`
- Swagger UI : `http://localhost:8080/swagger-ui/index.html`

## Endpoints principaux

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/api/summary` | Résumé global |
| `GET` | `/api/clients?q=...` | Rechercher/lister les clients |
| `POST` | `/api/clients` | Créer un client |
| `PUT` | `/api/clients/{id}` | Modifier un client |
| `POST` | `/api/clients/{id}/archive` | Archiver un client |
| `DELETE` | `/api/clients/{id}` | Supprimer un client |
| `GET` | `/api/clients/{id}/accounts` | Comptes d'un client |
| `GET` | `/api/accounts` | Lister les comptes |
| `POST` | `/api/accounts` | Ouvrir un compte |
| `GET` | `/api/accounts/{id}` | Consulter un compte |
| `POST` | `/api/accounts/{id}/close` | Fermer un compte |
| `DELETE` | `/api/accounts/{id}` | Supprimer un compte |
| `POST` | `/api/accounts/{id}/deposit` | Dépôt avec reçu |
| `POST` | `/api/accounts/{id}/withdraw` | Retrait avec reçu |
| `GET` | `/api/accounts/{id}/transactions` | Historique du compte |
| `POST` | `/api/transfers` | Transfert interne/externe/passerelle |
| `GET` | `/api/transactions` | Historique récent |
| `GET` | `/api/receipts/{id}` | Consulter un reçu |
| `POST` | `/api/login` | Authentification |

## Structure du projet

```
src/
├── main/java/com/bank/api/
│   ├── BankApiApplication.java      # Point d'entrée Spring Boot
│   ├── config/WebConfig.java        # Configuration web et ressources statiques
│   ├── controller/
│   │   ├── AccountController.java   # Endpoints /api/accounts
│   │   ├── AuthController.java      # Endpoint /api/login
│   │   ├── ClientController.java    # Endpoints /api/clients
│   │   ├── GlobalExceptionHandler.java
│   │   └── TransferController.java  # Endpoints /api/transfers, transactions, receipts, summary
│   ├── exception/
│   │   ├── InsufficientFundsException.java
│   │   ├── NotFoundException.java
│   │   └── ValidationException.java
│   ├── model/                       # Records Java (DTOs)
│   ├── repository/DatabaseManager.java  # Gestion SQLite
│   └── service/
│       ├── AccountService.java      # CRUD comptes
│       ├── ClientService.java       # CRUD clients
│       └── TransferService.java     # Virements, dépôts, retraits, transactions
└── test/java/com/bank/api/          # Tests unitaires
```

## Données

Stockées dans `data/db.db` (SQLite). La base est créée automatiquement au démarrage.

Variables d'environnement :
- `PORT` : port HTTP (défaut `8080`)
- `DB_FILE` : chemin complet vers le fichier SQLite (défaut `data/db.db`)

## Notes

Altas simule les transactions bancaires. Les transferts externes et passerelles créent des écritures et reçus dans l'application, mais ne contactent aucune banque réelle ni service de paiement réel.
