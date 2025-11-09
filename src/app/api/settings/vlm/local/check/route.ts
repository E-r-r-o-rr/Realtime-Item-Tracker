import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/json";

export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store",
};

type LocalCheckDependencies = {
  spawn: typeof spawn;
  existsSync: typeof fs.existsSync;
};

const defaultDeps: LocalCheckDependencies = {
  spawn,
  existsSync: fs.existsSync.bind(fs),
};

let deps: LocalCheckDependencies = { ...defaultDeps };

export function __setLocalCheckRouteTestOverrides(overrides?: Partial<LocalCheckDependencies>) {
  deps = { ...defaultDeps, ...overrides };
}

const PY_BIN =
  process.env.OCR_PYTHON ||
  process.env.PYTHON_BIN ||
  (process.platform === "win32" ? "python" : "python3");

const OCR_SCRIPT = path.join(process.cwd(), "scripts", "ocr_extract.py");

const CHECK_TIMEOUT_MS = Number(process.env.OCR_LOCAL_CHECK_TIMEOUT_MS || 60_000);

type LocalCheckBody = {
  modelId?: string;
};

const collectMessage = (stdout: string, stderr: string, preferStderr: boolean): string => {
  const target = preferStderr ? stderr : stdout;
  const fallback = preferStderr ? stdout : stderr;
  const primary = target.trim();
  if (primary) return primary;
  const secondary = fallback.trim();
  if (secondary) return secondary;
  return preferStderr ? "Model availability check failed." : "Model cache verified.";
};

export async function POST(request: Request) {
  const body = await readJsonBody<LocalCheckBody>(request, {}, "vlm-local-check");
  const modelId = (body.modelId || "").trim();

  if (!modelId) {
    return NextResponse.json(
      { ok: false, message: "Enter a model repository to verify." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (!deps.existsSync(OCR_SCRIPT)) {
    return NextResponse.json(
      { ok: false, message: "OCR script is missing on the server." },
      { status: 500, headers: noStoreHeaders },
    );
  }

  try {
    const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      const env = { ...process.env, VLM_MODE: "local", OCR_LOCAL_MODEL_ID: modelId };
      const args = [OCR_SCRIPT, "--model", modelId, "--mode", "local", "--check_model"];
      const child = deps.spawn(PY_BIN, args, { env, stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let timer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
      }, CHECK_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        cleanup();
        reject(error);
      });
      child.on("close", (code) => {
        cleanup();
        resolve({ stdout, stderr, code: code ?? 0 });
      });
    });

    if (code === 0) {
      const message = collectMessage(stdout, stderr, false);
      return NextResponse.json({ ok: true, message }, { headers: noStoreHeaders });
    }

    const message = collectMessage(stdout, stderr, true);
    return NextResponse.json({ ok: false, message }, { status: 400, headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check local model cache.";
    return NextResponse.json({ ok: false, message }, { status: 500, headers: noStoreHeaders });
  }
}
