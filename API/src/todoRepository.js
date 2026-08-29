const { createFieldEncryption } = require("./encryption");

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

function serialize(row, encryption) {
  if (!row) return null;

  const tags = encryption.decrypt(row.tags || "[]");
  return {
    id: Number(row.id),
    title: encryption.decrypt(row.title),
    description: encryption.decrypt(row.description),
    status: row.status,
    priority: row.priority,
    category: encryption.decrypt(row.category),
    tags: JSON.parse(tags || "[]"),
    dueDate: formatDate(row.due_date),
    createdAt: formatTimestamp(row.created_at),
    updatedAt: formatTimestamp(row.updated_at),
    completedAt: formatTimestamp(row.completed_at),
  };
}

async function createTodoRepository(database, options = {}) {
  const encryption = createFieldEncryption(options.encryptionKey);
  await initializeEncryption(database, encryption);

  async function list(filters = {}) {
    const where = [];
    const parameters = [];

    if (filters.status && filters.status !== "all") {
      parameters.push(filters.status);
      where.push(`status = $${parameters.length}`);
    }
    if (filters.priority && filters.priority !== "all") {
      parameters.push(filters.priority);
      where.push(`priority = $${parameters.length}`);
    }

    const orderColumn = SORT_COLUMNS[filters.sort] || SORT_COLUMNS.created;
    const orderDirection = filters.order === "asc" ? "ASC" : "DESC";
    const nullsLast = filters.sort === "due" ? " NULLS LAST" : "";
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await database.query(
      `SELECT * FROM todos ${clause} ORDER BY ${orderColumn} ${orderDirection}${nullsLast}, id DESC`,
      parameters
    );
    let todos = result.rows.map((row) => serialize(row, encryption));

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

  async function findById(id) {
    const result = await database.query("SELECT * FROM todos WHERE id = $1", [id]);
    return serialize(result.rows[0], encryption);
  }

  async function create(todo) {
    const now = new Date();
    const completedAt = todo.status === "completed" ? now : null;
    const result = await database.query(`
      INSERT INTO todos (
        title, description, status, priority, category, tags,
        due_date, created_at, updated_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
      RETURNING *
    `, [
      encryption.encrypt(todo.title),
      encryption.encrypt(todo.description),
      todo.status,
      todo.priority,
      encryption.encrypt(todo.category),
      encryption.encrypt(JSON.stringify(todo.tags)),
      todo.dueDate,
      now,
      completedAt,
    ]);
    return serialize(result.rows[0], encryption);
  }

  async function update(id, changes) {
    const existing = await findById(id);
    if (!existing) return null;

    const next = { ...existing, ...changes };
    const now = new Date();
    const completedAt = next.status === "completed"
      ? existing.completedAt || now
      : null;
    const result = await database.query(`
      UPDATE todos SET
        title = $2,
        description = $3,
        status = $4,
        priority = $5,
        category = $6,
        tags = $7,
        due_date = $8,
        updated_at = $9,
        completed_at = $10
      WHERE id = $1
      RETURNING *
    `, [
      id,
      encryption.encrypt(next.title),
      encryption.encrypt(next.description),
      next.status,
      next.priority,
      encryption.encrypt(next.category),
      encryption.encrypt(JSON.stringify(next.tags)),
      next.dueDate,
      now,
      completedAt,
    ]);
    return serialize(result.rows[0], encryption);
  }

  async function remove(id) {
    const result = await database.query("DELETE FROM todos WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  async function removeCompleted() {
    const result = await database.query("DELETE FROM todos WHERE status = 'completed'");
    return result.rowCount;
  }

  async function stats() {
    const result = await database.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'todo') AS todo,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (
          WHERE status != 'completed' AND due_date IS NOT NULL AND due_date < CURRENT_DATE
        ) AS overdue,
        COUNT(*) FILTER (WHERE status != 'completed' AND priority = 'urgent') AS urgent
      FROM todos
    `);
    return Object.fromEntries(
      Object.entries(result.rows[0]).map(([key, value]) => [
        key === "in_progress" ? "inProgress" : key,
        Number(value || 0),
      ])
    );
  }

  return { list, findById, create, update, remove, removeCompleted, stats };
}

async function initializeEncryption(database, encryption) {
  const checkResult = await database.query(
    "SELECT value FROM app_metadata WHERE key = 'encryption_key_check'"
  );
  const storedCheck = checkResult.rows[0];

  if (storedCheck) {
    const value = encryption.decrypt(storedCheck.value);
    if (value !== encryption.keyCheckValue) {
      throw new Error("TODO_ENCRYPTION_KEY does not match this database.");
    }
  } else {
    await database.query(
      "INSERT INTO app_metadata (key, value) VALUES ('encryption_key_check', $1)",
      [encryption.encrypt(encryption.keyCheckValue)]
    );
  }

  const result = await database.query("SELECT id, title, description, category, tags FROM todos");
  const plaintextRows = result.rows.filter((row) => (
    ![row.title, row.description, row.category, row.tags].every(encryption.isEncrypted)
  ));
  if (!plaintextRows.length) return;

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    for (const row of plaintextRows) {
      await client.query(`
        UPDATE todos
        SET title = $2, description = $3, category = $4, tags = $5
        WHERE id = $1
      `, [
        row.id,
        encryption.encryptIfNeeded(row.title),
        encryption.encryptIfNeeded(row.description),
        encryption.encryptIfNeeded(row.category),
        encryption.encryptIfNeeded(row.tags),
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function formatDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function formatTimestamp(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

module.exports = { createTodoRepository };
