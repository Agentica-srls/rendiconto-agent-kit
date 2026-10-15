import { run } from "./cli.js";
import { processIo } from "./io.js";

run(process.argv.slice(2), processIo()).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`Errore inatteso: ${(e as Error).message}\n`);
    process.exitCode = 6;
  }
);
