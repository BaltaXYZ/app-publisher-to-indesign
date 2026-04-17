# AGENTS.md

## Mission
Build `Pub2InDesign` as a serious Publisher-to-InDesign migration product, not a demo. The core promise is high layout fidelity plus rededitable output in `IDML`, with honest reporting of limitations.

## Operating Model
- The orchestrator owns end-to-end outcomes: discovery, architecture, implementation order, testing, UX review, deploy, and release readiness.
- Specialist agents work in clear scopes and hand off artifacts, findings, and risks back to the orchestrator.
- No product feature work starts before the control system, backlog, release criteria, and blockers are documented.
- No milestone is called done because code exists; it must be verified against release criteria.

## Product Truths
- The app is a web product.
- Frontend may be static and publicly served from GitHub Pages.
- Conversion must run server-side on Vercel or another approved backend runtime if Vercel serverless limits block feasibility.
- v1 output target is `IDML`.
- v1 assumes no auth, no payments, no cross-device sync, and no persistent user history unless feasibility forces a change.
- Uploaded files are confidential and must be short-lived, isolated, and cleaned up automatically.

## Architecture Guardrails
- Preserve a modular pipeline: `pub ingest -> parse -> internal document model -> style normalization -> IDML export -> quality report`.
- Prefer rededitable structure over image-based shortcuts.
- Never represent conversion fidelity as exact unless it has been verified.
- Keep parser, mapper, exporter, and verification layers independently testable.

## Release Guardrails
- A release is not complete until the public or target environment runs the core flow end-to-end.
- If the agreed architecture requires Adobe/InDesign verification, release stays blocked until that verification path is available and exercised.
- External blockers must be documented in `plans/blockers.md` with explicit impact and owner.

## Working Rules
- Update `plans/decisions.md` for meaningful architectural decisions.
- Update `plans/backlog.md` and `plans/iterations.md` before and after each coherent work slice.
- Update `plans/release-checklist.md` as evidence appears.
- Commit only cohesive, verified changes.

