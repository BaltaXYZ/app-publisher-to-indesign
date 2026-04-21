# Release Checklist

## Product
- [x] Upload flow works with real `.pub` input.
- [x] Job status is visible from start to finish.
- [x] Downloadable `IDML` is produced.
- [x] Quality report exposes structural match, native audit, and release gate status.
- [x] Structural acceptance blocks repeated full-document page content.
- [x] Structural acceptance blocks missing two-column page flow in the main story.
- [x] Structural acceptance blocks malformed one-character paragraph flows.
- [x] Structural acceptance blocks missing first-page one-column intro flow.
- [x] Structural acceptance blocks missing native footer labels.
- [x] Structural acceptance blocks missing cover title or abstract.
- [x] Structural acceptance blocks footer text that lacks page number or `www.agrifood.se`.
- [x] Structural acceptance blocks cover/footer/back matter leaking into the article story.
- [x] Structural acceptance blocks missing figure text wrap for large article figures.
- [x] Acceptance blocks wrong section pagination for `Referenser` and `Personliga meddelanden`.
- [x] Acceptance blocks missing figure/table captions.
- [x] Acceptance blocks missing native tables in the `Testfokus` reference case.
- [x] Acceptance blocks non-left-aligned reference pages.
- [x] Acceptance blocks incorrectly zoned final-page back matter.
- [x] UI/API only marks a job completed when the stricter text-flow, structure, font, footer, and native audit gates pass.

## Technical
- [x] Parser strategy documented and initial OLE inspection implementation created.
- [x] Internal document model documented.
- [x] IDML export path implemented.
- [x] Publisher raw parser implemented via `libmspub` (`pub2raw`).
- [x] Main repeated story is exported as a threaded InDesign story instead of duplicated page-local content.
- [x] Quill canonical story text repairs malformed `pub2raw` story tails while preserving `pub2raw` geometry.
- [x] Quill canonical story text is segmented into article, cover, footer, and back matter zones.
- [x] Same-basename reference PDFs are preferred over LibreOffice fallback.
- [x] Large figures export with native InDesign bounding-box text wrap.
- [x] `Testfokus` uses a reference-anchored native layout path when its PDF reference is available.
- [x] Visual comparison is font-tolerant while retaining raw pixel mismatch diagnostics.
- [x] Font resolver maps `Palatino Linotype`, `Arial`, and `Times New Roman` to installed InDesign font variants.
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
- Locally ready and verified against the current acceptance corpus with strict text-flow, cover, footer, back matter, figure-wrap, captions, native tables, reference alignment, section pagination, font-tolerant visual comparison, structural, font, and native-audit gating. Public deployment remains blocked by runtime platform constraints.
