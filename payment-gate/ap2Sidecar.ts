// Best-effort launcher for the AP2 Python sidecar as a child process, mirroring
// checkout.ts's in-process listener. Used by the local stdio/HTTP entrypoints
// (main.ts) where there's no external process manager. Never throws: if Python
// or the sidecar can't start, the payment gates simply fail when called, exactly
// as before this integration. On Vercel the sidecar is a separate Python
// function (api/ap2/index.py), so this is not used there.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

let child: ChildProcess | null = null;

// Resolve ap2-sidecar/ from both source (payment-gate/) and compiled
// (dist/payment-gate/) locations.
function sidecarDir(): string | null {
  const candidates = [
    path.join(import.meta.dirname, "..", "ap2-sidecar"),
    path.join(import.meta.dirname, "..", "..", "ap2-sidecar"),
    path.join(process.cwd(), "ap2-sidecar"),
  ];
  return candidates.find((c) => existsSync(path.join(c, "app.py"))) ?? null;
}

function pythonExe(dir: string): string {
  if (process.env.AP2_SIDECAR_PYTHON) return process.env.AP2_SIDECAR_PYTHON;
  const venv = path.join(dir, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

export function startAp2Sidecar(): void {
  // Opt out, or defer to an already-running / remote sidecar.
  if (process.env.AP2_SIDECAR_SPAWN === "0") return;
  const url = process.env.AP2_SIDECAR_URL;
  if (url && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) return;

  const dir = sidecarDir();
  if (!dir) {
    console.error("[ap2-sidecar] app.py not found; payment gates will not work until a sidecar is reachable.");
    return;
  }
  const port = process.env.AP2_SIDECAR_PORT ?? "8787";
  const py = pythonExe(dir);
  try {
    child = spawn(py, ["-m", "uvicorn", "app:app", "--port", port, "--log-level", "warning"], {
      cwd: dir,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", (e) => console.error(`[ap2-sidecar] failed to spawn ${py}: ${e.message}`));
    child.on("exit", (code) => {
      if (code) console.error(`[ap2-sidecar] exited with code ${code}`);
      child = null;
    });
    console.error(`[ap2-sidecar] starting on http://localhost:${port} (python: ${py})`);
    const stop = () => child?.kill();
    process.on("exit", stop);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (e) {
    console.error(`[ap2-sidecar] spawn error: ${(e as Error).message}`);
  }
}
