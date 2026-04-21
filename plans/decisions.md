# Decisions

## DEC-001 Hosting Split
- Status: accepted
- Decision: Use GitHub for source control and public project presence, with a Vercel-hosted backend for server-side conversion.
- Why: GitHub Pages is suitable for static frontend hosting but not for the required server-side conversion pipeline.

## DEC-002 v1 Output Format
- Status: accepted
- Decision: Target `IDML` first, not native `.indd`.
- Why: `IDML` is scriptable, InDesign-compatible, and appropriate for a server-generated pipeline.

## DEC-003 v1 Product Scope
- Status: accepted
- Decision: No auth, billing, sync, or persistent user database in v1 unless feasibility work proves they are required.
- Why: They do not support the core conversion promise and would dilute early validation effort.

## DEC-004 Release Gating
- Status: accepted
- Decision: Real `.pub` fixtures and Adobe/InDesign validation remain mandatory before claiming full release readiness.
- Why: The product promise depends on real-world fidelity and actual InDesign compatibility.

## DEC-005 First Feasibility Parser Step
- Status: accepted
- Decision: Start the spike by inspecting the Publisher file as an OLE Compound File Binary container and inventorying its streams before choosing a deeper extraction layer.
- Why: `Testfokus.pub` is a classic CFB/OLE file, so stream-level inspection is the safest first proof step and reduces blind parser work.

## DEC-006 Conversion Runtime Strategy
- Status: accepted
- Decision: Use LibreOffice Draw as the first structural bridge from `.pub` to `.odg`, then reconstruct and export the result through Adobe InDesign to `IDML`.
- Why: This environment can reliably execute that chain end-to-end today, while a raw Publisher parser plus pure IDML writer would add major implementation risk before producing user value.

## DEC-007 Deployment Reality
- Status: accepted
- Decision: Treat the current release as a verified local runtime release, while marking Vercel-based public deployment as unresolved.
- Why: Vercel Functions are not a realistic primary runtime for a LibreOffice + Adobe/InDesign conversion engine.

## DEC-008 Canonical Publisher Text Source
- Status: accepted
- Decision: Use `Root Entry/Quill/QuillSub/CONTENTS` as the canonical story text source when `pub2raw` degenerates into one-character paragraphs, while keeping `pub2raw` for page geometry, columns, images, and style hints.
- Why: `Testfokus.pub` exposes a real libmspub failure where the visible story tail becomes hundreds of one-character paragraphs. Quill preserves the readable text needed for native InDesign reconstruction.

## DEC-009 Text Flow Regression Gate
- Status: accepted
- Decision: The release gate now blocks malformed one-character story flows, missing first-page one-column intro flow, missing two-column main flow, missing footer labels, overset text, font substitution issues, and missing canonical text coverage.
- Why: These were the concrete regressions observed in the generated `IDML`; they must be machine-checked so the UI cannot report success for a structurally wrong document.
