# Docker Todo

A full-stack task manager built as one Docker deployment for Render:

- `API`: Node.js, Express, and SQLite
- `Client`: React and Vite, compiled into the same container
- Production: Express serves both the interface and the REST API from one URL

## Features

- Create, edit, complete, reopen, and delete tasks
- Workflow states: to do, in progress, and completed
- Four priority levels, due dates, categories, tags, and notes
- Search, status and priority filters, sorting, progress statistics, and overdue tracking
- Responsive light and dark interface with loading, empty, and error states
- Request validation, CORS controls, health checks, and automated API tests

## Run locally

Use two terminals.

### API

```powershell
cd API
npm install
npm run dev
```

The API runs at `http://localhost:10000`. SQLite creates `API/data/todos.sqlite` automatically. The database file is ignored by Git.

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

The repository-level Dockerfile builds the React client, compiles the SQLite driver, and produces one lean runtime image:

```powershell
docker build -t docker-todo .
docker run --rm -p 10000:10000 docker-todo
```

Open `http://localhost:10000` for the application. The API remains available under `/api`.

## Render configuration

The Render web service uses:

- Runtime: Docker
- Root directory: blank, so the repository root is used
- Dockerfile path: `./Dockerfile`
- Health check path: `/health`

The container stores SQLite at `/app/data/todos.sqlite`. `DATA_DIR` and `DATABASE_FILE` can change that location without changing application code.

In production the client calls the API on the same origin, so no frontend URL or CORS environment variable is required. `VITE_API_BASE_URL` and `CLIENT_ORIGINS` remain available for separate development environments.

## SQLite on Render free services

This is a good prototype architecture, but the free service filesystem is ephemeral. Tasks can be lost after a restart, spin-down, or redeployment. Production options are:

1. Attach a Render persistent disk to `/app/data` on a paid service.
2. Move the repository layer to Render Postgres for durable, multi-instance storage.

The API and client are separated so the second option does not require a frontend rewrite.
