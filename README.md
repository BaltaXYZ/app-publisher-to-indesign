# Pub2InDesign

Pub2InDesign is a local web app that converts a Microsoft Publisher `.pub` file into an InDesign-compatible `IDML`, verifies the result in Adobe InDesign 2026, and runs a visual acceptance comparison before a job is treated as complete.

## What Works
- Drag-and-drop or standard upload of `.pub` files
- Server-side conversion jobs with status polling
- Publisher ingest through LibreOffice-generated PDF plus PDF layout extraction
- IDML export through Adobe InDesign scripting
- Downloadable result file plus machine-readable acceptance report
- Post-export validation by reopening the generated IDML in InDesign
- Visual page-by-page comparison using PDF rasterization and pixelmatch

## Runtime Flow
`Publisher (.pub) -> LibreOffice PDF -> PDF layout extraction -> Adobe InDesign scripted reconstruction -> IDML -> InDesign PDF export -> visual diff`

## Run
Requirements on this machine:
- Node 20+
- `pnpm`
- Python 3 with `pip`
- LibreOffice with `soffice`
- Adobe InDesign 2026

Install:

```bash
pnpm install
.venv/bin/pip install -r requirements.txt
```

Start the app:

```bash
pnpm start
```

Open:

```text
http://localhost:3000
```

## Useful Commands
- `pnpm check:indesign`
- `pnpm inspect:pub Testfokus.pub`
- `pnpm convert:pub Testfokus.pub`
- `pnpm acceptance:run`
- `pnpm create:reference-idml`

## Key Artifacts
- Publisher inspection: `artifacts/inspection/`
- Internal model: `artifacts/model/`
- Acceptance artifacts: `artifacts/acceptance/`
- Per-job outputs: `runtime/jobs/<job-id>/`

## Acceptance
- A job is only considered complete when `visualMatchPassed`, `nativeAuditPassed`, and `releaseApproved` are all `true`.
- The current visual threshold is `0.3`, which filters out renderer-level noise while still flagging visible page differences.
- Acceptance manifests live under `acceptance/**/manifest.json`.
