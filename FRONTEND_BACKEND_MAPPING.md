# DARFUS Jewellery ERP — Frontend ↔ Backend Mapping Report

This document maps the Next.js Front-End pages, routes, hooks, and context providers directly to the corresponding Express.js Back-End REST API contracts, enabling clean integration without modifying frontend business logic.

---

## 1. Page and Component API Mapping Matrix

### 1.1. Login Page
- **Page Name**: Login Page
- **Component Location**: `app/[locale]/login/page.tsx`
- **Controller Action**: `AuthController.login`
- **Required API Route**: `POST /api/v1/auth/login`
- **HTTP Method**: `POST`
- **Authentication**: None
- **Request Body**:
  ```json
  {
    "email": "admin@admin.com",
    "password": "123456"
  }
  ```
- **Response Body**:
  ```json
  {
    "success": true,
    "data": {
      "token": "eyJhbGciOiJIUz...",
      "refreshToken": "eyJhbGci...",
      "user": {
        "id": "USR-ADMIN",
        "firstName": "Admin",
        "lastName": "DARFUS",
        "email": "admin@admin.com",
        "role": "admin"
      },
      "company": {
        "id": "CMP-DEMO",
        "businessName": "DARFUS Jewellery",
        "workspace": "demo"
      }
    }
  }
  ```
- **Validation Rules**: Email must be a valid email format; password is required.
- **Where called**: `contexts/auth-context.tsx` inside the `login` function.

---

### 1.2. Organization Onboarding (Signup)
- **Page Name**: Registration Flow
- **Component Location**: `app/[locale]/signup/page.tsx`
- **Controller Action**: `AuthController.register`
- **Required API Route**: `POST /api/v1/auth/register`
- **HTTP Method**: `POST`
- **Authentication**: None
- **Request Body**:
  ```json
  {
    "businessName": "DARFUS Jewellery",
    "email": "admin@admin.com",
    "phone": "+9715000000",
    "workspace": "demo",
    "password": "123456",
    "firstName": "Admin",
    "lastName": "DARFUS",
    "role": "admin"
  }
  ```
- **Response Body**: Same structure as Login success.
- **Validation Rules**: Workspace name must be alphanumeric and unique; email must be unique.
- **Where called**: `contexts/auth-context.tsx` inside the `register` function.

---

### 1.3. Live Gold Price Widget
- **Page Name**: Dashboard gold rates widget & Ticker
- **Component Location**: `components/layout/Header.tsx` & `features/dashboard/components/GoldPriceWidget.tsx`
- **Controller Action**: `GoldController.getLivePrice`
- **Required API Route**: `GET /api/v1/gold/live` (fallback `/api/gold/live`)
- **HTTP Method**: `GET`
- **Authentication**: Optional
- **Request Body**: None
- **Response Body**:
  ```json
  {
    "gold_24k": {
      "USD": 2350,
      "EUR": 2160,
      "GBP": 1850,
      "EGP": 111500,
      "SAR": 8810,
      "AED": 8630
    },
    "last_update": "2026-06-16T17:30:00Z"
  }
  ```
- **Where called**: Called dynamically via interval refetch inside `contexts/erp-context.tsx` and header components.

---

### 1.4. Inventory Directory
- **Page Name**: Stock Inventory list
- **Component Location**: `app/[locale]/(dashboard)/inventory/page.tsx`
- **Controller Action**: `ErpController.list`
- **Required API Route**: `GET /api/v1/assets`
- **HTTP Method**: `GET`
- **Authentication**: Required (`Bearer Token` + `X-Company-ID` + `X-Branch-ID`)
- **Request Query Params**:
  - `page`: active index (number)
  - `pageSize`: items per page (number)
  - `search`: search query keyword (string)
  - `filters`: JSON string filters (e.g. `{"status": "available", "karat": 18}`)
- **Response Body**:
  ```json
  {
    "success": true,
    "items": [ ...Assets ],
    "total": 6,
    "page": 1,
    "pageSize": 25
  }
  ```
- **Where called**: In `features/assets/hooks/use-assets.ts`.

---

### 1.5. Asset Lifecycle Details
- **Page Name**: Asset profile sheet
- **Component Location**: `app/[locale]/(dashboard)/inventory/[id]/page.tsx`
- **Controller Action**: `ErpController.getById` & `ErpController.update`
- **Required API Route**: `GET /api/v1/assets/:id` & `PUT /api/v1/assets/:id`
- **HTTP Method**: `GET` and `PUT`
- **Authentication**: Required
- **Where called**: `features/assets/hooks/use-asset-query.ts`.

---

### 1.6. Point of Sale (POS) Checkout
- **Page Name**: POS Terminal
- **Component Location**: `app/[locale]/(dashboard)/pos/page.tsx`
- **Controller Action**: `ErpController.create` (Invoices)
- **Required API Route**: `POST /api/v1/invoices`
- **HTTP Method**: `POST`
- **Authentication**: Required (`Idempotency-Key` header recommended)
- **Request Body**:
  ```json
  {
    "id": "INV-10487",
    "customerId": "CUS-0012",
    "customerName": "مريم سالم",
    "date": "2026-06-16 20:30",
    "total": 4290,
    "tax": 204,
    "paymentMethod": "بطاقة",
    "branch": "فرع أبوظبي",
    "items": [{ "assetId": "AST-2026-00144", "name": "خاتم ذهب", "quantity": 1, "price": 4290 }]
  }
  ```
- **Where called**: `features/sales/hooks/use-pos.ts` inside `postInvoice` callback.

---

### 1.7. Attachment Uploads
- **Page Name**: File attachments component
- **Component Location**: `features/assets/components/AttachmentsPanel.tsx`
- **Controller Action**: `UploadController.upload`
- **Required API Route**: `POST /api/v1/attachments/upload`
- **HTTP Method**: `POST`
- **Headers**: `Content-Type: multipart/form-data`
- **Request Payload**: form-data containing the `file`
- **Response Body**:
  ```json
  {
    "success": true,
    "data": {
      "id": "ATT-102931",
      "name": "photo.png",
      "type": "PNG",
      "size": 521400,
      "url": "/uploads/1718000-photo.png"
    }
  }
  ```

---

## 2. Integration Variables

Modify the front-end `.env` variables to connect:

```env
# Point Next.js to the Node.js/Express API server
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1

# Change the data source mode from "mock" to "api"
NEXT_PUBLIC_DATA_SOURCE=api
```

---

## 3. Step-by-Step Connection Instructions

1. **Spin Up PostgreSQL**: Ensure your local database `darfus_erp` is created and listening on port `5432`.
2. **Launch Backend**:
   - `cd backend`
   - `npm install`
   - `npm run db:migrate` (runs the table generation)
   - `npm run db:seed` (pre-populates demo accounts and sample inventory assets)
   - `npm run dev` (starts listening on `http://localhost:8000`)
3. **Configure Frontend**:
   - Create or update `.env` in the root of the frontend project:
     ```env
     NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
     NEXT_PUBLIC_DATA_SOURCE=api
     ```
4. **Boot Frontend**: Run `npm run dev` in the frontend root.
5. **Login Validation**: Open `http://localhost:3000/ar/login` and login using `admin@admin.com` with the current local owner password. The app will now pull dynamic assets, invoices, statement balances, and gold rates straight from PostgreSQL!
