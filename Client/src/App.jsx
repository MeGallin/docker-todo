import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  Check,
  CheckCircle,
  Circle,
  ClockCountdown,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  Moon,
  NotePencil,
  Plus,
  Sun,
  SignOut,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import { api } from "./api";

const EMPTY_TASK = {
  title: "",
  description: "",
  status: "todo",
  priority: "medium",
  category: "",
  tags: [],
  dueDate: "",
};

const STATUS_LABELS = {
  todo: "To do",
  in_progress: "In progress",
  completed: "Completed",
};

const PRIORITY_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const DEFAULT_FILTERS = {
  status: "all",
  priority: "all",
  category: "",
  search: "",
  sort: "created",
  order: "desc",
};

function App() {
  const [todos, setTodos] = useState([]);
  const [stats, setStats] = useState({ total: 0, todo: 0, inProgress: 0, completed: 0, overdue: 0, urgent: 0 });
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [draftSearch, setDraftSearch] = useState("");
  const [view, setView] = useState("tasks");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [authStatus, setAuthStatus] = useState("loading");
  const [authError, setAuthError] = useState("");
  const [authenticating, setAuthenticating] = useState(false);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("docklist-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [todoResult, statsResult] = await Promise.all([api.getTodos(filters), api.getStats()]);
      setTodos(todoResult.todos);
      setStats(statsResult.stats);
    } catch (requestError) {
      if (requestError.status === 401) setAuthStatus("unauthenticated");
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.search === draftSearch ? current : { ...current, search: draftSearch }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftSearch]);

  useEffect(() => {
    if (authStatus === "authenticated") loadData();
  }, [authStatus, loadData]);

  useEffect(() => {
    let active = true;
    api.getSession()
      .then((session) => {
        if (active) setAuthStatus(session.authenticated ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (active) {
          setAuthError("The login service could not be reached. Try again.");
          setAuthStatus("unauthenticated");
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function handleUnauthorized() {
      setTodos([]);
      setStats({ total: 0, todo: 0, inProgress: 0, completed: 0, overdue: 0, urgent: 0 });
      setAuthStatus("unauthenticated");
    }
    window.addEventListener("docklist:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("docklist:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    localStorage.setItem("docklist-theme", theme);
  }, [theme]);

  const completionRate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
  const visibleTodos = view === "upcoming"
    ? todos.filter((todo) => todo.status !== "completed" && todo.dueDate)
    : todos;
  const activeFilterCount = [
    filters.status !== "all",
    filters.priority !== "all",
    Boolean(filters.category),
  ].filter(Boolean).length;

  async function mutate(action) {
    setSaving(true);
    setError("");
    try {
      await action();
      await loadData();
      return true;
    } catch (requestError) {
      if (requestError.status === 401) setAuthStatus("unauthenticated");
      setError(requestError.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createTask(task) {
    const success = await mutate(() => api.createTodo(task));
    if (success) setComposerOpen(false);
    return success;
  }

  async function updateTask(task) {
    const { id, createdAt, updatedAt, completedAt, ...changes } = task;
    const success = await mutate(() => api.updateTodo(id, changes));
    if (success) setEditing(null);
    return success;
  }

  function selectView(nextView) {
    setView(nextView);
    setFilters((current) => ({
      ...current,
      status: nextView === "upcoming" ? "all" : current.status,
      sort: nextView === "upcoming" ? "due" : "created",
      order: nextView === "upcoming" ? "asc" : "desc",
    }));
  }

  async function confirmDestructiveAction() {
    if (!confirmation) return;
    const action = confirmation.kind === "task"
      ? () => api.deleteTodo(confirmation.todo.id)
      : api.clearCompleted;
    const success = await mutate(action);
    if (success) setConfirmation(null);
  }

  async function login(password) {
    setAuthenticating(true);
    setAuthError("");
    try {
      await api.login(password);
      setAuthStatus("authenticated");
      return true;
    } catch (requestError) {
      setAuthError(requestError.message);
      return false;
    } finally {
      setAuthenticating(false);
    }
  }

  async function logout() {
    setSaving(true);
    setError("");
    try {
      await api.logout();
      setTodos([]);
      setStats({ total: 0, todo: 0, inProgress: 0, completed: 0, overdue: 0, urgent: 0 });
      setAuthStatus("unauthenticated");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  const todayText = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date()),
    []
  );

  if (authStatus === "loading") {
    return <AuthLoading theme={theme} />;
  }

  if (authStatus === "unauthenticated") {
    return <LoginScreen theme={theme} error={authError} authenticating={authenticating} onLogin={login} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Application navigation">
        <div className="brand-mark" aria-hidden="true"><Check weight="bold" /></div>
        <nav>
          <button
            className={`nav-icon ${view === "tasks" ? "active" : ""}`}
            aria-label="Tasks"
            aria-current={view === "tasks" ? "page" : undefined}
            onClick={() => selectView("tasks")}
          ><ListChecks /></button>
          <button
            className={`nav-icon ${view === "upcoming" ? "active" : ""}`}
            aria-label="Upcoming"
            aria-current={view === "upcoming" ? "page" : undefined}
            onClick={() => selectView("upcoming")}
          ><CalendarBlank /></button>
        </nav>
        <div className="sidebar-actions">
          <button className="nav-icon" aria-label="Log out" disabled={saving} onClick={logout}><SignOut /></button>
          <button
            className="nav-icon theme-button"
            aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="page-header">
          <div>
            <p className="date-line">{todayText}</p>
            <h1>{view === "upcoming" ? "See what’s ahead." : "Make today count."}</h1>
            <p className="header-copy">
              {view === "upcoming"
                ? "Review every active task with a due date, ordered from the nearest deadline."
                : "Capture the work, choose what matters, and finish with focus."}
            </p>
          </div>
          <button className="primary-button" onClick={() => setComposerOpen(true)}>
            <Plus weight="bold" /> Add task
          </button>
        </header>

        <section className="summary-grid" aria-label="Task summary">
          <div className="progress-panel">
            <div className="progress-copy">
              <span>Overall progress</span>
              <strong>{completionRate}%</strong>
              <small>{stats.completed} of {stats.total} tasks complete</small>
            </div>
            <div className="progress-ring" style={{ "--progress": `${completionRate * 3.6}deg` }} aria-label={`${completionRate}% complete`}>
              <span>{completionRate}%</span>
            </div>
          </div>
          <Stat label="In progress" value={stats.inProgress} icon={<ClockCountdown />} />
          <Stat label="Due attention" value={stats.overdue + stats.urgent} icon={<Warning />} tone="warning" />
        </section>

        <section className="task-section">
          <div className="task-heading">
            <div>
              <h2>{view === "upcoming" ? "Upcoming tasks" : "Your tasks"}</h2>
              <p>{view === "upcoming"
                ? `${visibleTodos.length} dated ${visibleTodos.length === 1 ? "task" : "tasks"}`
                : stats.total ? `${stats.total - stats.completed} still active` : "A clear list starts here"}</p>
            </div>
            {stats.completed > 0 && (
              <button
                className="text-button danger"
                disabled={saving}
                onClick={() => setConfirmation({ kind: "completed", count: stats.completed })}
              >
                <Trash /> Clear completed
              </button>
            )}
          </div>

          <div className="toolbar">
            <label className="search-field">
              <span className="sr-only">Search tasks</span>
              <MagnifyingGlass />
              <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search tasks" />
              {draftSearch && <button aria-label="Clear search" onClick={() => setDraftSearch("")}><X /></button>}
            </label>
            <label>
              <span className="sr-only">Filter by status</span>
              <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
                <option value="all">All statuses</option>
                <option value="todo">To do</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by priority</span>
              <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
                <option value="all">All priorities</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="filter-field">
              <span className="sr-only">Filter by category</span>
              <input
                value={filters.category}
                onChange={(event) => setFilters({ ...filters, category: event.target.value })}
                placeholder="Category"
                aria-label="Filter by category"
              />
            </label>
            <label>
              <span className="sr-only">Sort tasks</span>
              <select value={filters.sort} onChange={(event) => {
                const sort = event.target.value;
                setFilters({ ...filters, sort, order: sort === "due" ? "asc" : "desc" });
              }}>
                <option value="created">Recently added</option>
                <option value="updated">Recently updated</option>
                <option value="due">Due date</option>
                <option value="priority">Priority</option>
              </select>
            </label>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <Warning weight="fill" />
              <span>{error}</span>
              <button onClick={loadData}><ArrowClockwise /> Try again</button>
            </div>
          )}

          {loading ? (
            <TaskSkeleton />
          ) : visibleTodos.length ? (
            <div className="task-list">
              {visibleTodos.map((todo) => (
                <TaskRow
                  key={todo.id}
                  todo={todo}
                  disabled={saving}
                  onToggle={() => mutate(() => api.toggleTodo(todo.id))}
                  onEdit={() => setEditing(todo)}
                  onDelete={() => setConfirmation({ kind: "task", todo })}
                />
              ))}
            </div>
          ) : (
            <EmptyState upcoming={view === "upcoming"} filtered={Boolean(draftSearch || activeFilterCount)} onAdd={() => setComposerOpen(true)} onReset={() => {
              setDraftSearch("");
              setFilters(view === "upcoming"
                ? { ...DEFAULT_FILTERS, sort: "due", order: "asc" }
                : DEFAULT_FILTERS);
            }} />
          )}
        </section>
      </main>

      {(composerOpen || editing) && (
        <TaskDialog
          task={editing || EMPTY_TASK}
          mode={editing ? "edit" : "create"}
          saving={saving}
          onClose={() => { setComposerOpen(false); setEditing(null); }}
          onSave={editing ? updateTask : createTask}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          confirmation={confirmation}
          saving={saving}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmDestructiveAction}
        />
      )}
    </div>
  );
}

function Stat({ label, value, icon, tone = "default" }) {
  return (
    <div className={`stat-panel ${tone}`}>
      <span className="stat-icon">{icon}</span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}

function AuthLoading() {
  return (
    <main className="auth-screen" aria-label="Checking login">
      <div className="auth-card auth-loading">
        <span className="auth-mark" aria-hidden="true"><LockKey weight="fill" /></span>
        <p>Checking your secure session…</p>
      </div>
    </main>
  );
}

function LoginScreen({ error, authenticating, onLogin }) {
  const [password, setPassword] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!password) return;
    const success = await onLogin(password);
    if (!success) setPassword("");
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="login-title">
        <span className="auth-mark" aria-hidden="true"><LockKey weight="fill" /></span>
        <p className="auth-eyebrow">Private workspace</p>
        <h1 id="login-title">Welcome back.</h1>
        <p className="auth-copy">Enter your password to open Docklist.</p>
        <form onSubmit={submit}>
          <label className="field-block">
            <span>Password</span>
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(error)}
            />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={authenticating || !password}>
            {authenticating ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <small>Protected with an encrypted session cookie. Your password is never stored here.</small>
      </section>
    </main>
  );
}

function TaskRow({ todo, disabled, onToggle, onEdit, onDelete }) {
  const isComplete = todo.status === "completed";
  const overdue = !isComplete && todo.dueDate && todo.dueDate < new Date().toISOString().slice(0, 10);
  const dueText = todo.dueDate
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${todo.dueDate}T12:00:00`))
    : null;

  return (
    <article className={`task-row ${isComplete ? "completed" : ""}`}>
      <button className="complete-button" disabled={disabled} aria-label={isComplete ? `Mark ${todo.title} active` : `Complete ${todo.title}`} onClick={onToggle}>
        {isComplete ? <CheckCircle weight="fill" /> : <Circle />}
      </button>
      <div className="task-content">
        <div className="task-title-line">
          <h3>{todo.title}</h3>
          <span className={`priority priority-${todo.priority}`}>{PRIORITY_LABELS[todo.priority]}</span>
        </div>
        {todo.description && <p>{todo.description}</p>}
        <div className="task-meta">
          <span>{STATUS_LABELS[todo.status]}</span>
          {todo.category && <span>{todo.category}</span>}
          {dueText && <span className={overdue ? "overdue" : ""}><CalendarBlank /> {overdue ? "Overdue " : "Due "}{dueText}</span>}
          {todo.tags.map((tag) => <span key={tag}>#{tag}</span>)}
        </div>
      </div>
      <div className="row-actions">
        <button disabled={disabled} onClick={onEdit} aria-label={`Edit ${todo.title}`}><NotePencil /></button>
        <button disabled={disabled} onClick={onDelete} aria-label={`Delete ${todo.title}`} className="delete-action"><Trash /></button>
      </div>
    </article>
  );
}

function EmptyState({ filtered, upcoming, onAdd, onReset }) {
  const heading = filtered ? "No tasks match" : upcoming ? "Nothing due yet" : "Your list is ready";
  const copy = filtered
    ? "Try changing the search or filters."
    : upcoming
      ? "Add a due date to an active task and it will appear here."
      : "Add your first task and give today a clear direction.";

  return (
    <div className="empty-state">
      <span className="empty-icon">{filtered ? <MagnifyingGlass /> : <ListChecks />}</span>
      <h3>{heading}</h3>
      <p>{copy}</p>
      <button className="secondary-button" onClick={filtered ? onReset : onAdd}>{filtered ? "Reset filters" : "Add first task"}</button>
    </div>
  );
}

function TaskSkeleton() {
  return (
    <div className="task-list skeleton-list" aria-label="Loading tasks">
      {[0, 1, 2].map((item) => <div className="skeleton-row" key={item}><i /><div><b /><span /></div></div>)}
    </div>
  );
}

function TaskDialog({ task, mode, saving, onClose, onSave }) {
  const [form, setForm] = useState({ ...task, dueDate: task.dueDate || "", tags: task.tags || [] });
  const [tagText, setTagText] = useState((task.tags || []).join(", "));
  const [fieldError, setFieldError] = useState("");

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      setFieldError("Give the task a short, clear title.");
      return;
    }
    setFieldError("");
    await onSave({
      ...form,
      title: form.title.trim(),
      tags: [...new Set(tagText.split(",").map((tag) => tag.trim()).filter(Boolean))],
      dueDate: form.dueDate || null,
    });
  }

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="task-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-header">
          <div><h2 id="dialog-title">{mode === "edit" ? "Edit task" : "Add a task"}</h2><p>Keep it specific enough to act on.</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X /></button>
        </div>
        <form onSubmit={submit}>
          <label className="field-block">
            <span>Title</span>
            <input autoFocus value={form.title} maxLength="160" onChange={(event) => update("title", event.target.value)} aria-invalid={Boolean(fieldError)} />
            {fieldError && <small className="field-error">{fieldError}</small>}
          </label>
          <label className="field-block">
            <span>Notes</span>
            <textarea rows="4" value={form.description} maxLength="2000" onChange={(event) => update("description", event.target.value)} />
          </label>
          <div className="form-grid">
            <label className="field-block"><span>Status</span><select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label>
            <label className="field-block"><span>Priority</span><select value={form.priority} onChange={(event) => update("priority", event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            <label className="field-block"><span>Due date</span><input type="date" value={form.dueDate} onInput={(event) => update("dueDate", event.currentTarget.value)} onChange={(event) => update("dueDate", event.currentTarget.value)} /></label>
            <label className="field-block"><span>Category</span><input value={form.category} maxLength="80" onChange={(event) => update("category", event.target.value)} placeholder="Work, personal, launch" /></label>
          </div>
          <label className="field-block"><span>Tags</span><input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="docker, render, backend" /><small>Separate tags with commas.</small></label>
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving" : mode === "edit" ? "Save changes" : "Add task"}</button></div>
        </form>
      </section>
    </div>
  );
}

function ConfirmDialog({ confirmation, saving, onCancel, onConfirm }) {
  const isSingleTask = confirmation.kind === "task";
  const title = isSingleTask ? "Delete this task?" : "Clear completed tasks?";
  const description = isSingleTask
    ? `“${confirmation.todo.title}” will be permanently removed.`
    : `${confirmation.count} completed ${confirmation.count === 1 ? "task" : "tasks"} will be permanently removed.`;

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape" && !saving) onCancel();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, saving]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onCancel()}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <span className="confirm-icon" aria-hidden="true"><Trash /></span>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <div className="dialog-actions">
          <button className="secondary-button" disabled={saving} onClick={onCancel}>Keep {isSingleTask ? "task" : "tasks"}</button>
          <button className="danger-button" disabled={saving} onClick={onConfirm}>
            {saving ? "Deleting" : isSingleTask ? "Delete task" : "Clear completed"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
