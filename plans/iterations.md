# Iterations

## Iteration 0: Program Setup
### Goal
Establish the orchestration system, persistent project rules, and release gating.

### Done
- `AGENTS.md` exists.
- `.codex/agents/` contains product-specific roles.
- `plans/` tracks discovery, backlog, decisions, tests, release, and blockers.
- Git is initialized locally and connected to the target GitHub remote.

### Status
- Complete.

## Iteration 1: Feasibility Spike
### Goal
Prove the first viable `.pub -> internal model -> IDML` path with real fixture data.

### Entry Criteria
- At least one representative `.pub` file is present in the workspace.
- Adobe/InDesign validation path is available or explicitly staged.

### Done
- Parser strategy chosen and documented.
- Minimal internal model documented.
- One test artifact generated.
- Verification evidence captured.

### Status
- In progress.

### Evidence So Far
- `Testfokus.pub` identified as a classic OLE/CFB compound document.
- Inspection script now inventories the container and writes an artifact report.
- The first stream map shows `Contents`, `Quill`, and `Escher` structures as likely core extraction targets.
- `Adobe InDesign 2026` responds to CLI-driven AppleScript checks from the repo environment.
