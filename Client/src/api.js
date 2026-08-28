const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:10000").replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (response.status === 204) return null;

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "The server could not complete the request");
    error.fields = body.fields || {};
    throw error;
  }
  return body;
}

export const api = {
  getTodos(query = {}) {
    const parameters = new URLSearchParams(
      Object.entries(query).filter(([, value]) => value !== undefined && value !== "" && value !== "all")
    );
    const suffix = parameters.size ? `?${parameters}` : "";
    return request(`/api/todos${suffix}`);
  },
  getStats: () => request("/api/stats"),
  createTodo: (todo) => request("/api/todos", { method: "POST", body: JSON.stringify(todo) }),
  updateTodo: (id, changes) => request(`/api/todos/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
  toggleTodo: (id) => request(`/api/todos/${id}/toggle`, { method: "POST" }),
  deleteTodo: (id) => request(`/api/todos/${id}`, { method: "DELETE" }),
  clearCompleted: () => request("/api/todos/completed", { method: "DELETE" }),
};
