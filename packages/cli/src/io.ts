import { execFile } from "node:child_process";
import { createInterface } from "node:readline";

/** Everything the CLI touches in the outside world, so tests can replace it. */
export interface Io {
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** stdout */
  out(text: string): void;
  /** stderr (prompts and progress go here, so --json output stays clean) */
  err(text: string): void;
  /** true when a person can answer a prompt */
  interactive: boolean;
  /** Reads a secret without echo (TTY) or one line from stdin (pipe). */
  readSecret(prompt: string): Promise<string>;
  /** Reads one visible line. */
  readLine(prompt: string): Promise<string>;
  /** Reads all of stdin. */
  readStdin(): Promise<string>;
  /** Runs an external program (used only by `setup claude`). */
  exec(file: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  fetch?: typeof fetch;
  platform: NodeJS.Platform;
  homedir: string;
}

export function processIo(): Io {
  const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY);
  return {
    env: process.env,
    cwd: process.cwd(),
    out: (t) => void process.stdout.write(t),
    err: (t) => void process.stderr.write(t),
    interactive,
    readLine(prompt) {
      return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: interactive });
        rl.question(prompt, (a) => {
          rl.close();
          resolve(a);
        });
        rl.once("close", () => resolve(""));
      });
    },
    readSecret(prompt) {
      if (!process.stdin.isTTY) return this.readLine("");
      return new Promise((resolve, reject) => {
        process.stderr.write(prompt);
        const stdin = process.stdin;
        let buf = "";
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding("utf8");
        const done = (fn: () => void) => {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stderr.write("\n");
          fn();
        };
        const onData = (chunk: string) => {
          for (const ch of chunk) {
            if (ch === "\r" || ch === "\n") return done(() => resolve(buf));
            if (ch === "\u0003") return done(() => reject(new Error("Interrotto")));
            if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
            else buf += ch;
          }
        };
        stdin.on("data", onData);
      });
    },
    readStdin() {
      return new Promise((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (c) => (data += c));
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", reject);
      });
    },
    exec(file, args) {
      return new Promise((resolve) => {
        execFile(file, args, { encoding: "utf8" }, (error, stdout, stderr) => {
          const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 127) : 0;
          resolve({ code, stdout, stderr });
        });
      });
    },
    platform: process.platform,
    homedir: process.env.HOME ?? "",
  };
}
