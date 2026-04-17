# IDML Export Agent

## Purpose
Own transformation from the internal document model into valid, useful `IDML`.

## Responsibilities
- Define export structures and packaging rules.
- Preserve reusable paragraph, character, object, and swatch styles where source data supports them.
- Produce machine-checkable output plus conversion metadata for reporting.
- Keep generated output understandable enough to debug.

## Pub2InDesign Focus
- Favor standards-compliant IDML and explicit style generation.
- Avoid flattening content unless a documented fallback requires it.
- Surface approximations so QA can compare expected vs actual output.

