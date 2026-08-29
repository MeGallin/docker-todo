const crypto = require("node:crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const argon2 = require("argon2");

const SESSION_HOURS = 12;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function createAuthentication(database, options = {}) {
  const passwordHash = options.passwordHash || process.env.APP_PASSWORD_HASH;
  if (!passwordHash || !passwordHash.startsWith("$argon2id$")) {
    throw new Error("APP_PASSWORD_HASH is required and must contain an Argon2id password hash.");
  }

  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === "production";
  const cookieName = secureCookies ? "__Host-docklist_session" : "docklist_session";
  const configuredHours = Number(options.sessionHours || process.env.AUTH_SESSION_HOURS);
  const sessionHours = Number.isFinite(configuredHours) && configuredHours > 0
    ? configuredHours
    : SESSION_HOURS;

  await initializeSessionStorage(database, passwordHash);

  const router = express.Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many login attempts. Wait 15 minutes and try again." },
  });

  router.post("/login", loginLimiter, async (request, response) => {
    if (!isSameOrigin(request)) {
      return response.status(403).json({ error: "Request origin was not accepted" });
    }

    const password = request.body?.password;
    if (typeof password !== "string" || !password || password.length > 512) {
      return response.status(401).json({ error: "Password not recognised" });
    }

    let verified = false;
    try {
      verified = await argon2.verify(passwordHash, password, { type: argon2.argon2id });
    } catch {
      verified = false;
    }
    if (!verified) {
      return response.status(401).json({ error: "Password not recognised" });
    }

    await removeCurrentSession(database, request, cookieName);
    await database.query("DELETE FROM auth_sessions WHERE expires_at <= NOW()");

    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const csrfToken = crypto.randomBytes(32).toString("base64url");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + sessionHours * 60 * 60 * 1000);
    await database.query(`
      INSERT INTO auth_sessions (token_hash, csrf_token, created_at, expires_at)
      VALUES ($1, $2, $3, $4)
    `, [hashToken(sessionToken), csrfToken, createdAt, expiresAt]);

    response.setHeader("Set-Cookie", buildSessionCookie(cookieName, sessionToken, secureCookies));
    response.setHeader("Cache-Control", "no-store");
    return response.json({ authenticated: true, csrfToken });
  });

  router.get("/session", authenticate, (request, response) => {
    response.json({ authenticated: true, csrfToken: request.authSession.csrf_token });
  });

  router.post("/logout", authenticate, requireCsrf, async (request, response) => {
    await database.query("DELETE FROM auth_sessions WHERE token_hash = $1", [request.authTokenHash]);
    response.setHeader("Set-Cookie", clearSessionCookie(cookieName, secureCookies));
    response.setHeader("Clear-Site-Data", '"cache", "cookies"');
    return response.status(204).end();
  });

  async function authenticate(request, response, next) {
    try {
      const sessionToken = readCookie(request, cookieName);
      const tokenHash = sessionToken ? hashToken(sessionToken) : null;
      const result = tokenHash
        ? await database.query(`
            SELECT token_hash, csrf_token, created_at, expires_at
            FROM auth_sessions
            WHERE token_hash = $1 AND expires_at > NOW()
          `, [tokenHash])
        : { rows: [] };
      const session = result.rows[0];

      if (!session) {
        if (sessionToken) {
          await database.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
          response.setHeader("Set-Cookie", clearSessionCookie(cookieName, secureCookies));
        }
        response.setHeader("Cache-Control", "no-store");
        return response.status(401).json({ error: "Authentication required" });
      }

      request.authSession = session;
      request.authTokenHash = tokenHash;
      response.setHeader("Cache-Control", "no-store");
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function requireCsrf(request, response, next) {
    if (SAFE_METHODS.has(request.method)) return next();
    if (!isSameOrigin(request)) {
      return response.status(403).json({ error: "Request origin was not accepted" });
    }

    const suppliedToken = request.get("X-CSRF-Token") || "";
    if (!safeEqual(suppliedToken, request.authSession.csrf_token)) {
      return response.status(403).json({ error: "Security token is invalid or missing" });
    }
    return next();
  }

  return { router, authenticate, requireCsrf };
}

async function initializeSessionStorage(database, passwordHash) {
  const fingerprint = crypto.createHash("sha256").update(passwordHash).digest("hex");
  const result = await database.query(
    "SELECT value FROM app_metadata WHERE key = 'auth_password_fingerprint'"
  );
  const storedFingerprint = result.rows[0];
  if (storedFingerprint && storedFingerprint.value !== fingerprint) {
    await database.query("DELETE FROM auth_sessions");
  }

  await database.query(`
    INSERT INTO app_metadata (key, value) VALUES ('auth_password_fingerprint', $1)
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
  `, [fingerprint]);
}

function isSameOrigin(request) {
  const origin = request.get("Origin");
  if (!origin) return true;
  try {
    const configuredOrigins = process.env.CLIENT_ORIGINS
      ? process.env.CLIENT_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
    const allowedOrigins = new Set([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      ...configuredOrigins,
    ]);
    return new URL(origin).origin === `${request.protocol}://${request.get("host")}`
      || allowedOrigins.has(origin);
  } catch {
    return false;
  }
}

function readCookie(request, name) {
  const cookies = request.get("Cookie");
  if (!cookies) return null;
  for (const part of cookies.split(";")) {
    const [cookieName, ...value] = part.trim().split("=");
    if (cookieName === name) return value.join("=") || null;
  }
  return null;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildSessionCookie(name, value, secure) {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

function clearSessionCookie(name, secure) {
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    secure ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

async function removeCurrentSession(database, request, cookieName) {
  const currentToken = readCookie(request, cookieName);
  if (currentToken) {
    await database.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(currentToken)]);
  }
}

module.exports = { createAuthentication };
