# Local transformers setup

The OCR pipeline can run fully offline using [Hugging Face Transformers](https://huggingface.co/docs/transformers/index) instead
of vLLM. When **Local** mode is selected the Next.js backend launches a persistent stdio worker that keeps the configured
model resident in memory and streams OCR jobs to it, so the heavy model load happens only once.

## Prerequisites

- **Python 3.10+** with a working `pip` installation.
- The following Python packages (install them inside your virtual environment or global Python):
  ```bash
  pip install --upgrade "transformers[torch]" pillow accelerate
  ```
  If you already have PyTorch installed separately you can instead run:
  ```bash
  pip install --upgrade transformers pillow accelerate
  ```
- A supported PyTorch build for your platform. CPU execution works on Windows, macOS, and Linux. For GPU acceleration install
  the CUDA-enabled PyTorch wheel that matches your driver/toolkit.
- (Optional) `huggingface_hub` if you need to authenticate to download gated models:
  ```bash
  pip install --upgrade huggingface_hub
  ```

Log in with the Hugging Face CLI before the first run if the model requires authentication:

```bash
huggingface-cli login
```

## Runtime behaviour

- The `/api/vlm/local/start` endpoint launches `python scripts/ocr_extract.py --stdio_server`, which loads the selected model
  and waits for JSON requests over stdin/stdout. The child process stays alive until you press **Stop** or shut down Next.js.
- Each OCR scan pushes a request payload to the running worker; the worker performs Transformers inference and returns the parsed
  payload without reloading weights.
- Model/device options can be tuned using environment variables:
  | Variable | Description | Default |
  | --- | --- | --- |
  | `LOCAL_VLM_MODEL` | Model id to warm up / execute. | Settings UI selection |
  | `LOCAL_VLM_DTYPE` | Torch dtype (e.g. `float16`, `bfloat16`, `float32`). | `auto` |
  | `LOCAL_VLM_DEVICE_MAP` | Passed to `from_pretrained(device_map=...)` (e.g. `cpu`, `cuda`, `auto`). | `auto` |
  | `LOCAL_VLM_ATTN_IMPL` | Attention implementation hint (e.g. `flash_attention_2`). | unset |
  | `LOCAL_VLM_MAX_NEW_TOKENS` | Caps the generated tokens during OCR inference. | Derived from settings |

Because Transformers supports Windows and macOS directly, no WSL or Linux VM is required.

## Troubleshooting

- **`ModuleNotFoundError: No module named 'torch'`** – Install PyTorch: `pip install --upgrade torch` (choose the wheel that
  matches your OS/GPU from [pytorch.org](https://pytorch.org/get-started/locally/)).
- **`ImportError: cannot import name 'AutoProcessor'`** – Ensure `transformers>=4.40` is installed.
- **Slow first request** – The first warm-up must download the model weights. Subsequent runs will reuse the local cache. You can
  trigger warm-up manually with `curl -X POST http://localhost:3000/api/vlm/local/start` after launching the Next.js server.

