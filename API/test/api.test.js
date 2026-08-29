const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const argon2 = require("argon2");
const { createApp } = require("../src/app");
const { createDatabase } = require("../src/database");

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function setup() {
  const database = createDatabase({ filename: ":memory:" });
  return {
    database,
    app: createApp(database, { encryptionKey: TEST_ENCRYPTION_KEY, disableAuthentication: true }),
  };
}

test("health checks both the service and database", async () => {
  const { app, database } = setup();
  const response = await request(app).get("/health").expect(200);
  assert.deepEqual(response.body, { status: "ok", database: "connected" });
  database.close();
});

test("creates, lists, updates, toggles, and deletes a task", async () => {
  const { app, database } = setup();

  const created = await request(app)
    .post("/api/todos")
    .send({
      title: "Ship the Docker prototype",
      description: "Confirm the complete request cycle.",
      priority: "high",
      category: "Launch",
      tags: ["docker", "render"],
      dueDate: "2026-09-01",
    })
    .expect(201);

  assert.equal(created.body.todo.title, "Ship the Docker prototype");
  assert.deepEqual(created.body.todo.tags, ["docker", "render"]);

  const stored = database.prepare("SELECT title, description, category, tags FROM todos").get();
  for (const value of Object.values(stored)) {
    assert.match(value, /^enc:v1:/);
    assert.equal(value.includes("Docker"), false);
  }

  const listed = await request(app).get("/api/todos?priority=high&search=Docker").expect(200);
  assert.equal(listed.body.todos.length, 1);

  const categoryFiltered = await request(app).get("/api/todos?category=launch").expect(200);
  assert.equal(categoryFiltered.body.todos.length, 1);

  const updated = await request(app)
    .patch(`/api/todos/${created.body.todo.id}`)
    .send({ status: "in_progress" })
    .expect(200);
  assert.equal(updated.body.todo.status, "in_progress");

  const toggled = await request(app)
    .post(`/api/todos/${created.body.todo.id}/toggle`)
    .expect(200);
  assert.equal(toggled.body.todo.status, "completed");
  assert.ok(toggled.body.todo.completedAt);

  const stats = await request(app).get("/api/stats").expect(200);
  assert.equal(stats.body.stats.completed, 1);

  await request(app).delete(`/api/todos/${created.body.todo.id}`).expect(204);
  await request(app).get(`/api/todos/${created.body.todo.id}`).expect(404);
  database.close();
});

test("sorts dated tasks from nearest to latest with undated tasks last", async () => {
  const { app, database } = setup();
  const tasks = [
    { title: "Later task", dueDate: "2026-09-10" },
    { title: "Undated task", dueDate: null },
    { title: "Sooner task", dueDate: "2026-09-02" },
  ];

  for (const task of tasks) {
    await request(app).post("/api/todos").send(task).expect(201);
  }

  const response = await request(app).get("/api/todos?sort=due&order=asc").expect(200);
  assert.deepEqual(
    response.body.todos.map((todo) => todo.title),
    ["Sooner task", "Later task", "Undated task"]
  );
  database.close();
});

test("encrypts existing plaintext tasks when encryption is enabled", async () => {
  const database = createDatabase({ filename: ":memory:" });
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO todos (
      title, description, status, priority, category, tags,
      due_date, created_at, updated_at, completed_at
    ) VALUES (?, ?, 'todo', 'medium', ?, ?, NULL, ?, ?, NULL)
  `).run("Existing task", "Private notes", "Personal", '["legacy"]', now, now);

  const app = createApp(database, { encryptionKey: TEST_ENCRYPTION_KEY, disableAuthentication: true });
  const stored = database.prepare("SELECT title, description, category, tags FROM todos").get();
  Object.values(stored).forEach((value) => assert.match(value, /^enc:v1:/));

  const response = await request(app).get("/api/todos?search=private&category=Personal").expect(200);
  assert.equal(response.body.todos.length, 1);
  assert.equal(response.body.todos[0].title, "Existing task");
  assert.equal(response.body.todos[0].description, "Private notes");
  database.close();
});

test("rejects invalid task data", async () => {
  const { app, database } = setup();
  const response = await request(app)
    .post("/api/todos")
    .send({ title: "", priority: "impossible", dueDate: "2026-02-30" })
    .expect(400);

  assert.equal(response.body.fields.title, "This field is required");
  assert.ok(response.body.fields.priority);
  assert.ok(response.body.fields.dueDate);
  database.close();
});

test("protects the API with a login session and CSRF token", async () => {
  const password = "correct horse battery staple";
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 8192,
    timeCost: 1,
    parallelism: 1,
  });
  const database = createDatabase({ filename: ":memory:" });
  const app = createApp(database, {
    encryptionKey: TEST_ENCRYPTION_KEY,
    passwordHash,
    secureCookies: false,
  });

  await request(app).get("/api/todos").expect(401);
  await request(app).post("/api/auth/login").send({ password: "wrong password" }).expect(401);

  const login = await request(app)
    .post("/api/auth/login")
    .send({ password })
    .expect(200);
  const cookieHeader = login.headers["set-cookie"][0];
  const sessionCookie = cookieHeader.split(";")[0];
  assert.equal(login.body.authenticated, true);
  assert.ok(login.body.csrfToken);
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);

  await request(app).get("/api/todos").set("Cookie", sessionCookie).expect(200);
  await request(app)
    .post("/api/todos")
    .set("Cookie", sessionCookie)
    .send({ title: "Missing CSRF" })
    .expect(403);

  await request(app)
    .post("/api/todos")
    .set("Cookie", sessionCookie)
    .set("X-CSRF-Token", login.body.csrfToken)
    .send({ title: "Authenticated task" })
    .expect(201);

  const session = await request(app)
    .get("/api/auth/session")
    .set("Cookie", sessionCookie)
    .expect(200);
  assert.equal(session.body.csrfToken, login.body.csrfToken);

  const logout = await request(app)
    .post("/api/auth/logout")
    .set("Cookie", sessionCookie)
    .set("X-CSRF-Token", login.body.csrfToken)
    .expect(204);
  assert.match(logout.headers["set-cookie"][0], /Max-Age=0/);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count, 0);

  await request(app).get("/api/todos").set("Cookie", sessionCookie).expect(401);
  database.close();
});
