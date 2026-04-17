# Release Checklist

## Product
- [x] Upload flow works with real `.pub` input.
- [x] Job status is visible from start to finish.
- [x] Downloadable `IDML` is produced.
- [x] Quality report exposes structural match, native audit, and release gate status.
- [x] Structural acceptance blocks repeated full-document page content.
- [x] Structural acceptance blocks missing two-column page flow in the main story.

## Technical
- [x] Parser strategy documented and initial OLE inspection implementation created.
- [x] Internal document model documented.
- [x] IDML export path implemented.
- [x] Publisher raw parser implemented via `libmspub` (`pub2raw`).
- [x] Main repeated story is exported as a threaded InDesign story instead of duplicated page-local content.
- [x] Temporary file retention and cleanup verified.
- [x] Run and deploy documentation written.
- [x] Acceptance CLI implemented for manifest-driven corpora.

## Production
- [ ] GitHub Pages frontend deployed.
- [ ] Vercel backend deployed.
- [ ] Required environment variables configured.
- [ ] Public environment verified end-to-end.
- [x] Adobe/InDesign CLI validation path verified.
- [x] Adobe/InDesign document-open validation evidence captured.

## Current Release Call
- Locally ready and verified against the current acceptance corpus with structural release gating. Public deployment remains blocked by runtime platform constraints.
