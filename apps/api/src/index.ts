import { loadConfig, configurationIssues } from "./config";
import { createApp } from "./app";
const config = loadConfig();
const { app, service } = createApp(config);
const maintenance = setInterval(() => void service.maintain(), 1000);
maintenance.unref();
const server = app.listen(config.port, () => {
  console.log(`Studio API listening on http://localhost:${config.port}`);
  for (const issue of configurationIssues(config)) console.log(`Setup: ${issue}`);
});

server.on("error", () => {
  console.error(
    "The studio could not listen on its configured port. Check port availability and local network permissions.",
  );
  process.exitCode = 1;
});
