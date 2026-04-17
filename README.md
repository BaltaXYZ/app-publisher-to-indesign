# Pub2InDesign

Pub2InDesign is a working local web app that converts a Microsoft Publisher `.pub` file into an InDesign-compatible `IDML` file and verifies that the generated result opens in Adobe InDesign 2026.

## What Works
- Drag-and-drop or standard upload of `.pub` files
- Server-side conversion jobs with status polling
- Publisher ingest through LibreOffice Draw
- ODG parsing into an internal document model
- IDML export through Adobe InDesign scripting
- Downloadable result file plus machine-readable quality report
- Post-export validation by reopening the generated IDML in InDesign

## Runtime Flow
`Publisher (.pub) -> LibreOffice Draw (.odg) -> internal model -> Adobe InDesign scripted reconstruction -> IDML`

## Run
Requirements on this machine:
- Node 20+
- `pnpm`
- LibreOffice with `soffice`
- Adobe InDesign 2026

Install:

```bash
pnpm install
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
- `pnpm parse:odg artifacts/libreoffice/Testfokus.odg`
- `pnpm convert:pub Testfokus.pub`
- `pnpm create:reference-idml`

## Key Artifacts
- Publisher inspection: `artifacts/inspection/`
- LibreOffice bridge output: `artifacts/libreoffice/`
- Internal model: `artifacts/model/`
- Reference IDML study artifacts: `artifacts/reference-idml/`
- Per-job outputs: `runtime/jobs/<job-id>/`

## Known Limits
- Graphic shapes are simplified where necessary.
- Bitmap fills are placed as fitted images rather than rebuilt as native InDesign fill effects.
- Semantic tables are not yet rebuilt as native InDesign tables.
- This release is verified locally. Public cloud deployment remains blocked by conversion-runtime constraints.

