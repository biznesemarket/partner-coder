import { writeFileSync } from "node:fs";

import { buildOpenApiDocument } from "./index.js";

const serverUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const document = buildOpenApiDocument({ serverUrl, version: "0.0.1" });
const target = new URL("../../openapi.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`OpenAPI записан в ${target.pathname}\n`);
