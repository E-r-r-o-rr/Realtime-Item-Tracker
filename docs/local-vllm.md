# Local vLLM setup

The OCR pipeline can run entirely against a local [vLLM](https://github.com/vllm-project/vllm) server. When the VLM mode is set to **Local** the Next.js backend will automatically spawn `vllm serve <model>` and terminate the process on shutdown, so make sure the following prerequisites are satisfied before enabling it.

## Prerequisites

- **Python 3.10+** with a working `pip` installation.
- The [`vllm` Python package](https://pypi.org/project/vllm/):
  ```bash
  pip install --upgrade "vllm[triton]"
  ```
- CUDA-capable GPU drivers (NVIDIA driver 525+ with CUDA 12.x). CPU-only execution is not officially supported by vLLM and will be extremely slow.
- (Optional) The `huggingface_hub` package if you plan to load gated models or authenticate against the Hugging Face Hub:
  ```bash
  pip install --upgrade huggingface_hub
  ```
- Adequate GPU memory for the model you plan to serve (e.g. ≥8 GB for Qwen/Qwen3-VL-2B-Instruct).

Ensure the `vllm` CLI is on your shell `PATH` (the Next.js worker runs `vllm serve` directly). You may also authenticate with Hugging Face before the first run so the server can download models:

```bash
huggingface-cli login
```

## Runtime behaviour

- When the OCR service needs a local VLM it calls `vllm serve <model>` using the configured model id. Logs from the child process are forwarded to the Next.js server console.
- The runner tracks the child PID and sends `SIGTERM` (followed by a `SIGKILL` fallback after 5 s) during shutdown, preventing orphaned processes.
- The Python OCR script automatically targets the OpenAI-compatible endpoint exposed by vLLM (`/v1/chat/completions`).

## Useful environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `VLLM_BIN` | Path to the `vllm` executable. | `vllm` |
| `VLLM_HOST` | Hostname passed to `vllm serve --host`. | *unset* (vLLM default) |
| `VLLM_PORT` | Port passed to `vllm serve --port`. Also used for the inferred base URL. | `8000` |
| `VLLM_PROTOCOL` | Scheme used when deriving the local base URL. | `http` |
| `VLLM_BASE_URL` | Override the inferred OpenAI-compatible base URL (e.g. `http://127.0.0.1:9000/v1`). | Derived from host/port |
| `VLLM_SERVE_ARGS` | Extra arguments appended to the `vllm serve` command. Quote values with spaces. | *none* |
| `VLLM_STOP_SIGNAL` | Signal used when stopping the child process. | `SIGTERM` |
| `VLLM_STOP_GRACE_MS` | Milliseconds to wait before sending `SIGKILL` during shutdown. | `5000` |

With these dependencies installed you can enable **Local** mode in the settings UI, choose the desired model id, and the backend will handle starting/stopping the vLLM server automatically when scans are processed.
