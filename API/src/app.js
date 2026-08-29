const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");
const helmet = require("helmet");
const { createTodoRepository } = require("./todoRepository");
const { createAuthentication } = require("./auth");
const { ValidationError, validateTodo, STATUSES, PRIORITIES } = require("./validation");

function createCorsOptions(request, callback) {
  const configured = process.env.CLIENT_ORIGINS
    ? process.env.CLIENT_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];
  const allowed = new Set(["http://localhost:5173", "http://127.0.0.1:5173", ...configured]);
  const origin = request.get("Origin");
  let sameHost = false;

  if (origin) {
    try {
      sameHost = new URL(origin).host === request.get("host");
    } catch {
      sameHost = false;
    }
  }

  callback(null, {
    origin: !origin || sameHost || allowed.has(origin),
    credentials: true,
  });
}

function createApp(database, options = {}) {
  const app = express();
  const todos = createTodoRepository(database, { encryptionKey: options.encryptionKey });
  const publicDirectory = path.resolve(
    options.publicDirectory || process.env.PUBLIC_DIR || path.join(__dirname, "..", "public")
  );
  const clientEntry = path.join(publicDirectory, "index.html");
  const hasClient = fs.existsSync(clientEntry);

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({
    strictTransportSecurity: process.env.NODE_ENV === "production" ? undefined : false,
  }));
  app.use(cors(createCorsOptions));
  app.use(express.json({ limit: "32kb" }));
  if (hasClient) app.use(express.static(publicDirectory));

  app.get("/health", (_request, response) => {
    database.prepare("SELECT 1").get();
    response.status(200).json({ status: "ok", database: "connected" });
  });

  if (!options.disableAuthentication) {
    const authentication = createAuthentication(database, {
      passwordHash: options.passwordHash,
      secureCookies: options.secureCookies,
      sessionHours: options.sessionHours,
    });
    app.use("/api/auth", authentication.router);
    app.use("/api", authentication.authenticate, authentication.requireCsrf);
  }

  app.get("/api", (_request, response) => {
    response.json({
      name: "Docker Todo API",
      endpoints: {
        todos: "GET, POST /api/todos",
        todo: "GET, PATCH, DELETE /api/todos/:id",
        toggle: "POST /api/todos/:id/toggle",
        clearCompleted: "DELETE /api/todos/completed",
        stats: "GET /api/stats",
      },
    });
  });

  app.get("/api/todos", (request, response) => {
    const { status, priority, search, category, sort, order } = request.query;
    if (status && status !== "all" && !STATUSES.has(status)) {
      throw new ValidationError({ status: "Unknown status filter" });
    }
    if (priority && priority !== "all" && !PRIORITIES.has(priority)) {
      throw new ValidationError({ priority: "Unknown priority filter" });
    }
    response.json({ todos: todos.list({ status, priority, search, category, sort, order }) });
  });

  app.get("/api/todos/:id", (request, response) => {
    const todo = todos.findById(parseId(request.params.id));
    if (!todo) return response.status(404).json({ error: "Task not found" });
    return response.json({ todo });
  });

  app.post("/api/todos", (request, response) => {
    const todo = todos.create(validateTodo(request.body));
    response.status(201).json({ todo });
  });

  app.patch("/api/todos/:id", (request, response) => {
    const id = parseId(request.params.id);
    const changes = validateTodo(request.body, { partial: true });
    if (!Object.keys(changes).length) throw new ValidationError({ body: "Include at least one task field" });
    const todo = todos.update(id, changes);
    if (!todo) return response.status(404).json({ error: "Task not found" });
    return response.json({ todo });
  });

  app.post("/api/todos/:id/toggle", (request, response) => {
    const id = parseId(request.params.id);
    const existing = todos.findById(id);
    if (!existing) return response.status(404).json({ error: "Task not found" });
    const status = existing.status === "completed" ? "todo" : "completed";
    return response.json({ todo: todos.update(id, { status }) });
  });

  app.delete("/api/todos/completed", (_request, response) => {
    response.json({ deleted: todos.removeCompleted() });
  });

  app.delete("/api/todos/:id", (request, response) => {
    const removed = todos.remove(parseId(request.params.id));
    if (!removed) return response.status(404).json({ error: "Task not found" });
    return response.status(204).end();
  });

  app.get("/api/stats", (_request, response) => {
    response.json({ stats: todos.stats() });
  });

  app.use((request, response, next) => {
    const acceptsHtml = request.accepts("html");
    if (hasClient && request.method === "GET" && acceptsHtml && !request.path.startsWith("/api")) {
      return response.sendFile(clientEntry);
    }
    return next();
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Endpoint not found" });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof ValidationError) {
      return response.status(400).json({ error: error.message, fields: error.errors });
    }
    console.error(error);
    return response.status(500).json({ error: "Unexpected server error" });
  });

  return app;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new ValidationError({ id: "Use a positive task ID" });
  return id;
}

module.exports = { createApp };
