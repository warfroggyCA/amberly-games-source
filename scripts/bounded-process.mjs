import { spawn } from "node:child_process";
import { constants } from "node:os";

/** Linux development-tool supervisor, not a sandbox for hostile executable code. */
export function runBounded(command, args, { cwd, duration, grace = 5000 }) {
  if (
    process.platform !== "linux" ||
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    !Number.isSafeInteger(grace) ||
    grace < 1
  )
    throw new Error("Bounded CI tools require Linux and positive deadlines.");
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    });
    let cause = null;
    let closed = false;
    let result = 1;
    let cleanup = null;
    let finished = false;
    const group = (signal) => {
      if (!child.pid) return false;
      try {
        process.kill(-child.pid, signal);
        return true;
      } catch (error) {
        if (error.code === "ESRCH") return false;
        console.error(`[ci-lint] process-group cleanup failed: ${error.code}`);
        result = 1;
        return false;
      }
    };
    const finish = () => {
      if (finished || !closed || cleanup) return;
      finished = true;
      clearTimeout(timer);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      resolve(
        cause === "timeout"
          ? 124
          : cause === "SIGINT"
            ? 130
            : cause === "SIGTERM"
              ? 143
              : result,
      );
    };
    const cleanGroup = () => {
      if (cleanup || !group("SIGTERM")) return;
      // Keep the escalation alive even if TERM exits the group leader first.
      cleanup = setTimeout(() => {
        group("SIGKILL");
        cleanup = null;
        finish();
      }, grace);
    };
    const stop = (reason) => {
      if (cause || finished) return;
      cause = reason;
      clearTimeout(timer);
      if (reason === "timeout")
        console.error(`[ci-lint] lint exceeded ${duration} ms`);
      cleanGroup();
      finish();
    };
    const interrupt = () => stop("SIGINT");
    const terminate = () => stop("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const timer = setTimeout(() => stop("timeout"), duration);
    child.on("error", (error) => {
      console.error(`[ci-lint] spawn failed: ${error.code ?? error.name}`);
      result = 127;
    });
    child.on("close", (code, signal) => {
      closed = true;
      if (child.pid && code !== null) result = code;
      else if (signal) result = 128 + (constants.signals[signal] ?? 1);
      if (!cause && !cleanup && group(0)) {
        console.error("[ci-lint] tool exited with surviving descendants");
        if (result === 0) result = 1;
      }
      // Also stop ordinary descendants left behind by an exited leader.
      cleanGroup();
      finish();
    });
  });
}
