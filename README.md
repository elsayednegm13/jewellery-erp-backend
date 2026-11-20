# DARFUS Jewellery ERP — Enterprise Backend Server

A production-ready, secure, multi-tenant backend for the DARFUS Jewellery ERP, built with Node.js, Express.js, PostgreSQL, and Sequelize ORM.

It powers the full jewellery business workflow: gold, diamond, gemstone, and pearl inventory profiles, barcode-driven asset tracking, purchasing and sales invoicing, branches and cash registers, accounting and approvals, employee permissions, and a live gold price ticker.

---

## Features

- **Multi-tenant authentication** — company registration, JWT login, refresh tokens, logout revocation, and a `me` endpoint for the authenticated user and company profile.
- **Jewellery domain profiles** — dedicated modules for gold by weight, gold by piece, diamond jewellery, gemstone jewellery, pearl jewellery, and loose diamonds, gemstones, and pearls.
- **Gold purchasing and pricing** — gold purchase invoices and configurable gold pricing policies.
- **Live gold ticker** — live gold price in USD, EUR, GBP, EGP, SAR, and AED, cached for 60 seconds.
- **Barcode asset tracking** — barcode sequences, item codes, inventory codes, barcode history, and asset certificates.
- **Branches and inventory locations** — multi-branch structure with branch customer and financial mappings, plus inventory locations.
- **Core ERP CRUD** — assets, customers, suppliers, invoices, and transfers with paging, sorting, filtering, searching, and tenant isolation.
- **Accounting and controls** — chart of accounts, accounting locks, approval requests, cash register sessions, and settlement flows.
- **Employee authorization** — per-employee permission management with safe check and reconcile scripts.
- **Attendance and audit log** — employee attendance records and an audit trail of system activity.
- **File attachments** — multipart uploads with a Cloudinary-backed storage driver.
- **Background jobs** — BullMQ queues on Redis, with a graceful in-process fallback when Redis is unavailable.
- **Security baseline** — Helmet headers, CORS, bcryptjs password hashing, Zod request validation, and Winston/Morgan logging.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Database | PostgreSQL 14+ with Sequelize 6 ORM |
| Queues | BullMQ + Redis (optional) |
| Auth | JSON Web Tokens, bcryptjs |
| Storage | Cloudinary + local uploads |
| API docs | Swagger UI (`swagger-ui-express`) |

---

## Project Structure

```
backend/
├── src/
│   ├── bootstrap/       # Application bootstrap helpers
│   ├── config/          # Sequelize configuration and DB connection
│   ├── controllers/     # Controller layer (Auth, Gold Price, ERP CRUD)
│   ├── middleware/      # Express middlewares (Auth, Errors, Upload)
│   ├── models/          # Sequelize schema models and associations
│   ├── repositories/    # Data access layer
│   ├── routes/          # REST route handlers
│   ├── services/        # Service layer (Gold Live cache, Queue jobs, Storage drivers)
│   ├── utils/           # Logger configuration and app errors
│   ├── app.js           # Express application setup
│   └── server.js        # Entrypoint script
├── migrations/          # DB schema migration scripts
├── seeders/             # DB demo data loaders
├── tests/               # API and contract test suites
├── scripts/             # Safe migration, reset, backup, and permission tools
├── docs/                # Architectural docs (ERD.md)
├── uploads/             # Statically served attachment files folder
├── Dockerfile           # Container image definition
├── package.json         # Server dependency manifest
├── swagger.json         # OpenAPI Swagger configuration
├── postman_collection.json # API Postman collection
├── FRONTEND_BACKEND_MAPPING.md # Frontend ↔ backend mapping matrix
└── README.md            # Installation and connection guide (this file)
```

---

## Prerequisites

1. **Node.js**: v18.0.0 or higher.
2. **PostgreSQL**: v14.0 or higher running on local port `5432`.
3. **Redis**: (Optional) Required for background queues. The service falls back gracefully to in-process memory queues if Redis is unavailable.

---

## Installation

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install npm packages:
   ```bash
   npm install
   ```

---

## Database Setup

1. Create the database:
   ```sql
   CREATE DATABASE darfus_erp;
   ```
2. Run the migration scripts (schema, relational scopes, constraints, and indexes):
   ```bash
   npm run db:migrate
   ```
3. Seed demo data (a demo admin account, employees, suppliers, invoices, and assets):
   ```bash
   npm run db:seed
   ```

To perform a complete wipe and refresh of the database state, run:

```bash
npm run db:reset
```

### npm Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development mode with hot reload (nodemon) |
| `npm start` | Production mode |
| `npm run db:migrate` | Apply Sequelize migrations |
| `npm run db:migrate:safe` | Guarded migration runner (`scripts/migrate-safe.js`) |
| `npm run db:seed` | Load demo data |
| `npm run db:reset` | Wipe and rebuild the database |
| `npm run db:backup` | Create a database backup |
| `npm run permissions:check` | Dry-run permission reconciliation |
| `npm run permissions:reconcile` | Apply permission reconciliation |

---

## Running the Backend

- **Development Mode** (hot-reloads on file changes):
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  npm run start
  ```

Once running, the backend listens on:

- Server Gateway: `http://localhost:8000/api/v1`
- Swagger UI Panel: `http://localhost:8000/api-docs`

A `Dockerfile` is included for containerized deployment.

---

## Primary API Routes Summary

### Auth

- `POST /api/v1/auth/login` — Authenticates user credentials.
- `POST /api/v1/auth/refresh` — Requests new tokens using refresh tokens.
- `POST /api/v1/auth/logout` — Revokes current session tokens.
- `GET /api/v1/auth/me` — Fetches authenticated user and company profile.
- `POST /api/v1/auth/register` — Registers new tenant companies and admins.

### Live Gold Tickers

- `GET /api/v1/gold/live` (fallback `/api/gold/live`) — live gold price in USD, EUR, GBP, EGP, SAR, AED (cached for 60 seconds).

### File Attachments

- `POST /api/v1/attachments/upload` — Handles file uploads (multipart/form-data) yielding attachment URLs.

### Core ERP CRUD

Supports page indexes, sorting, filtering, searching, and multi-tenancy:

- `GET /api/v1/assets` | `POST /api/v1/assets`
- `GET /api/v1/customers` | `POST /api/v1/customers`
- `GET /api/v1/suppliers` | `POST /api/v1/suppliers`
- `GET /api/v1/invoices` | `POST /api/v1/invoices`
- `GET /api/v1/transfers` | `POST /api/v1/transfers`

### Domain Routers

Additional route modules cover gold by weight and by piece, diamond, gemstone, and pearl jewellery profiles, loose stones, gold purchases, gold pricing policies, inventory locations, invoice projections, employee authorization, setup, and domain events. See `swagger.json` or the Swagger UI for the complete, versioned endpoint list.

---

## Testing

```bash
node --test tests/api.test.js
```

The `tests/` folder also contains an extensive contract test suite covering barcodes, customers, settlements, pricing, permissions, and migration safety.

---

## Connecting Frontend to Backend (Zero Logic Editing)

Point the Next.js frontend at this server by setting these environment parameters in the frontend's active `.env` file:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_DATA_SOURCE=api
```

Restart your frontend server (`npm run dev`). The application is now fully database-driven.

---

## Documentation

- `FRONTEND_BACKEND_MAPPING.md` — frontend ↔ backend mapping matrix.
- `docs/ERD.md` — entity relationship diagram.
- `swagger.json` and `postman_collection.json` — API reference and a ready Postman collection.
