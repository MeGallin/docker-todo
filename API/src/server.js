const express = require("express");

const app = express();
const port = Number(process.env.PORT) || 10000;

app.disable("x-powered-by");
app.use(express.json());

app.get("/", (_request, response) => {
  response.json({
    message: "Docker Text API is running",
    environment: process.env.NODE_ENV || "development",
  });
});

app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
