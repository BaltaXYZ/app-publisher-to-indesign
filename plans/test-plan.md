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

## Current Verified Evidence
- `Testfokus.pub` is available as the first representative fixture.
- CLI validation confirms `Adobe InDesign 2026` is reachable and reports version `21.3.0.60`.
- OLE inspection of `Testfokus.pub` succeeds and produces a machine-readable artifact under `artifacts/inspection/`.
- The sample file converts to `IDML` through the local CLI pipeline.
- The generated `IDML` has been reopened successfully in Adobe InDesign 2026.
- The HTTP API flow has been exercised end-to-end with upload, polling, report, and result download.

## Current Gaps
- Public cloud deployment for the conversion runtime is unresolved.
- Polygon fidelity and semantic table import are still partial.
