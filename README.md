# Altas

Application de gestion bancaire avec API REST, tableau de bord web, reçus et stockage JSON local.

Fonctionnalités opérationnelles :
- gestion des clients : création, modification, recherche, archivage, suppression contrôlée ;
- KYC : statut `PENDING`, `VERIFIED`, `REJECTED`, pièce d'identité et photo URL ;
- comptes multiples par client : courant, épargne, entreprise, joint ;
- ouverture, fermeture et suppression contrôlée de comptes ;
- dépôts et retraits avec mise à jour automatique du solde ;
- reçus imprimables pour les opérations ;
- transferts internes, vers autre banque et via passerelle de paiement ;
- historique des opérations.

## Démarrer

```bash
npm install
npm test
npm start
```

Puis ouvrir :
- Application : `http://localhost:8080/app/`
- Swagger UI : `http://localhost:8080/swagger-ui/index.html`

## Endpoints principaux

- `GET /api/summary`
- `GET /api/clients?q=...`
- `POST /api/clients`
- `PUT /api/clients/{id}`
- `POST /api/clients/{id}/archive`
- `DELETE /api/clients/{id}`
- `GET /api/accounts`
- `POST /api/accounts`
- `POST /api/accounts/{id}/close`
- `DELETE /api/accounts/{id}`
- `POST /api/accounts/{id}/deposit`
- `POST /api/accounts/{id}/withdraw`
- `POST /api/transfers`
- `GET /api/transactions`
- `GET /api/receipts/{transactionIdOrReceiptNumber}`

## Données

Les données sont stockées dans `data/db.json`.

Variables utiles :
- `PORT` : port HTTP, défaut `8080`
- `HOST` : adresse d'écoute, défaut `127.0.0.1` en local
- `DB_FILE` : chemin complet vers le fichier JSON
- `DATA_DIR` : dossier contenant `db.json`

## Notes

Altas simule les transactions bancaires. Les transferts externes et passerelles créent des écritures et reçus dans l'application, mais ne contactent aucune banque réelle ni service de paiement réel.
