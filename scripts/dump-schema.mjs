#!/usr/bin/env node
// Regenerate schema/config.schema.json from src/lib/schema.ts so editors that
// point at the committed file always reflect the current shape. Runs on every
// `npm run build`.
//
// Uses Node's --experimental-strip-types so we don't need tsx/ts-node.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { configSchema } from "../src/lib/schema.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "schema/config.schema.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(configSchema, null, "\t")}\n`);
console.log(`[schema] wrote ${out.replace(`${root}/`, "")}`);
