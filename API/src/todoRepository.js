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

function serialize(row) {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    category: row.category,
    tags: JSON.parse(row.tags || "[]"),
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function createTodoRepository(database) {
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

    if (filters.category) {
      where.push("category = @category");
      parameters.category = filters.category;
    }

    if (filters.search) {
      where.push("(title LIKE @search OR description LIKE @search OR category LIKE @search OR tags LIKE @search)");
      parameters.search = `%${filters.search}%`;
    }

    const orderColumn = SORT_COLUMNS[filters.sort] || SORT_COLUMNS.created;
    const orderDirection = filters.order === "asc" ? "ASC" : "DESC";
    const nullsLast = filters.sort === "due" ? "due_date IS NULL ASC, " : "";
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    return database
      .prepare(`SELECT * FROM todos ${clause} ORDER BY ${nullsLast}${orderColumn} ${orderDirection}, id DESC`)
      .all(parameters)
      .map(serialize);
  }

  function findById(id) {
    return serialize(database.prepare("SELECT * FROM todos WHERE id = ?").get(id));
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
      tags: JSON.stringify(todo.tags),
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
      title: next.title,
      description: next.description,
      status: next.status,
      priority: next.priority,
      category: next.category,
      tags: JSON.stringify(next.tags),
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

module.exports = { createTodoRepository };
