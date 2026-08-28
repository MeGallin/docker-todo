const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");

function createDatabase(options = {}) {
  const dataDirectory = options.dataDirectory || process.env.DATA_DIR || DEFAULT_DATA_DIR;
  const filename = options.filename || process.env.DATABASE_FILE || "todos.sqlite";
  const databasePath = filename === ":memory:" ? filename : path.join(dataDirectory, filename);

  if (databasePath !== ":memory:") {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  database.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK(status IN ('todo', 'in_progress', 'completed')),
      priority TEXT NOT NULL DEFAULT 'medium'
        CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      category TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
    CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
    CREATE INDEX IF NOT EXISTS idx_todos_updated_at ON todos(updated_at);
  `);

  return database;
}

module.exports = { createDatabase };
