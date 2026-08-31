# Docker Todo

A full-stack task manager built as one Docker deployment for Render:

- `API`: Node.js, Express, and PostgreSQL
- `Client`: React and Vite, compiled into the same container
- Production: Express serves both the interface and the REST API from one URL

## Features

- Create, edit, complete, reopen, and delete tasks
- Workflow states: to do, in progress, and completed
- Four priority levels, due dates, categories, tags, and notes
- Search, status and priority filters, sorting, progress statistics, and overdue tracking
- Responsive light and dark interface with loading, empty, and error states
- Request validation, CORS controls, health checks, and automated API tests
- AES-256-GCM encryption for task titles, descriptions, categories, and tags at rest
- Single-user password authentication with server-side sessions and CSRF protection

## Design system

The interface follows [`nexus-engine-redux-DESIGN.md`](./nexus-engine-redux-DESIGN.md). The application-ready semantic tokens live in `Client/src/design-system.css`; component and responsive rules live in `Client/src/styles.css`. Inter is reserved for display typography, while JetBrains Mono is used for body copy, controls, labels, and technical metadata. Both fonts are self-hosted through Fontsource packages.

## Run locally

Use two terminals.

### API

```powershell
cd API
npm install
Copy-Item .env.example .env
# Generate a key, then put the resulting value in TODO_ENCRYPTION_KEY in .env:
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# Generate the password hash, then put the complete value in APP_PASSWORD_HASH in .env:
npm run auth:hash
$env:TODO_ENCRYPTION_KEY = (Get-Content .env | Select-String '^TODO_ENCRYPTION_KEY=').Line.Split('=', 2)[1]
$env:APP_PASSWORD_HASH = (Get-Content .env | Select-String '^APP_PASSWORD_HASH=').Line.Split('=', 2)[1]
$env:DATABASE_URL = (Get-Content .env | Select-String '^DATABASE_URL=').Line.Split('=', 2)[1]
npm run dev
```

The API runs at `http://localhost:10000`. `DATABASE_URL` can point to a local PostgreSQL server or a hosted provider such as Neon. The API creates its tables and indexes automatically when it starts.

### Client

```powershell
cd Client
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check the API and database |
| `GET` | `/api/todos` | List, search, filter, and sort tasks |
| `POST` | `/api/todos` | Create a task |
| `GET` | `/api/todos/:id` | Read one task |
| `PATCH` | `/api/todos/:id` | Update part of a task |
| `POST` | `/api/todos/:id/toggle` | Complete or reopen a task |
| `DELETE` | `/api/todos/:id` | Delete a task |
| `DELETE` | `/api/todos/completed` | Delete all completed tasks |
| `GET` | `/api/stats` | Read task totals and attention counts |

List requests accept `status`, `priority`, `category`, `search`, `sort`, and `order` query parameters.

## Test and build

```powershell
npm --prefix API test
npm --prefix Client run build
```

## Docker

The repository-level Dockerfile builds the React client, installs the Express API, and produces one lean runtime image:

```powershell
docker build -t docker-todo .
docker run --rm -p 10000:10000 `
  -e DATABASE_URL="your-postgresql-connection-string" `
  -e TODO_ENCRYPTION_KEY="your-base64-key" `
  -e APP_PASSWORD_HASH='your-complete-argon2id-hash' `
  docker-todo
```

Open `http://localhost:10000` for the application. The API remains available under `/api`.

## Render configuration

The Render web service uses:

- Runtime: Docker
- Root directory: blank, so the repository root is used
- Dockerfile path: `./Dockerfile`
- Health check path: `/health`
- Secret environment variable: `DATABASE_URL`
- Secret environment variable: `TODO_ENCRYPTION_KEY`
- Secret environment variable: `APP_PASSWORD_HASH`

The container is stateless. Tasks, encryption metadata, and login sessions are stored in the external PostgreSQL database, so Render can restart or replace the Docker container without losing them.

## Database encryption

Task titles, descriptions, categories, and tags are encrypted with AES-256-GCM before they are written to PostgreSQL. Status, priority, due dates, IDs, and timestamps remain unencrypted so the API can efficiently sort tasks and calculate statistics. Existing plaintext task content is encrypted automatically the first time the application starts with a key.

`TODO_ENCRYPTION_KEY` must be a base64-encoded 32-byte secret. Keep the same value for the lifetime of the database and store a secure backup separately. Losing the key makes the encrypted task content unrecoverable; changing it without a controlled key-rotation migration prevents the database from opening. Never commit the key to Git.

On Render, create the key locally and add it under the service's **Environment** settings before deploying this version. The key is deliberately not included in the Docker image or repository.

## Single-user authentication

The application requires one password and does not provide registration, usernames, email recovery, or multiple accounts. The password itself is never stored. `APP_PASSWORD_HASH` contains an Argon2id hash generated locally with:

```powershell
cd API
npm run auth:hash
```

After a successful login, the server creates a random session and stores only a SHA-256 hash of its token in PostgreSQL. The browser receives the original token in a session-only cookie configured as `HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/`. Sessions expire server-side after 12 hours by default; set `AUTH_SESSION_HOURS` to a different positive number if required.

All Todo and statistics API routes require a valid session. Modifying requests also require a per-session CSRF token and a same-origin request. Login attempts are limited to five failures per 15 minutes. `/health` remains public for Render monitoring, while the React application displays only the login screen until authentication succeeds.

Changing `APP_PASSWORD_HASH` automatically invalidates existing sessions. Keep it separate from `TODO_ENCRYPTION_KEY`; never derive one from the other or commit either value to Git.

In production the client calls the API on the same origin, so no frontend URL or CORS environment variable is required. `VITE_API_BASE_URL` and `CLIENT_ORIGINS` remain available for separate development environments.

## Persistent storage on Render

The Render web service and its Docker filesystem are intentionally stateless. All durable application data lives in PostgreSQL through `DATABASE_URL`. Deployments, restarts, and free-service spin-downs therefore do not remove tasks or login sessions.

The current deployment uses Neon PostgreSQL in Frankfurt so the database is close to the Render service. Keep the connection string secret and rotate its database password if it is ever exposed.
