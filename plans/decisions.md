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

