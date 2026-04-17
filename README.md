# Pub2InDesign

Pub2InDesign is a local web app that converts a Microsoft Publisher `.pub` file into an InDesign-compatible `IDML`, verifies the result in Adobe InDesign 2026, and applies a structural acceptance gate before a job is treated as complete.

## What Works
- Drag-and-drop or standard upload of `.pub` files
- Server-side conversion jobs with status polling
- Publisher ingest through `libmspub` raw extraction
- Native threaded IDML export through Adobe InDesign scripting
- Downloadable result file plus machine-readable acceptance report
- Post-export validation by reopening the generated IDML in InDesign
- Structural verification for column layout, threaded stories, and duplicated page content
- Legacy visual page-by-page comparison using PDF rasterization and pixelmatch for diagnostics

## Runtime Flow
`Publisher (.pub) -> libmspub raw parse -> internal model -> Adobe InDesign threaded reconstruction -> IDML -> InDesign PDF export -> structural audit`

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
- A job is only considered complete when `structuralMatchPassed`, `nativeAuditPassed`, and `releaseApproved` are all `true`.
- Structural acceptance currently blocks duplicated page content, missing multi-column layouts, and background surrogate tricks.
- The visual diff remains in the report as a diagnostic against the LibreOffice-rendered fallback PDF and is not the release gate.
- Acceptance manifests live under `acceptance/**/manifest.json`.
