import { readFile, writeFile, chmod } from "node:fs/promises";
const p = new URL("../dist/bin.js", import.meta.url);
let s = await readFile(p, "utf8");
if (!s.startsWith("#!")) s = "#!/usr/bin/env node\n" + s;
await writeFile(p, s);
await chmod(p, 0o755);
