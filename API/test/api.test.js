const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createDatabase } = require("../src/database");

function setup() {
  const database = createDatabase({ filename: ":memory:" });
  return { database, app: createApp(database) };
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

  const listed = await request(app).get("/api/todos?priority=high&search=Docker").expect(200);
  assert.equal(listed.body.todos.length, 1);

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
