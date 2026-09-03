# Xerin Delivery - Backend API

Multipurpose logistics & delivery platform backend built with Node.js, Express, Prisma, and PostgreSQL.

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Express 5
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: JWT + bcryptjs
- **Validation**: Zod
- **Email**: Nodemailer
- **Security**: Helmet, CORS, Rate limiting

## Architecture

```
src/
├── modules/
│   ├── auth/           # Authentication (register, login, OTP, reset)
│   ├── pricing/        # Pricing engine (rules, surcharges, calculations)
│   ├── quotes/         # Quote calculation & custom quote requests
│   ├── shipments/      # Shipment creation, tracking, status, assignment
│   ├── tracking/       # Tracking events, driver GPS locations
│   ├── drivers/        # Driver management
│   ├── carriers/       # Carrier (Xerin + partner) management
│   ├── vehicles/       # Vehicle/fleet management
│   ├── manifests/      # Manifest system for bulk shipments
│   ├── waybills/       # Waybill generation
│   ├── payments/       # Payment processing
│   ├── geography/      # Countries, cities, routes, zones
│   └── notifications/  # In-app notifications
├── middleware/         # Auth, error handling
├── prisma/            # Schema, client, seed
├── utils/             # OTP generator
├── app.js             # Express app
└── server.js          # Server entry point
```

## Getting Started

### 1. Install dependencies

```bash
cd back
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

Update `DATABASE_URL` with your PostgreSQL connection string.

### 3. Set up the database

```bash
# Push schema to database
npm run db:push

# Seed initial data (admin, carrier, geography, pricing rules)
npm run db:seed
```

### 4. Start the server

```bash
# Development
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:4000`.

## API Endpoints (v1)

### Auth

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| POST | `/api/v1/auth/register` | Register a new account | No |
| POST | `/api/v1/auth/login` | Login with email & password | No |
| GET | `/api/v1/auth/me` | Get current user profile | Yes |
| POST | `/api/v1/auth/forgot-password` | Request password reset OTP | No |
| POST | `/api/v1/auth/verify-otp` | Verify OTP code | No |
| POST | `/api/v1/auth/reset-password` | Reset password with OTP | No |

### Pricing

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/v1/pricing/rules` | List all pricing rules | Yes |
| POST | `/api/v1/pricing/rules` | Create pricing rule | Admin |
| PUT | `/api/v1/pricing/rules/:id` | Update pricing rule | Admin |
| DELETE | `/api/v1/pricing/rules/:id` | Delete pricing rule | Super Admin |
| PATCH | `/api/v1/pricing/rules/:id/toggle` | Activate/deactivate rule | Admin |
| GET | `/api/v1/pricing/surcharges` | List surcharges | Yes |
| POST | `/api/v1/pricing/surcharges` | Create surcharge | Admin |

### Quotes

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| POST | `/api/v1/quotes/calculate` | Calculate a single quote | Yes |
| POST | `/api/v1/quotes/multiple` | Get multiple quote options | Yes |
| POST | `/api/v1/quotes/save` | Save a quote | Yes |
| GET | `/api/v1/quotes` | List user's quotes | Yes |
| POST | `/api/v1/quotes/requests` | Create custom quote request | Yes |
| GET | `/api/v1/quotes/requests` | List quote requests | Yes |
| PUT | `/api/v1/quotes/requests/:id/respond` | Admin responds to quote request | Admin |
| PUT | `/api/v1/quotes/requests/:id/customer-respond` | Customer accept/reject quote | Yes |

### Shipments

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| POST | `/api/v1/shipments` | Create a shipment | Yes |
| GET | `/api/v1/shipments` | List shipments | Yes |
| GET | `/api/v1/shipments/stats` | Get shipment statistics | Yes |
| GET | `/api/v1/shipments/:id` | Get shipment details | Yes |
| GET | `/api/v1/shipments/track/:trackingNumber` | Track shipment (public) | No |
| PUT | `/api/v1/shipments/:id/status` | Update shipment status | Yes |
| PUT | `/api/v1/shipments/:id/assign` | Assign driver/vehicle | Admin |
| PUT | `/api/v1/shipments/:id/cancel` | Cancel shipment | Yes |

### Tracking

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/v1/tracking/shipments/:trackingNumber` | Public tracking | No |
| POST | `/api/v1/tracking/driver/location` | Update driver GPS | Driver |
| GET | `/api/v1/tracking/driver/:driverId` | Get driver location | Yes |
| POST | `/api/v1/tracking/shipments/:shipmentId/events` | Add tracking event | Yes |

### Fleet

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/v1/drivers` | List drivers | Yes |
| POST | `/api/v1/drivers` | Create driver | Admin |
| PATCH | `/api/v1/drivers/:id/status` | Update driver status | Admin |
| GET | `/api/v1/carriers` | List carriers | Yes |
| POST | `/api/v1/carriers` | Create carrier | Admin |
| GET | `/api/v1/vehicles` | List vehicles | Yes |
| POST | `/api/v1/vehicles` | Create vehicle | Admin |

### Manifests & Waybills

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/v1/manifests` | List manifests | Yes |
| POST | `/api/v1/manifests` | Create manifest | Admin |
| PATCH | `/api/v1/manifests/:id/status` | Update manifest status | Admin |
| GET | `/api/v1/waybills/:shipmentId` | Get/create waybill | Yes |

### Payments

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/v1/payments` | List payments | Yes |
| POST | `/api/v1/payments` | Create payment | Yes |
| GET | `/api/v1/payments/:id` | Get payment details | Yes |

### Geography

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/v1/geography/countries` | List countries | No |
| GET | `/api/v1/geography/cities` | List cities | No |
| GET | `/api/v1/geography/routes` | List routes | No |
| POST | `/api/v1/geography/countries` | Create country | Admin |
| POST | `/api/v1/geography/cities` | Create city | Admin |
| POST | `/api/v1/geography/routes` | Create route | Admin |

### Notifications

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/v1/notifications` | List notifications | Yes |
| PATCH | `/api/v1/notifications/:id/read` | Mark as read | Yes |
| PATCH | `/api/v1/notifications/read-all` | Mark all as read | Yes |

## Shipment Flow

```
Customer → Enter Details → Calculate Quote → Select Option → Confirm Shipment
→ Pay → Create Order → Assign Driver → Pickup → Transport → Track → Deliver → Proof
```

## Pricing Engine

The pricing engine supports:
- **Distance-based** (base fare + per KM)
- **Weight-based** (per KG)
- **Route-based** (weight tier pricing per route)
- **Volumetric weight** (L × W × H / 5000, chargeable = MAX(actual, volumetric))
- **Surcharges** (fuel, handling, insurance, fragile, express, etc.)
- **Multiple quote options** (different transport modes & service levels)
- **Custom quotes** for heavy/special cargo

## Roles

- SUPER_ADMIN
- OPERATIONS_MANAGER
- DISPATCHER
- FINANCE
- CUSTOMER_SUPPORT
- WAREHOUSE_MANAGER
- CUSTOMS_OFFICER
- REPORT_VIEWER
- CUSTOMER
- DRIVER

## Test Credentials (after seed)

- Email: `ezra@xerindelivery.com`
- Password: `Password123!`
