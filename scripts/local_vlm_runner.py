#!/usr/bin/env python3
"""Utility runner for keeping a local VLM warm."""
from __future__ import annotations

import argparse
import base64
import json
import signal
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict

try:
    import torch
    from transformers import AutoConfig, AutoProcessor
except Exception as exc:  # pragma: no cover - import guard
    print(
        json.dumps(
            {
                "event": "fatal",
                "error": f"Failed to import torch/transformers: {exc}",
            }
        ),
        file=sys.stderr,
    )
    raise

# Optional dependency: huggingface_hub provides a quick existence check.
try:  # pragma: no cover - optional import
    from huggingface_hub import snapshot_download
except Exception:  # pragma: no cover - optional import
    snapshot_download = None


KEEPALIVE_IMAGE_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP8z8Dwn4EIwDiqAAG9AwfKdTxE4wAAAABJRU5ErkJggg=="
)


def log_event(event: str, **payload: Any) -> None:
    message: Dict[str, Any] = {"event": event, **payload}
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def ensure_keepalive_image(tmp_dir: Path) -> Path:
    tmp_dir.mkdir(parents=True, exist_ok=True)
    keepalive = tmp_dir / "keepalive.png"
    if not keepalive.exists():
        keepalive.write_bytes(base64.b64decode(KEEPALIVE_IMAGE_B64))
    return keepalive


def verify_local_install(model_id: str) -> None:
    if snapshot_download is not None:
        snapshot_download(model_id, local_files_only=True)
    else:  # Fallback: ensure config + processor exist locally.
        AutoConfig.from_pretrained(model_id, local_files_only=True)
        AutoProcessor.from_pretrained(model_id, local_files_only=True)


def load_model(model_id: str, device: str | None, dtype: str | None):
    from transformers import Qwen3VLForConditionalGeneration

    # We explicitly operate on pre-downloaded weights. Avoid attempting to fetch
    # files from the network again so that startup is deterministic when the
    # cache is incomplete.
    load_kwargs: Dict[str, Any] = {"local_files_only": True}
    if dtype == "float16":
        load_kwargs["torch_dtype"] = torch.float16
    elif dtype == "bfloat16":
        load_kwargs["torch_dtype"] = torch.bfloat16

    if device:
        if device == "cpu":
            load_kwargs["device_map"] = {"": "cpu"}
        elif device == "cuda":
            load_kwargs["device_map"] = "auto"
        else:
            load_kwargs["device_map"] = {"": device}
    else:
        load_kwargs["device_map"] = "auto"

    model = Qwen3VLForConditionalGeneration.from_pretrained(model_id, **load_kwargs)
    processor = AutoProcessor.from_pretrained(model_id)
    return model, processor


def warmup(model, processor, keepalive_path: Path) -> None:
    prompt = "Warm up the vision-language model."
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": str(keepalive_path)},
                {"type": "text", "text": prompt},
            ],
        }
    ]
    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    )
    inputs = {k: v.to(model.device, non_blocking=True) for k, v in inputs.items()}
    with torch.inference_mode():
        _ = model.generate(
            **inputs,
            max_new_tokens=4,
            do_sample=False,
            use_cache=True,
        )


def stay_alive(stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        time.sleep(0.5)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local VLM runner")
    parser.add_argument("--model", required=True, help="Model identifier")
    parser.add_argument("--check-only", action="store_true", help="Only verify local installation")
    parser.add_argument("--device", default=None, help="Preferred device mapping (cpu/cuda/GPU id)")
    parser.add_argument("--dtype", default=None, choices=["float16", "bfloat16"], help="Preferred dtype")
    args = parser.parse_args()

    model_id = args.model.strip()
    if not model_id:
        raise SystemExit("Model id is required")

    try:
        verify_local_install(model_id)
    except Exception as exc:
        log_event(
            "missing",
            error=f"Model '{model_id}' is not available locally: {exc}",
        )
        raise SystemExit(2)

    if args.check_only:
        log_event("checked", message=f"Model '{model_id}' is available locally.")
        return

    log_event("loading", message=f"Loading {model_id}…")
    tmp_dir = Path(tempfile.gettempdir()) / "realtime_item_tracker"

    try:
        model, processor = load_model(model_id, args.device, args.dtype)
        keepalive_path = ensure_keepalive_image(tmp_dir)
        warmup(model, processor, keepalive_path)
    except Exception as exc:
        log_event("fatal", error=f"Failed to load {model_id}: {exc}")
        raise SystemExit(3)

    log_event("ready", message=f"Local model '{model_id}' is ready.")

    stop_event = threading.Event()

    def shutdown_handler(signum, _frame):
        log_event("shutdown", signal=signum)
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, shutdown_handler)

    try:
        stay_alive(stop_event)
    finally:
        log_event("stopped", message="Local runner exiting.")


if __name__ == "__main__":
    main()
