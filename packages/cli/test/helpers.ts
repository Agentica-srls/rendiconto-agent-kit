import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Io } from "../src/io.js";

export interface TestIo extends Io {
  stdout: string;
  stderr: string;
  answers: string[];
  stdin: string;
  execCalls: { file: string; args: string[] }[];
  execCode: number;
}

export async function makeIo(over: Partial<Io> & { env?: NodeJS.ProcessEnv } = {}): Promise<TestIo> {
  const dir = await mkdtemp(join(tmpdir(), "rcli-"));
  const io: TestIo = {
    env: { RENDICONTO_CONFIG_DIR: join(dir, "cfg"), ...(over.env ?? {}) },
    cwd: dir,
    homedir: dir,
    platform: "darwin",
    interactive: false,
    stdout: "",
    stderr: "",
    answers: [],
    stdin: "",
    execCalls: [],
    execCode: 0,
    out(t) {
      io.stdout += t;
    },
    err(t) {
      io.stderr += t;
    },
    async readLine() {
      return io.answers.shift() ?? "";
    },
    async readSecret() {
      return io.answers.shift() ?? "";
    },
    async readStdin() {
      return io.stdin;
    },
    async exec(file, args) {
      io.execCalls.push({ file, args });
      return { code: io.execCode, stdout: "", stderr: "" };
    },
  };
  const { env: _env, ...rest } = over;
  return Object.assign(io, rest);
}
