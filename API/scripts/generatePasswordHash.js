const argon2 = require("argon2");

async function readHidden(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();

    function finish(error) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("Cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    }

    process.stdin.on("data", onData);
  });
}

async function main() {
  const password = await readHidden("Choose a password (16+ characters): ");
  if (password.length < 16) throw new Error("Use a password or passphrase of at least 16 characters.");
  const confirmation = await readHidden("Enter it again: ");
  if (password !== confirmation) throw new Error("The passwords did not match.");

  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  console.log("\nCopy this complete value into Render as APP_PASSWORD_HASH:\n");
  console.log(hash);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
