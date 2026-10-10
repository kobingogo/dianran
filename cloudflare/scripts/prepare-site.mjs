import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const source = fileURLToPath(new URL("../../web/dist", import.meta.url));
const output = fileURLToPath(new URL("../site", import.meta.url));
await fs.access(path.join(source, "index.html"));
await fs.mkdir(output); // Refuse to replace an earlier local staging directory.
await fs.cp(source, output, { recursive: true, filter: (file) => !["prompt-sources", "api"].includes(path.relative(source, file).split(path.sep)[0]) });
console.log("Prepared existing Vite output locally; no build or upload performed.");
