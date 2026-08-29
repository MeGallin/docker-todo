const SORT_COLUMNS = {
  created: "created_at",
  updated: "updated_at",
  due: "due_date",
  priority: `CASE priority
    WHEN 'urgent' THEN 4
    WHEN 'high' THEN 3
    WHEN 'medium' THEN 2
    ELSE 1 END`,
};

const { createFieldEncryption } = require("./encryption");

function serialize(row, encryption) {
  if (!row) return null;

  const tags = encryption.decrypt(row.tags || "[]");

  return {
    id: row.id,
    title: encryption.decrypt(row.title),
    description: encryption.decrypt(row.description),
    status: row.status,
    priority: row.priority,
    category: encryption.decrypt(row.category),
    tags: JSON.parse(tags || "[]"),
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function createTodoRepository(database, options = {}) {
  const encryption = createFieldEncryption(options.encryptionKey);
  initializeEncryption(database, encryption);

  function list(filters = {}) {
    const where = [];
    const parameters = {};

    if (filters.status && filters.status !== "all") {
      where.push("status = @status");
      parameters.status = filters.status;
    }

    if (filters.priority && filters.priority !== "all") {
      where.push("priority = @priority");
      parameters.priority = filters.priority;
    }

    const orderColumn = SORT_COLUMNS[filters.sort] || SORT_COLUMNS.created;
    const orderDirection = filters.order === "asc" ? "ASC" : "DESC";
    const nullsLast = filters.sort === "due" ? "due_date IS NULL ASC, " : "";
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    let todos = database
      .prepare(`SELECT * FROM todos ${clause} ORDER BY ${nullsLast}${orderColumn} ${orderDirection}, id DESC`)
      .all(parameters)
      .map((row) => serialize(row, encryption));

    if (filters.category) {
      const category = filters.category.toLocaleLowerCase();
      todos = todos.filter((todo) => todo.category.toLocaleLowerCase() === category);
    }

    if (filters.search) {
      const search = filters.search.toLocaleLowerCase();
      todos = todos.filter((todo) => [
        todo.title,
        todo.description,
        todo.category,
        todo.tags.join(" "),
      ].some((value) => value.toLocaleLowerCase().includes(search)));
    }

    return todos;
  }

  function findById(id) {
    return serialize(database.prepare("SELECT * FROM todos WHERE id = ?").get(id), encryption);
  }

  function create(todo) {
    const now = new Date().toISOString();
    const completedAt = todo.status === "completed" ? now : null;
    const result = database.prepare(`
      INSERT INTO todos (
        title, description, status, priority, category, tags,
        due_date, created_at, updated_at, completed_at
      ) VALUES (
        @title, @description, @status, @priority, @category, @tags,
        @dueDate, @createdAt, @updatedAt, @completedAt
      )
    `).run({
      ...todo,
      title: encryption.encrypt(todo.title),
      description: encryption.encrypt(todo.description),
      category: encryption.encrypt(todo.category),
      tags: encryption.encrypt(JSON.stringify(todo.tags)),
      createdAt: now,
      updatedAt: now,
      completedAt,
    });

    return findById(result.lastInsertRowid);
  }

  function update(id, changes) {
    const existing = findById(id);
    if (!existing) return null;

    const next = { ...existing, ...changes };
    const now = new Date().toISOString();
    const completedAt = next.status === "completed"
      ? existing.completedAt || now
      : null;

    database.prepare(`
      UPDATE todos SET
        title = @title,
        description = @description,
        status = @status,
        priority = @priority,
        category = @category,
        tags = @tags,
        due_date = @dueDate,
        updated_at = @updatedAt,
        completed_at = @completedAt
      WHERE id = @id
    `).run({
      id,
      title: encryption.encrypt(next.title),
      description: encryption.encrypt(next.description),
      status: next.status,
      priority: next.priority,
      category: encryption.encrypt(next.category),
      tags: encryption.encrypt(JSON.stringify(next.tags)),
      dueDate: next.dueDate,
      updatedAt: now,
      completedAt,
    });

    return findById(id);
  }

  function remove(id) {
    return database.prepare("DELETE FROM todos WHERE id = ?").run(id).changes > 0;
  }

  function removeCompleted() {
    return database.prepare("DELETE FROM todos WHERE status = 'completed'").run().changes;
  }

  function stats() {
    const counts = database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todo,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status != 'completed' AND due_date IS NOT NULL AND due_date < @today THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN status != 'completed' AND priority = 'urgent' THEN 1 ELSE 0 END) AS urgent
      FROM todos
    `).get({ today: new Date().toISOString().slice(0, 10) });

    return Object.fromEntries(
      Object.entries(counts).map(([key, value]) => [key === "in_progress" ? "inProgress" : key, Number(value || 0)])
    );
  }

  return { list, findById, create, update, remove, removeCompleted, stats };
}

function initializeEncryption(database, encryption) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const storedCheck = database
    .prepare("SELECT value FROM app_metadata WHERE key = 'encryption_key_check'")
    .get();

  if (storedCheck) {
    const value = encryption.decrypt(storedCheck.value);
    if (value !== encryption.keyCheckValue) {
      throw new Error("TODO_ENCRYPTION_KEY does not match this database.");
    }
  } else {
    database.prepare(`
      INSERT INTO app_metadata (key, value)
      VALUES ('encryption_key_check', ?)
    `).run(encryption.encrypt(encryption.keyCheckValue));
  }

  const rows = database
    .prepare("SELECT id, title, description, category, tags FROM todos")
    .all();
  const update = database.prepare(`
    UPDATE todos
    SET title = @title, description = @description, category = @category, tags = @tags
    WHERE id = @id
  `);

  database.transaction((items) => {
    for (const row of items) {
      if ([row.title, row.description, row.category, row.tags].every(encryption.isEncrypted)) continue;
      update.run({
        id: row.id,
        title: encryption.encryptIfNeeded(row.title),
        description: encryption.encryptIfNeeded(row.description),
        category: encryption.encryptIfNeeded(row.category),
        tags: encryption.encryptIfNeeded(row.tags),
      });
    }
  })(rows);
}

module.exports = { createTodoRepository };
