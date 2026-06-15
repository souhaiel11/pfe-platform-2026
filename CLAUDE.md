# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevSecOps AI Platform — a security monitoring platform that aggregates metrics from SonarQube, Jenkins, and Trivy, uses n8n + OpenAI to auto-fix bugs via PRs, and provides a real-time dashboard with ChatOps.

## Commands

### Backend (NestJS)

```bash
cd backend
npm install
npm run start:dev      # dev with hot reload
npm run build          # compile TypeScript → dist/
node dist/main.js      # run compiled build
```

### Frontend (Angular 17)

```bash
cd frontend
npm install
npm start              # ng serve --host 0.0.0.0 --port 4200
npm run build          # dev build
npm run build:prod     # production build → dist/devsecops-frontend/browser/
```

### Full stack with Docker

```bash
docker network create pfe-network   # required once before first run
docker-compose up -d                # starts postgres + backend + nginx frontend
```

The Docker frontend serves the **pre-built** Angular dist. Rebuild frontend before `docker-compose up` after code changes.

## Architecture

### Backend (`backend/src/`)

NestJS monolith with `synchronize: true` TypeORM (auto-migration on startup, PostgreSQL). All routes are prefixed `/api`. Swagger at `/api/docs`.

**Module layout:**
- `auth/` — JWT + bcrypt login/register, seeds two default users on boot via `AuthService.seed()`
- `projects/` — CRUD for projects, plus live SonarQube/Jenkins/GitHub/Trivy API calls
- `bugs/` — Bug lifecycle (`open → ai_fixing → pr_created → resolved`); triggers n8n workflow for AI fix; falls back to `simulateAiFix()` if n8n is unreachable
- `incidents/` — Incident lifecycle (`pending → analyzing → … → completed`); created automatically by webhooks
- `reports/` — Stores scan reports with AI summary (via n8n `/webhook/report-summary`); calculates composite `securityScore` (70% technical, 30% AI judge) and updates the parent project's score
- `dashboard/` — Aggregates bugs + projects for global stats; fetches per-project metrics from the external tools
- `webhooks/` — Receives payloads from SonarQube, Jenkins, Trivy and creates bugs/incidents accordingly
- `chat/` — Socket.IO gateway + HTTP proxy to n8n ChatOps workflow

**Real-time:** Each domain with live updates has a `*.gateway.ts` (Socket.IO `@WebSocketGateway`) that emits events to connected clients.

**n8n integration:** Services call n8n via HTTP (`N8N_URL` env var, default `http://n8n:5678`). Three webhooks are used:
- `/webhook/bug-fix` — triggers AI fix, returns PR data via `PUT /api/bugs/:id/n8n-update`
- `/webhook/report-summary` — returns AI summary text
- ChatOps webhook (configured in `chat/` module)

### Frontend (`frontend/src/app/`)

Angular 17 standalone components with lazy-loaded routes. No NgModules.

**Key structure:**
- `core/services/api.service.ts` — single centralized HTTP client; all backend calls go through here
- `core/services/websocket.service.ts` — raw WebSocket (not Socket.IO client) with auto-reconnect
- `core/interceptors/jwt.interceptor.ts` — attaches Bearer token from localStorage to every request
- `core/guards/auth.guard.ts` — redirects to `/login` if no token
- `features/` — one folder per page, each is a standalone component
- `shared/layout/` — shell with sidebar + navbar wrapping all authenticated pages
- `shared/chat-widget/` — floating ChatOps widget

**Environment config:** `src/environments/environment.ts` contains hardcoded IP (`apiUrl`, `wsUrl`, `n8nUrl`). Update this file when the host IP changes during local development.

### Infrastructure

| Service | Host port | Internal |
|---|---|---|
| PostgreSQL | 5433 | 5432 |
| Backend API | 3001 | 3000 |
| Frontend (nginx) | 4200 | 80 |

Nginx proxies `/api` and `/socket.io` to `pfe-backend:3000`. The Docker network is named `pfe-network` and must be created externally (`docker network create pfe-network`).

## Key Environment Variables (backend)

| Variable | Default | Purpose |
|---|---|---|
| `DB_HOST` | `postgres` | PostgreSQL host |
| `DB_USER` / `DB_PASS` / `DB_NAME` | `devsecops` / `devsecops123` / `devsecops` | DB credentials |
| `JWT_SECRET` | `devsecops-super-secret-2026` | Token signing key |
| `N8N_URL` | `http://n8n:5678` | n8n instance base URL |
| `N8N_BUG_FIX_WEBHOOK` | `/webhook/bug-fix` | Path for bug fix workflow |

## Default Credentials

| Role | Email | Password |
|---|---|---|
| Admin | admin@devsecops.local | Admin@123 |
| Developer | dev@devsecops.local | Dev@123 |

Seeded automatically on first backend startup.

## Data Model Notes

- `Bug.projectId` is a bare FK column alongside the `@ManyToOne` relation — always set both when creating bugs manually.
- `Report.securityScore` is computed from raw scan data (Trivy CVEs, SonarQube bugs/vulns, OWASP/ZAP alerts) and then written back to `Project.securityScore` / `Project.status` after each `combined` report.
- `TypeORM synchronize: true` means schema changes in entities apply automatically on restart — no migration files needed, but destructive column renames will cause data loss.

## n8n Workflows

Import JSON files from `n8n-workflows/` into n8n (http://localhost:5678, admin/admin123), then configure OpenAI credentials on each OpenAI node. Two workflows: `bug-fix-workflow.json` and `chatops-workflow.json`.
