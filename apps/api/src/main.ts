import { buildServer } from "./server.js";

const port = Number.parseInt(process.env.API_PORT ?? "4000", 10);

const server = buildServer({ logger: true });

server
  .listen({ port, host: "0.0.0.0" })
  .then((address) => {
    server.log.info({ address }, "partner-coder API запущен");
  })
  .catch((error: unknown) => {
    server.log.error({ err: error }, "не удалось запустить API");
    process.exitCode = 1;
  });
