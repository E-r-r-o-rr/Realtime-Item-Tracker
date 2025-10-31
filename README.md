# Realtime Item Tracker

A Next.js control centre for warehouse operators to capture paperwork, reconcile it against live bookings, and plot shipments on interactive floor maps in real time.

## Table of contents
- [Overview](#overview)
- [Feature tour](#feature-tour)
- [System architecture](#system-architecture)
- [Dependencies](#dependencies)
- [First-time setup](#first-time-setup)
- [Daily developer workflow](#daily-developer-workflow)
- [Configuration reference](#configuration-reference)
- [Data lifecycle](#data-lifecycle)
- [Document processing pipeline](#document-processing-pipeline)
- [Extending with new vision models](#extending-with-new-vision-models)
- [Testing & operational readiness](#testing--operational-readiness)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Repository layout](#repository-layout)

## Overview
Realtime Item Tracker helps inbound teams triage order sheets the moment freight hits the dock. Operators can upload paperwork or snap a photo directly from the dashboard, let the vision pipeline extract structured fields, reconcile the results with barcode scans, and project the shipment onto a floor map so crews know exactly where to send it next.

The application ships with:
- A deterministic runtime (Node.js 20.18 + Python 3) and bootstrap script that rebuilds the SQLite database and demo assets in seconds.
- Rich client components for scanning, map administration, shipment history, and storage auditing.
- A configurable vision language model (VLM) adapter that works with remote APIs or a local Python bridge.

## Feature tour
- **Live scanner dashboard** – Launch the device camera, capture an order sheet, or upload a PDF/image. The UI normalises OCR output, merges barcode readings, tracks validation status, and saves the payload into the live buffer for downstream systems.
- **Floor map visualisation** – Overlay reconciled shipments onto SVG floor plans, drill into destination metadata, and keep assets aligned with warehouse geography.
- **Bookings & storage views** – Inspect the current live buffer, bookings table, and item storage records to verify that OCR data landed where you expect.
- **History timeline** – Audit past scans, prune entries, or clear the ledger entirely without touching the underlying database file.
- **Map admin tools** – Upload new floor maps, position points of interest, and curate synonyms so the routing layer resolves destinations reliably.
- **Health & settings API** – Check the overall service health, inspect or update VLM settings, and orchestrate the optional local inference server through typed endpoints.

## System architecture
| Layer | Responsibilities | Key modules |
| --- | --- | --- |
| **Client (Next.js App Router)** | React components render the scanner dashboard, navigation, map viewers, history table, and admin panels. Client-side hooks manage camera state, barcode/OCR reconciliation, and optimistic updates. | `src/app`, `src/components/scanner/*`, `src/components/ui/*` |
| **Server routes** | API handlers persist scans, manage SQLite mutations, stream OCR requests to remote/local models, and expose health checks. | `src/app/api/*`, `src/lib/localVlmService.ts`, `src/lib/json.ts` |
| **Data & scripts** | A SQLite database stores maps, points, bookings, live buffer rows, and scan history. The Node bootstrap script seeds canonical fixtures and copies committed floor-map assets. | `data/`, `scripts/bootstrap.js`, `fixtures/maps/*` |

## Dependencies
### Runtime
- **Node.js** – Locked to `>=20.18.0 <21` via `.nvmrc`, `.node-version`, and the `engines` field in `package.json`. Use `nvm`, `asdf`, or Volta to match the version exactly.
- **Python 3** – Required to run OCR/barcode helper scripts and the optional local VLM bridge. Configure the interpreter path via `PYTHON_BIN` or `OCR_PYTHON`.

### JavaScript packages
- **Next.js 15** – App Router, API routes, and build pipeline.
- **React 19** – Client-side rendering and hooks.
- **Tailwind CSS 4** – Utility-first styling.
- **better-sqlite3** – Embedded database driver used in the API layer and bootstrap script.
- **ESLint + TypeScript** – Linting and static types for predictable builds.

### Native/system considerations
- Installing `better-sqlite3` may require build tools (`python3`, `make`, and a C++ toolchain) on your platform.
- Camera capture relies on modern browsers with `MediaDevices.getUserMedia` support. When testing locally over HTTPS, use `npm run dev -- --hostname 0.0.0.0` or a tunnel to grant camera permissions.

## First-time setup
1. **Clone & install dependencies**
   ```bash
   git clone <repo-url>
   cd Realtime-Item-Tracker
   npm ci
   ```
   `npm ci` respects the committed `package-lock.json` so every machine installs identical dependency trees.

2. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   # edit .env.local with your secrets and overrides
   ```
   At minimum set `API_KEY` and, if you use remote inference, populate the VLM endpoint and credentials.

3. **Bootstrap local data**
   ```bash
   npm run bootstrap
   ```
   The script wipes `data/app.db`, recreates schema, seeds demo bookings/live buffer rows, and copies SVG map fixtures into `data/maps/`.

4. **Validate the toolchain**
   ```bash
   npm run build
   npm run lint
   ```
   The lint command currently prompts for migration because `next lint` is deprecated; acknowledge or migrate when convenient.

5. **Start developing**
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000` to access the dashboard. Use `npm run dev -- --hostname 0.0.0.0` if you need to test on mobile hardware.

## Daily developer workflow
| Task | Command |
| --- | --- |
| Rebuild database & fixtures | `npm run bootstrap` |
| Compile for production | `npm run build` |
| Run ESLint | `npm run lint` |
| Launch dev server | `npm run dev` |
| Start Next.js in production mode | `npm run start` |

Commit the regenerated `data/app.db` only if you intentionally want to capture schema changes—otherwise keep it ignored and rely on the bootstrap script.

## Configuration reference
All runtime settings are sourced from environment variables. Consult `.env.example` for defaults. Highlights include:

### Core settings
- `API_KEY` – Shared secret validated by middleware and API routes.
- `NODE_ENV` – Controls Next.js build behaviour.

### Vision & OCR
- `OCR_MODEL` – Default remote model identifier.
- `OCR_TIMEOUT_MS` / `OCR_KEEP` – Request timeout and history retention knobs.
- `OCR_LOCAL_MODEL_ID`, `OCR_LOCAL_SERVICE_HOST`, `OCR_LOCAL_SERVICE_PORT` – Configure the optional local inference bridge.
- `OCR_LOCAL_SERVICE_*` timeouts/paths – Fine-tune how the Node process supervises the Python subprocess.

### Python binaries
- `PYTHON_BIN` – Primary interpreter for helper scripts.
- `OCR_PYTHON` – Overrides `PYTHON_BIN` specifically for OCR tasks.

### Barcode workers
- `BARCODE_TIMEOUT_MS` – Maximum time to await a barcode decode.
- `BARCODE_MATCH_TIMEOUT_MS` – Timeout when comparing OCR and barcode payloads.

Augment the `.env.local` file with any provider-specific headers or proxy settings required by your deployment.

## Data lifecycle
- **Database (`data/app.db`)** – Generated automatically. Tables cover floor maps, map points, live buffer entries, bookings, storage bins, and scan history. Regenerate with `npm run bootstrap` whenever schema or seed data changes.
- **Map assets (`data/maps/`)** – Runtime directory populated with SVGs copied from `fixtures/maps/`. Operators can upload additional maps via the UI.
- **Ephemeral artefacts (`uploads/`, `tmp/`, `output/`)** – Used for OCR processing and excluded from Git. Safe to delete between runs.

## Document processing pipeline
1. **Capture / upload** – The dashboard accepts dropped files or camera captures. Captures are streamed to a `<video>` preview, frozen into a `Blob`, and converted into a `File` before scanning.
2. **OCR invocation** – Client code calls the `runScan` helper, which bundles the document, metadata, and barcode payload into a request to `/api/ocr`. The API chooses between remote and local VLM modes based on settings.
3. **Vision model execution** – Remote providers follow the OpenAI-compatible JSON template defined in `src/config/vlm.ts`. Local mode boots `scripts/ocr_local_service.py` via `src/lib/localVlmService.ts` and proxies requests until complete.
4. **Barcode reconciliation** – OCR output is merged with decoded barcodes. Normalisation helpers defensively coerce provider-specific shapes into a common schema before computing matches/mismatches.
5. **Persistence & display** – Successful scans save into the live buffer and history tables. The UI refreshes floor map overlays, bookings view, and storage inventory with the new record.

## Extending with new vision models
Future model releases typically fall into one of two categories:

1. **Remote API upgrades**
   - Update `DEFAULT_VLM_SETTINGS.remote.modelId` (and related metadata) in `src/config/vlm.ts`.
   - If the provider’s request/response shape differs, adjust `parameterMapping` so `bodyTemplate`, `responseTextPath`, and token accounting still resolve correctly.
   - Expose new knobs via environment variables if the model needs custom headers, rate limits, or capability flags.

2. **Local inference swaps**
   - Set `OCR_LOCAL_MODEL_ID` (and optional dtype/device map) in `.env.local` to point to the new weights.
   - Extend `normalizeConfig` or the Python bridge to pass implementation-specific flags (e.g., flash attention, quantisation levels).
   - Use the `/api/settings/vlm/local/service` endpoints to start, stop, or inspect the subprocess without restarting the Next.js server.

When introducing a model with different modalities (e.g., layout JSON, tool calling), document the expectations here and in `.env.example` so operators know whether they must capture extra context or update QA checklists.

## Testing & operational readiness
1. **Automated checks** – Run `npm run build` and resolve any compile-time or TypeScript errors. Follow up with `npm run lint`; migrate away from the deprecated `next lint` wrapper when time permits.
2. **Manual QA** – Walk through `docs/map-testing.md` after bootstrapping the database. Confirm camera capture, OCR uploads, history logging, and floor-map overlays behave as described.
3. **Health endpoints** – Poll `/api/healthz` to verify the app, database, and OCR backends are reachable. Use `/api/settings/vlm/test` to send a smoke prompt to the configured model.

## Troubleshooting & FAQ
- **`better-sqlite3` fails to install** – Ensure your machine has a C/C++ build toolchain and Python 3 headers. On macOS install Xcode Command Line Tools; on Linux install `build-essential`.
- **Camera permission errors** – Browsers require secure contexts. Serve the app over HTTPS (localhost is usually treated as secure) or use a tunnelling service such as `ngrok` for physical devices.
- **Local VLM service stuck starting** – Increase `OCR_LOCAL_SERVICE_READY_TIMEOUT_MS`, confirm the Python runtime can access GPU drivers (if applicable), and check the captured stdout/stderr via `/api/settings/vlm/local/service`.
- **OCR accuracy drifts** – Verify lighting/contrast in camera captures, tweak the system prompt or temperature in `src/config/vlm.ts`, and review barcode fallbacks to ensure they still cover the desired SKUs.

## Repository layout
```
.
├── fixtures/            # Committed SVG floor-map fixtures copied during bootstrap
├── scripts/
│   └── bootstrap.js     # Rebuilds SQLite schema, seeds demo data, copies fixtures
├── src/
│   ├── app/             # Next.js routes and pages (scanner, history, settings, etc.)
│   ├── components/      # Scanner dashboard, map viewer/admin, UI primitives
│   ├── config/          # Default VLM configuration and capability metadata
│   ├── lib/             # Server-side helpers (local VLM orchestration, JSON parsing)
│   └── types/           # Shared TypeScript types for models and API payloads
├── data/                # Runtime database + map directory generated by bootstrap
├── public/              # Static assets served by Next.js (images, icons)
└── docs/                # Operational guides and QA checklists
```

Keep this README close as the canonical onboarding guide—update it whenever dependencies, workflows, or model expectations evolve so new machines stay in sync with production.
