# Test Plan

## Evidence Strategy
- Unit-level tests for parser helpers, document model transforms, style normalization, and IDML packaging.
- Fixture-based tests using real `.pub` inputs when available.
- API integration tests for job lifecycle and result download.
- End-to-end UI tests for upload, status, success, and failure flows.

## Mandatory Release Evidence
- At least one representative `.pub` fixture processed end-to-end.
- Generated `IDML` artifact archived as evidence.
- Quality report reviewed for exact, approximate, and unsupported mappings.
- Adobe/InDesign open validation completed in the agreed target environment.
- `Testfokus.pub` must not contain one-character paragraph sequences after `Konsekvenser...`.
- `Testfokus.pub` must include the first-page one-column intro flow, two-column main flow, native footer labels, no overset text, and no font issues.
- `Testfokus.pub` must include the cover title, cover abstract, two-line footer with page number and URL, separated back matter, and text-wrapped large figures.

## Current Verified Evidence
- `Testfokus.pub` is available as the first representative fixture.
- CLI validation confirms `Adobe InDesign 2026` is reachable and reports version `21.3.0.60`.
- OLE inspection of `Testfokus.pub` succeeds and produces a machine-readable artifact under `artifacts/inspection/`.
- The sample file converts to `IDML` through the local CLI pipeline.
- The generated `IDML` has been reopened successfully in Adobe InDesign 2026.
- The HTTP API flow has been exercised end-to-end with upload, polling, report, and result download.
- `pnpm convert:pub Testfokus.pub` passes with `releaseApproved: true`, `malformedSingleCharacterParagraphsDetected: false`, `footerTextPresent: true`, `oversetText: false`, and no font issues.
- `pnpm convert:pub Testfokus.pub` uses the same-basename `Testfokus.pdf` reference and passes cover, footer URL/page, misplaced back matter, and text-wrap gates.
- `pnpm convert:pub Testfokus.pub` detects generic reference blocks with `detectedTables: 4`, native `totalTables: 4`, `tableBlockMatches: true`, `captionBlockMatches: true`, `sourceNotePresencePassed: true`, and `noObjectTextOverlapPassed: true`.
- `pnpm acceptance:run` passes `testfokus`.
- A real local HTTP job for `Testfokus.pub` completes with `releaseApproved: true`, `visualMatchPassed: true`, `structuralMatchPassed: true`, `nativeAuditPassed: true`, `referenceProfileUsed: true`, and a downloadable `IDML`.

## Current Gaps
- Public cloud deployment for the conversion runtime is unresolved.
- Polygon fidelity is still partial.
