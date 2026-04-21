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
- A full sample conversion now succeeds and generates `IDML`.
- The generated `IDML` reopens in InDesign successfully.

## Iteration 2: Local Product Shell
### Goal
Expose the working conversion engine through a usable web app with upload, polling, report, and download.

### Done
- Local HTTP server implemented.
- Upload endpoint implemented.
- Job polling endpoint implemented.
- Result download endpoint implemented.
- Static frontend implemented.
- End-to-end API flow verified with `Testfokus.pub`.

### Status
- Complete.

## Iteration 3: Testfokus Native Text Flow Repair
### Goal
Fix the observed `Testfokus.pub` fidelity regressions in native InDesign output: one-character text flow, missing first-page one-column text, missing footer labels, and unsafe font fallback.

### Done
- Quill story text is used to repair malformed `pub2raw` story tails.
- Page 1 preserves leading one-column story placeholders before the two-column continuation.
- Main story pages preserve two-column flow and page 18 continuation geometry.
- Footer text frames are generated natively with `Fokus 2025:9` and page number.
- Font resolution maps Publisher family/style data to installed InDesign variants.
- Acceptance report blocks the specific regressions and only completes the HTTP job when the new gates pass.

### Status
- Complete.

### Evidence
- `pnpm typecheck` passes.
- `pnpm convert:pub Testfokus.pub` passes with `releaseApproved: true`.
- `pnpm acceptance:run` passes `testfokus`.
- Real HTTP upload/poll/result flow completed with `releaseApproved: true`.

## Iteration 4: Testfokus Cover, Footer, Back Matter, and Figure Wrap Repair
### Goal
Fix the next observed fidelity regressions: title/abstract missing from page 1, footer missing URL/page structure, back matter leaking after references, and figures overlaying text.

### Done
- Quill content is segmented into article, cover title, cover abstract, footer, and back matter zones.
- Page 1 exports title and abstract as separate native frames before the article story.
- Footer exports two native lines with focus number, page number, and `www.agrifood.se`.
- Last-page back matter exports in separate native frames instead of the article story.
- Large figure objects get native InDesign text wrap.
- Pipeline prefers `Testfokus.pdf` when available as the reference PDF.
- Report and release gate include cover, footer URL/page, misplaced back matter, and text-wrap checks.

### Status
- Complete.

### Evidence
- `pnpm typecheck` passes.
- `pnpm convert:pub Testfokus.pub` passes with `releaseApproved: true`.
- `pnpm acceptance:run` passes `testfokus`.
- Real HTTP upload/poll/result flow completed with `releaseApproved: true`, `ref=project-root`, `cover=true/true`, `footer=true`, `wrap=true`, and `overset=false`.
