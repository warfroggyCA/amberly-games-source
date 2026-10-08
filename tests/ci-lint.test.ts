import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const suite = process.platform === "linux" ? describe : describe.skip;
const supervisor = new URL("../scripts/bounded-process.mjs", import.meta.url)
  .href;
const braces = fileURLToPath(
  new URL("../node_modules/braces/index.js", import.meta.url),
);

type Result = { code: number | null; stdout: string; stderr: string };
function probe(
  script: string,
  options: {
    duration?: number;
    signal?: "SIGINT" | "SIGTERM";
    missing?: boolean;
  } = {},
): Promise<Result> {
  const driver = `import {runBounded} from ${JSON.stringify(supervisor)};
process.exitCode=await runBounded(${options.missing ? JSON.stringify("/no-such-amberly-test-command") : "process.execPath"},["--max-old-space-size=64","-e",${JSON.stringify(script)}],{cwd:process.cwd(),duration:${options.duration ?? 1500},grace:100});`;
  return new Promise((resolve, reject) => {
    // Disable crash dumps even for the deliberately heap-bounded parser fixture.
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        'ulimit -c 0; exec "$@"',
        "ci-lint-test",
        process.execPath,
        "--input-type=module",
        "-e",
        driver,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "",
      signalled = false;
    const safety = setTimeout(() => {
      child.kill("SIGTERM");
      const leader = /GROUP:(\d+)\n/.exec(stdout);
      if (leader) {
        try {
          process.kill(-Number(leader[1]), "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
      reject(new Error("Supervisor fixture exceeded outer safety deadline"));
    }, 4000);
    child.stdout.on("data", (value) => {
      stdout += value;
      if (options.signal && !signalled && /READY:\d+\n/.test(stdout)) {
        signalled = true;
        child.kill(options.signal);
      }
    });
    child.stderr.on("data", (value) => {
      stderr += value;
    });
    child.on("error", (error) => {
      clearTimeout(safety);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(safety);
      resolve({ code, stdout, stderr });
    });
  });
}
async function expectStopped(stdout: string) {
  const match = /READY:(\d+)\n/.exec(stdout);
  expect(match).not.toBeNull();
  let state = "absent";
  try {
    state = (await readFile(`/proc/${match![1]}/stat`, "utf8")).split(
      ") ",
    )[1][0];
  } catch (error) {
    // The process can disappear after procfs opens the entry but before reading it.
    expect(["ENOENT", "ESRCH"]).toContain(
      (error as NodeJS.ErrnoException).code,
    );
  }
  try {
    // Assert the observed state before cleanup; never hide a supervisor leak.
    expect(["absent", "Z"]).toContain(state);
  } finally {
    if (!["absent", "Z"].includes(state)) {
      try {
        process.kill(Number(match![1]), "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  }
}
function family(leader: "normal-exit" | "term-exit" | "resistant") {
  const descendant =
    'process.on("SIGTERM",()=>{});process.send(process.pid);setInterval(()=>{},20);';
  return `console.log("GROUP:"+process.pid);const child=require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:["ignore","ignore","ignore","ipc"]});
${leader === "resistant" ? 'process.on("SIGTERM",()=>{});' : ""}
child.once("message",pid=>{child.disconnect();console.log("READY:"+pid);${leader === "normal-exit" ? "process.exit(0);" : ""}});setInterval(()=>{},20);`;
}

suite("bounded CI lint process lifecycle", () => {
  it.each([0, 7, 124])(
    "preserves diagnostics and normal exit %i",
    async (code) => {
      const result = await probe(
        `process.stdout.write("diagnostic stdout\\n");process.stderr.write("diagnostic stderr\\n");process.exitCode=${code};`,
      );
      expect(result).toEqual({
        code,
        stdout: "diagnostic stdout\n",
        stderr: "diagnostic stderr\n",
      });
    },
  );
  it("reports spawn failure without overwriting exit127", async () => {
    const result = await probe("", { missing: true });
    expect(result.code).toBe(127);
    expect(result.stderr).toContain("spawn failed: ENOENT");
  });
  it("terminates a compute loop with a distinct deadline failure", async () => {
    const result = await probe(
      'console.log("GROUP:"+process.pid);while(true){}',
      { duration: 200 },
    );
    expect(result.code).toBe(124);
    expect(result.stderr).toContain("lint exceeded 200 ms");
  });
  it.each(["normal-exit", "term-exit", "resistant"] as const)(
    "cleans a resistant descendant when leader is %s",
    async (leader) => {
      const result = await probe(family(leader), { duration: 600 });
      await expectStopped(result.stdout);
      expect(result.code).toBe(leader === "normal-exit" ? 1 : 124);
      if (leader === "normal-exit")
        expect(result.stderr).toContain(
          "tool exited with surviving descendants",
        );
      else expect(result.stderr).toContain("lint exceeded 600 ms");
    },
  );
  it.each(["SIGINT", "SIGTERM"] as const)(
    "cleans descendants on supervisor %s",
    async (signal) => {
      const result = await probe(family("resistant"), { signal });
      await expectStopped(result.stdout);
      expect(result.code).toBe(signal === "SIGINT" ? 130 : 143);
      expect(result.stderr).toBe("");
    },
  );
  it("bounds installed braces expansion, distinguishing OOM from deadline", async () => {
    const result = await probe(
      `console.log("GROUP:"+process.pid);const braces=require(${JSON.stringify(braces)});braces.expand("{a,b}".repeat(23));console.log("UNEXPECTED_RETURN");`,
    );
    expect(result.stdout).not.toContain("UNEXPECTED_RETURN");
    if (result.code === 124) {
      expect(result.stderr).toContain("lint exceeded 1500 ms");
    } else {
      expect(result.code).toBe(134);
      expect(result.stderr).toMatch(/heap out of memory/i);
      expect(result.stderr).not.toContain("lint exceeded");
    }
  });
});
