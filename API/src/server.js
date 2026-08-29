const { createApp } = require("./app");
const { createDatabase, initializeDatabase, closeDatabase } = require("./database");

const port = Number(process.env.PORT) || 10000;

async function start() {
  const database = createDatabase();
  await initializeDatabase(database);
  const app = await createApp(database);
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on port ${port}`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received; shutting down`);
    server.close(async () => {
      await closeDatabase(database);
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  console.error("The API could not start:", error);
  process.exit(1);
});
