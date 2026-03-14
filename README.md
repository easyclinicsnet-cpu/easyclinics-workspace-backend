# EasyClinics EMR — Backend API

> Electronic Medical Records backend built with NestJS, TypeORM, and MySQL.
> Designed for multi-workspace clinic management with domain-driven architecture.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Database Migrations](#database-migrations)
- [Scripts](#scripts)
- [Security](#security)

---

## Overview

EasyClinics EMR is a multi-tenant Electronic Medical Records system designed for healthcare providers. The backend exposes a versioned REST API (`/api/v1/`) covering patient records, clinical consultations, appointments, billing, inventory, care notes, insurance, and audit compliance.

Key capabilities:

- **Multi-workspace** — each clinic operates in an isolated workspace context
- **Field-level encryption** — sensitive patient data (PII, clinical notes) is AES-256 encrypted at rest
- **AI-assisted workflows** — integrates OpenAI, Anthropic Claude, and Google Gemini for clinical decision support
- **Comprehensive audit trail** — every data change is logged with user, timestamp, and workspace context
- **Real-time notifications** — WebSocket gateway + Firebase push notifications
- **Timezone-aware** — all local timestamps are CAT (UTC+2 / Africa/Harare); DB always stores UTC

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 |
| Language | TypeScript 5.7 (strict mode) |
| ORM | TypeORM 0.3 |
| Database | MySQL 8 |
| Auth | JWT (access + refresh tokens), Passport |
| Encryption | AES-256-CBC via scrypt key derivation |
| Validation | class-validator + class-transformer |
| Logging | Winston + daily rotate |
| Scheduling | @nestjs/schedule |
| Real-time | Socket.IO (WebSockets) |
| Push | Firebase Admin SDK |
| AI | OpenAI, Anthropic SDK, Google Generative AI |
| Docs | Swagger / OpenAPI |

---

## Architecture

The codebase follows **Domain-Driven Design** with the following structure:

```
src/
├── domains/                  # Business domains
│   ├── patients/             # Patient records, history, family conditions
│   ├── appointments/         # Scheduling, slots, reminders
│   ├── consultations/        # Clinical consultations & diagnoses
│   ├── care-notes/           # Nursing & care team notes
│   ├── billing/              # Invoices, payments, insurance claims
│   ├── inventory/            # Medication & supply management
│   ├── insurance/            # Insurance providers & policies
│   ├── audit/                # Compliance audit log
│   └── notifications/        # In-app & push notifications
├── modules/                  # Shared infrastructure modules
│   ├── database/             # TypeORM data source & base repository
│   ├── security/             # AES encryption service
│   ├── logger/               # Winston logger service
│   ├── file-upload/          # Multer file handling
│   ├── storage/              # File storage service
│   └── versioning/           # API version helpers
├── common/                   # DTOs, guards, interceptors, decorators
├── config/                   # Configuration modules (app, db, jwt, etc.)
└── migrations/               # TypeORM migration files
```

All API routes are prefixed `/api/v1/`. URI versioning is enabled — future breaking changes can be introduced under `/api/v2/` without affecting existing clients.

---

## Getting Started

### Prerequisites

- Node.js 20+
- MySQL 8
- npm 10+

### Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd easyclinics-emr-backend

# 2. Install dependencies
npm install

# 3. Copy and configure environment variables
cp .env.example .env
# Edit .env — see Environment Variables section below

# 4. Run database migrations
npm run migration:run

# 5. Start the development server
npm run start:dev
```

The API will be available at `http://localhost:3000/api/v1`.
Swagger docs: `http://localhost:3000/api/docs` *(when enabled in config)*.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values.

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `development` / `production` / `test` |
| `PORT` | Yes | HTTP port (default: `3000`) |
| `TZ` | Yes | Timezone — use `Africa/Harare` for CAT |
| `DB_HOST` | Yes | MySQL host |
| `DB_PORT` | Yes | MySQL port (default: `3306`) |
| `DB_USERNAME` | Yes | MySQL user |
| `DB_PASSWORD` | Yes | MySQL password |
| `DB_DATABASE` | Yes | MySQL database name |
| `JWT_SECRET` | Yes | Access token signing secret |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret |
| `ENCRYPTION_KEY` | Yes | 32-character base key for AES-256 |
| `ENCRYPTION_SALT` | Yes | Salt for scrypt key derivation — **never change after first run** |
| `CORS_ORIGIN` | Yes | Comma-separated list of allowed origins |
| `OPENAI_API_KEY` | No | For AI-assisted features |
| `ANTHROPIC_API_KEY` | No | For Claude-assisted features |
| `GEMINI_API_KEY` | No | For Gemini-assisted features |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | No | Path to Firebase service account JSON |

> **Warning:** Changing `ENCRYPTION_SALT` after the first run will make all existing encrypted data unreadable.

---

## API Reference

All endpoints are prefixed with `/api/v1/`. Authentication uses Bearer JWT tokens.

| Domain | Base Path | Description |
|---|---|---|
| Auth | `/api/v1/auth` | Login, refresh, logout |
| Patients | `/api/v1/patients` | Patient CRUD, search, history |
| Appointments | `/api/v1/appointments` | Scheduling, availability, reminders |
| Consultations | `/api/v1/consultations` | Clinical notes, diagnoses, vitals |
| Care Notes | `/api/v1/care-notes` | Nursing notes, permissions |
| Billing | `/api/v1/billing` | Invoices, payments |
| Inventory | `/api/v1/inventory` | Medications, supplies |
| Insurance | `/api/v1/insurance` | Providers, policies, claims |
| Audit | `/api/v1/audit` | Compliance audit log |
| Notifications | `/api/v1/notifications` | In-app notifications |

---

## Database Migrations

```bash
# Run pending migrations
npm run migration:run

# Revert the last migration
npm run migration:revert

# Generate a new migration from entity changes
npm run migration:generate -- src/migrations/MigrationName

# Create a blank migration file
npm run migration:create -- src/migrations/MigrationName
```

> `DB_SYNCHRONIZE` must be `false` in all environments. Use migrations exclusively.

---

## Scripts

```bash
# Development (watch mode)
npm run start:dev

# Debug mode
npm run start:debug

# Production build
npm run build
npm run start:prod

# Linting
npm run lint

# Formatting
npm run format

# Unit tests
npm run test

# Test coverage
npm run test:cov

# E2E tests
npm run test:e2e
```

---

## Security

- **Encryption at rest** — PII and clinical data is encrypted with AES-256-CBC before database storage. Decryption happens at the application layer only.
- **Password hashing** — bcrypt with configurable salt rounds.
- **JWT** — short-lived access tokens (1h) + long-lived refresh tokens (7d) stored securely.
- **Rate limiting** — configurable per-IP throttle via `@nestjs/throttler`.
- **CORS** — explicit allowlist; credentials mode enabled.
- **Audit logging** — every create/update/delete is recorded with actor, workspace, and diff.
- **Input validation** — all incoming payloads are validated and whitelisted via `class-validator`. Unknown fields are rejected.

---

## License

Private and confidential. All rights reserved — EasyClinics.
