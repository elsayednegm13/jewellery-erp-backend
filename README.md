# DARFUS Jewellery ERP — Enterprise Backend Server

A production-ready, secure, and multi-tenant backend for the DARFUS Jewellery ERP built using Node.js, Express.js, PostgreSQL, and Sequelize ORM.

---

## 1. Project Folder Structure

```
backend/
├── src/
│   ├── config/          # Sequelize configuration and DB connection
│   ├── controllers/     # Controller layer (Auth, Gold Price, ERP CRUD)
│   ├── middleware/      # Express middlewares (Auth, Errors, Upload)
│   ├── models/          # Sequelize schema models and associations
│   ├── routes/          # REST route handlers
│   ├── services/        # Service layer (Gold Live cache, Queue jobs, Storage drivers)
│   ├── utils/           # Logger configurations and App Errors
│   ├── app.js           # Express application setup
│   └── server.js        # Entrypoint script
├── migrations/          # DB schema creation migration scripts
├── seeders/             # DB demo data loaders matching demo-data.ts
├── docs/                # Architectural docs and Mermaid diagrams
├── uploads/             # Statically served attachment files folder
├── package.json         # Server dependency manifest
├── swagger.json         # OpenAPI Swagger configuration
├── postman_collection.json # API Postman collection
├── FRONTEND_BACKEND_MAPPING.md # Mapping Matrix
└── README.md            # Installation & Connection guide (This file)
```

---

## 2. Prerequisites

1. **Node.js**: v18.0.0 or higher.
2. **PostgreSQL**: v14.0 or higher running on local port `5432`.
3. **Redis**: (Optional) Required for background queues. The service falls back gracefully to in-process memory queues if Redis is unavailable.

---

## 3. Installation Instructions

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install npm packages:
   ```bash
   npm install
   ```

---

## 4. Database Setup

1. Open your PostgreSQL terminal or client and create the database:
   ```sql
   CREATE DATABASE darfus_erp;
   ```
2. Run database migration scripts (generates 28 tables, relational scopes, constraints, and indexes):
   ```bash
   npm run db:migrate
   ```
3. Seed default demo data (inserts `admin@admin.com` account, active employees, suppliers, invoices, and assets):
   ```bash
   npm run db:seed
   ```

To perform a complete wipe and refresh of the database state, run:
```bash
npm run db:reset
```

---

## 5. Running the Backend

- **Development Mode** (Hot-reloads automatically on file changes):
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  npm run start
  ```

Once running, the backend listening on:
- Server Gateway: `http://localhost:8000/api/v1`
- Swagger UI Panel: `http://localhost:8000/api-docs`

---

## 6. Primary API Routes Summary

### 6.1. Auth Modules
- `POST /api/v1/auth/login` - Authenticates user credentials.
- `POST /api/v1/auth/refresh` - Requests new tokens using refresh tokens.
- `POST /api/v1/auth/logout` - Revokes current session tokens.
- `GET /api/v1/auth/me` - Fetches authenticated user and company profile.
- `POST /api/v1/auth/register` - Registers new tenant companies and admins.

### 6.2. Live Gold Tickers
- `GET /api/v1/gold/live` (fallback `/api/gold/live`) - live gold price in USD, EUR, GBP, EGP, SAR, AED (cached for 60 seconds).

### 6.3. File Attachments
- `POST /api/v1/attachments/upload` - Handles file uploads (multipart/form-data) yielding attachment URLs.

### 6.4. Core ERP CRUD (Supports: Page indexes, sorting, filtering, searching, multi-tenancy)
- `GET /api/v1/assets` | `POST /api/v1/assets`
- `GET /api/v1/customers` | `POST /api/v1/customers`
- `GET /api/v1/suppliers` | `POST /api/v1/suppliers`
- `GET /api/v1/invoices` | `POST /api/v1/invoices`
- `GET /api/v1/transfers` | `POST /api/v1/transfers`

---

## 7. Connecting Frontend to Backend (Zero Logic Editing)

Ensure Next.js communicates with this PostgreSQL server by setting these environment parameters in the frontend's active `.env` file:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_DATA_SOURCE=api
```
Restart your frontend server (`npm run dev`). The application is now fully database-driven!
