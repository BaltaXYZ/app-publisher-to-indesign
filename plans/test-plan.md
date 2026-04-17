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

## Current Gaps
- No fixture files yet.
- No Adobe validation path verified yet.
- No implementation exists yet beyond governance files.

