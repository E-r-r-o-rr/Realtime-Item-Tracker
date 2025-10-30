#!/usr/bin/env python3
"""Persistent local VLM HTTP service."""
from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional
from urllib import request as urllib_request

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from ocr_extract import (  # noqa: E402
    DEFAULT_LOCAL_MAX_NEW_TOKENS,
    DEFAULT_MODEL,
    build_local_vlm_call,
    ensure_local_model_available,
    parse_bool,
    process_one,
)

KEEPALIVE_URL = "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen-VL/assets/demo.jpeg"
KEEPALIVE_PATH = SCRIPT_DIR / "_keepalive.jpg"

os.environ.pop("PYTORCH_CUDA_ALLOC_CONF", None)


@dataclass
class ServiceConfig:
    model_id: str
    dtype: str
    device_map: str
    max_new_tokens: int
    attn_impl: Optional[str]
    system_prompt: Optional[str]
    normalize_dates: bool


class ServiceContext:
    def __init__(self, config: ServiceConfig):
        self.config = config
        self.vlm_call = build_local_vlm_call(
            config.model_id,
            config.dtype,
            config.device_map,
            config.max_new_tokens,
            config.attn_impl,
            config.system_prompt,
        )
        self.lock = threading.Lock()
        self.started_at = time.time()

    def warmup(self) -> None:
        try:
            KEEPALIVE_PATH.parent.mkdir(parents=True, exist_ok=True)
            if not KEEPALIVE_PATH.exists():
                with urllib_request.urlopen(KEEPALIVE_URL, timeout=10) as resp:
                    KEEPALIVE_PATH.write_bytes(resp.read())
        except Exception:
            return

        try:
            process_one(
                self.vlm_call,
                str(KEEPALIVE_PATH),
                normalize_dates=False,
                ocr_hint=None,
            )
        except Exception:
            return

    def infer(self, image_path: str, normalize_dates: Optional[bool], ocr_hint: Optional[str]) -> Dict[str, Any]:
        target_normalize = self.config.normalize_dates if normalize_dates is None else bool(normalize_dates)
        with self.lock:
            return process_one(
                self.vlm_call,
                image_path,
                normalize_dates=target_normalize,
                ocr_hint=ocr_hint,
            )


SERVICE_CONTEXT: Optional[ServiceContext] = None
SHUTDOWN_EVENT = threading.Event()


class LocalVlmHandler(BaseHTTPRequestHandler):
    server_version = "LocalVLMService/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # pragma: no cover
        sys.stdout.write("[serve] " + format % args + "\n")

    def _send_json(self, status: HTTPStatus, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/health"):
            ctx = SERVICE_CONTEXT
            if ctx is None:
                self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "message": "Service not initialised"})
                return
            payload = {
                "ok": True,
                "modelId": ctx.config.model_id,
                "dtype": ctx.config.dtype,
                "deviceMap": ctx.config.device_map,
                "maxNewTokens": ctx.config.max_new_tokens,
                "attnImpl": ctx.config.attn_impl or "",
                "systemPrompt": ctx.config.system_prompt or "",
                "normalizeDates": ctx.config.normalize_dates,
                "startedAt": ctx.started_at,
            }
            self._send_json(HTTPStatus.OK, payload)
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Unknown path"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/infer"):
            self._handle_infer()
            return
        if self.path.startswith("/shutdown"):
            self._send_json(HTTPStatus.OK, {"ok": True, "message": "Shutting down"})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            SHUTDOWN_EVENT.set()
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Unknown path"})

    def _handle_infer(self) -> None:
        ctx = SERVICE_CONTEXT
        if ctx is None:
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "message": "Service not initialised"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        raw = self.rfile.read(max(length, 0)) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "Request body must be JSON"})
            return

        image_path = str(payload.get("image_path") or "").strip()
        if not image_path:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "Provide image_path"})
            return

        ocr_hint = payload.get("ocr_hint")
        normalize_dates = payload.get("normalize_dates")

        started = time.time()
        try:
            result = ctx.infer(image_path, normalize_dates, ocr_hint)
        except Exception as exc:  # pragma: no cover
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "message": f"Inference failed: {exc}"},
            )
            return

        duration_ms = int((time.time() - started) * 1000)
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "result": result,
                "durationMs": duration_ms,
            },
        )

