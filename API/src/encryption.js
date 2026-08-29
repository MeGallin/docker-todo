const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const ENCRYPTED_PREFIX = "enc:v1:";
const KEY_CHECK_VALUE = "docker-todo-encryption-key:v1";

function createFieldEncryption(encodedKey = process.env.TODO_ENCRYPTION_KEY) {
  if (!encodedKey) {
    throw new Error(
      "TODO_ENCRYPTION_KEY is required. Set it to a base64-encoded 32-byte key."
    );
  }

  const normalizedKey = encodedKey.trim();
  const key = Buffer.from(normalizedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== normalizedKey) {
    throw new Error("TODO_ENCRYPTION_KEY must be a valid base64-encoded 32-byte key.");
  }

  function isEncrypted(value) {
    return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
  }

  function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(String(value), "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      ENCRYPTED_PREFIX.slice(0, -1),
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join(":");
  }

  function decrypt(value) {
    if (!isEncrypted(value)) return value;

    const parts = value.split(":");
    if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
      throw new Error("Encrypted database value has an unsupported format.");
    }

    try {
      const iv = Buffer.from(parts[2], "base64url");
      const ciphertext = Buffer.from(parts[3], "base64url");
      const tag = Buffer.from(parts[4], "base64url");
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      throw new Error(
        "Unable to decrypt the database. TODO_ENCRYPTION_KEY may be incorrect or the data may be damaged.",
        { cause: error }
      );
    }
  }

  function encryptIfNeeded(value) {
    return isEncrypted(value) ? value : encrypt(value);
  }

  return { decrypt, encrypt, encryptIfNeeded, isEncrypted, keyCheckValue: KEY_CHECK_VALUE };
}

module.exports = { createFieldEncryption, ENCRYPTED_PREFIX };
