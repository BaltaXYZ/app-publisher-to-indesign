# Backlog

## Active Epics

### EPIC-01 Control System
- [x] Create permanent project governance files.
- [x] Define specialist roles.
- [x] Record blockers, release criteria, and discovery state.

### EPIC-02 Feasibility Spike
- [x] Ingest first representative `.pub` fixture.
- [x] Evaluate extraction options and choose parser strategy.
- [ ] Define internal document model.
- [ ] Generate a minimal IDML artifact from extracted structure.
- [ ] Verify result opens in InDesign.

### EPIC-03 Product Skeleton
- [ ] Scaffold frontend for upload, status, result, and report flow.
- [ ] Scaffold backend job endpoints.
- [ ] Implement secure temporary file handling.

### EPIC-04 Conversion Quality
- [ ] Text and typography mapping.
- [ ] Geometry and page mapping.
- [ ] Style normalization and deduplication.
- [ ] Swatches and color handling.
- [ ] Quality report generation.

## Immediate Next Tasks
- [ ] Decode the `Contents` and `Quill/QuillSub/CONTENTS` streams from `Testfokus.pub`.
- [ ] Map the discovered structures into a first internal document model draft.
- [ ] Explore `EscherStm` and `EscherDelayStm` as the likely drawing/object layers.
- [ ] Attempt a first minimal `IDML` package that can be opened by InDesign.

### EPIC-05 Release
- [ ] GitHub Pages frontend deployment.
- [ ] Vercel backend deployment.
- [ ] Environment variable verification.
- [ ] Public end-to-end validation.