def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.environ.get("OCR_LOCAL_SERVICE_HOST", "127.0.0.1"))
    ap.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("OCR_LOCAL_SERVICE_PORT", "5117")),
    )
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--dtype", default=os.environ.get("OCR_LOCAL_DTYPE", "auto"))
    ap.add_argument("--device-map", dest="device_map", default=os.environ.get("OCR_LOCAL_DEVICE_MAP", "auto"))
    ap.add_argument(
        "--max-new-tokens",
        dest="max_new_tokens",
        type=int,
        default=int(os.environ.get("OCR_LOCAL_MAX_NEW_TOKENS", DEFAULT_LOCAL_MAX_NEW_TOKENS)),
    )
    ap.add_argument("--attn-impl", dest="attn_impl", default=os.environ.get("OCR_LOCAL_ATTN_IMPLEMENTATION") or "")
    ap.add_argument("--system-prompt", dest="system_prompt", default=os.environ.get("OCR_SYSTEM_PROMPT", ""))
    ap.add_argument("--no-normalize-dates", dest="no_normalize_dates", action="store_true")
    ap.add_argument("--flash-attn", dest="flash_attn", action="store_true")
    return ap.parse_args()


def resolve_attn_impl(arg_value: str, flash_flag: bool) -> Optional[str]:
    direct = (arg_value or "").strip()
    if direct:
        return direct
    env_hint = os.environ.get("OCR_LOCAL_ATTN_IMPL", "").strip()
    if env_hint:
        return env_hint
    flash_env = os.environ.get("OCR_LOCAL_FLASH_ATTENTION")
    if flash_flag or parse_bool(flash_env, False):
        return "flash_attention_2"
    return None


def build_config(args: argparse.Namespace) -> ServiceConfig:
    model_id = (args.model or "").strip() or DEFAULT_MODEL
    dtype = (args.dtype or "auto").strip() or "auto"
    device_map = (args.device_map or "auto").strip() or "auto"
    max_new_tokens = args.max_new_tokens or DEFAULT_LOCAL_MAX_NEW_TOKENS
    attn_impl = resolve_attn_impl(args.attn_impl, bool(args.flash_attn))
    system_prompt = (args.system_prompt or "").strip() or None
    normalize_dates = not bool(args.no_normalize_dates)
    return ServiceConfig(
        model_id=model_id,
        dtype=dtype,
        device_map=device_map,
        max_new_tokens=max_new_tokens,
        attn_impl=attn_impl,
        system_prompt=system_prompt,
        normalize_dates=normalize_dates,
    )


def install_signal_handlers(server: ThreadingHTTPServer) -> None:
    def _handler(signum: int, _frame: Any) -> None:  # pragma: no cover
        sys.stdout.write(f"[serve] Received signal {signum}, shutting down.\n")
        threading.Thread(target=server.shutdown, daemon=True).start()
        SHUTDOWN_EVENT.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handler)
        except Exception:
            continue


def main() -> int:
    args = parse_args()
    config = build_config(args)

    try:
        ensure_local_model_available(config.model_id)
    except RuntimeError as exc:
        sys.stderr.write(f"[fatal] {exc}\n")
        return 2

    try:
        ctx = ServiceContext(config)
    except RuntimeError as exc:
        sys.stderr.write(f"[fatal] Unable to load model: {exc}\n")
        return 3

    global SERVICE_CONTEXT
    SERVICE_CONTEXT = ctx

    ctx.warmup()

    server = ThreadingHTTPServer((args.host, args.port), LocalVlmHandler)
    server.allow_reuse_address = True
    server.daemon_threads = True
    install_signal_handlers(server)

    sys.stdout.write(
        f"[serve] Local VLM ready on http://{args.host}:{args.port} with model {config.model_id}\n"
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stdout.write("[serve] Keyboard interrupt, shutting down.\n")
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    sys.exit(main())
