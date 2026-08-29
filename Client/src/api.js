const configuredApiUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const defaultApiUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:10000";
const API_BASE_URL = (configuredApiUrl || defaultApiUrl).replace(/\/$/, "");
let csrfToken = null;

async function request(path, options = {}, behavior = {}) {
  const method = (options.method || "GET").toUpperCase();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken
        ? { "X-CSRF-Token": csrfToken }
        : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) return null;

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "The server could not complete the request");
    error.fields = body.fields || {};
    error.status = response.status;
    if (response.status === 401 && !behavior.suppressUnauthorized) {
      csrfToken = null;
      window.dispatchEvent(new Event("docklist:unauthorized"));
    }
    throw error;
  }
  return body;
}

export const api = {
  async getSession() {
    try {
      const result = await request("/api/auth/session", {}, { suppressUnauthorized: true });
      csrfToken = result.csrfToken;
      return result;
    } catch (error) {
      if (error.status === 401) {
        csrfToken = null;
        return { authenticated: false };
      }
      throw error;
    }
  },
  async login(password) {
    const result = await request(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ password }) },
      { suppressUnauthorized: true }
    );
    csrfToken = result.csrfToken;
    return result;
  },
  async logout() {
    const sendLogout = () => request("/api/auth/logout", { method: "POST", keepalive: true });
    try {
      await sendLogout();
    } catch (error) {
      if (error.status !== 403) throw error;
      const session = await request("/api/auth/session", {}, { suppressUnauthorized: true });
      csrfToken = session.csrfToken;
      await sendLogout();
    }
    csrfToken = null;
  },
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
