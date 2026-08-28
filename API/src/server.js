const { createApp } = require("./app");
const { createDatabase } = require("./database");

const port = Number(process.env.PORT) || 10000;
const database = createDatabase();
const app = createApp(database);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
