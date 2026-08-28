const STATUSES = new Set(["todo", "in_progress", "completed"]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

class ValidationError extends Error {
  constructor(errors) {
    super("The request contains invalid task data");
    this.name = "ValidationError";
    this.errors = errors;
  }
}

function normalizeText(value, maximum, field, errors, required = false) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    errors[field] = "Must be text";
    return undefined;
  }

  const normalized = value.trim();
  if (required && !normalized) errors[field] = "This field is required";
  if (normalized.length > maximum) errors[field] = `Must be ${maximum} characters or fewer`;
  return normalized;
}

function validateTodo(input, { partial = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError({ body: "A JSON object is required" });
  }

  const errors = {};
  const todo = {};
  const title = normalizeText(input.title, 160, "title", errors, true);
  if (title !== undefined) todo.title = title;
  if (!partial && title === undefined) errors.title = "This field is required";

  const description = normalizeText(input.description, 2000, "description", errors);
  if (description !== undefined) todo.description = description;
  const category = normalizeText(input.category, 80, "category", errors);
  if (category !== undefined) todo.category = category;

  if (input.status !== undefined) {
    if (!STATUSES.has(input.status)) errors.status = "Choose todo, in_progress, or completed";
    else todo.status = input.status;
  }

  if (input.priority !== undefined) {
    if (!PRIORITIES.has(input.priority)) errors.priority = "Choose low, medium, high, or urgent";
    else todo.priority = input.priority;
  }

  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) {
      errors.tags = "Must be a list";
    } else {
      const tags = [...new Set(input.tags.map((tag) => String(tag).trim()).filter(Boolean))];
      if (tags.length > 10 || tags.some((tag) => tag.length > 32)) {
        errors.tags = "Use up to 10 tags, each 32 characters or fewer";
      } else {
        todo.tags = tags;
      }
    }
  }

  if (input.dueDate !== undefined) {
    if (input.dueDate === null || input.dueDate === "") {
      todo.dueDate = null;
    } else if (typeof input.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
      errors.dueDate = "Use a date in YYYY-MM-DD format";
    } else {
      const parsed = new Date(`${input.dueDate}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.dueDate) {
        errors.dueDate = "Use a valid calendar date";
      } else {
        todo.dueDate = input.dueDate;
      }
    }
  }

  if (Object.keys(errors).length) throw new ValidationError(errors);

  return partial
    ? todo
    : {
        title: todo.title,
        description: todo.description || "",
        status: todo.status || "todo",
        priority: todo.priority || "medium",
        category: todo.category || "",
        tags: todo.tags || [],
        dueDate: todo.dueDate || null,
      };
}

module.exports = { ValidationError, validateTodo, STATUSES, PRIORITIES };
