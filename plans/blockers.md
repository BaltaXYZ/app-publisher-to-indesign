# Blockers

## Active External Blockers

### BLK-003 Public Conversion Hosting
- Status: open
- Owner: platform/runtime decision
- Impact: Local release is complete, but public deployment of the conversion runtime is not.
- Unblocks when: The conversion runtime moves to a worker-capable platform, or the conversion engine becomes fully cloud-compatible without LibreOffice + Adobe runtime dependencies.

## Resolved Blockers

### BLK-000 Repository and Hosting Direction
- Status: resolved
- Resolution: GitHub repository exists and Vercel account access is already available in this environment.

### BLK-001 Representative `.pub` Fixtures Missing
- Status: resolved
- Resolution: `Testfokus.pub` is now present in the workspace root and can be used for the first feasibility spike.

### BLK-002 Adobe/InDesign Validation Path Not Yet Verified
- Status: resolved
- Resolution: `Adobe InDesign 2026` is installed and reachable from the agent via AppleScript, which is sufficient to begin automated validation experiments.
