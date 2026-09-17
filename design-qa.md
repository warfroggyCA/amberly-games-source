# Victory badge visual QA

final result: passed

## Visual target and evidence

- Approved source: `/Users/dougfindlay/.codex/generated_images/01a09d72-eaef-7bd1-a690-a8eb904bf456/exec-4818e3db-7f13-4f1a-8593-f6c0c94bed5c.png` (1774 × 887 matched pair).
- Browser implementation: actual ResultBadge component and makeResultBadge renderer, bundled into an isolated local fixture at http://127.0.0.1:4322/. No production games were modified.
- Combined comparison: `/Users/dougfindlay/Documents/Codex/amberly-crokinole-review/badge-preview/comparison.png`, approved pair above implementation pair.
- Captures: `gallery.png`, `phone.png`, `tie-dialog.png`, `doubles-dialog.png` in that same preview directory.
- Desktop CSS viewport: 892px wide. Browser capture scaled content to half CSS dimensions inside its full-page output; extracted 255px square badge regions were normalized to 510px alongside reference panels. This capture compression is not an exported-image defect; actual generated PNGs are 1080 × 1080.
- Phone CSS viewport tested at 390 × 844, DPR 1. Measured dialog bounds x2.5–372.5, y148.9–695.1; document scroll width375. Temporary viewport override reset afterward.
- States: Scrabble Doug312, Crokinole Doug300, doubles Cristine & Nathan300, tied Erin/Braeden280, long double name305. Focused name and score inspection used opened share dialogs in addition to the full comparison.

## Findings and iterations

- Original concept used baked sample lettering. Production uses real raster wood pieces and dynamic names/scores while keeping static brand/game art. This is required for actual results, and intentionally uses live typesetting rather than a baked mock name.
- Initial doubles lettering was too small on one row (P2). Balanced two-row names implemented; inspected actual doubles dialog with both partners legible.
- User requested removing EACH and curving score text. Removed EACH, positioned and rotated each score glyph on the ribbon arc. Inspected revised tied result and comparison.
- No remaining P0/P1/P2 visual issues found in inspected states.

## Required fidelity surfaces

- Typography: static gold game headings retained in generated artwork. Dynamic cream name glyphs use sans serif for square tiles and serif for discs; serif gold score follows ribbon. Long names retain full text rather than tiny pieces.
- Spacing: matching board/crown/name/ribbon hierarchy. Names stay within their allotted area; tie names occupy separate rows. Small crown/board proportion differences from concept are acceptable asset variation.
- Colour: matched emerald, walnut, cream and gold across both games.
- Image quality: production raster assets at1080px; pieces at512px. Export and displayed preview are the same PNG, preventing divergence. Board art is decorative, not a representation of the played board.
- Content: game identity obvious, live winner names and final score, correct tied-result heading, no EACH. No private viewer URLs in sharing.

## Interaction and validation

- Open, dismiss with Escape, reopen, switch fixtures, loading to ready, Save image availability, accessible full result labels verified in in-app browser.
- No browser console errors observed.
- Four focused tests pass: grapheme handling, names/team wrapping, failed asset loading. ESLint and final production build (including TypeScript) pass; changed-file formatting passes.
- Gauntlet browser regression: 68 cases passed across desktop Chromium, iPhone portrait/landscape WebKit and iPad WebKit. After the qualifier correction, all 12 badge cases passed again, including failed-artwork retry. Physical iOS native sharing remains unverified.

## Follow-up polish

- P3: exact 3D bevel on dynamically typeset score differs slightly from the generated mock. Dynamic text remains readable and follows the requested curve.
- No deployment in this task.

## Gauntlet review — 2026-09-17

Contract: match the approved paired art while preserving saved winner/score accuracy, readable names and curved scores, private-link isolation, recoverable image/sharing failure, and existing scoring/history workflows. Scope is this uncommitted badge and hub-label update, based on c3809c94; no deployment or production mutation.

Independent source review found one material consistency gap: nonstandard Scrabble tile-set qualification was absent from the shared badge. Added it for scorer and viewer. Keyed Scrabble badges by game ID so their completion state cannot carry across games. Added browser coverage for the qualifier and artwork HTTP 503 -> Try again -> downloadable image recovery.

Evidence: 68 relevant browser cases passed before the small final fix; 12 badge cases passed after it across all four profiles; four focused unit tests passed; focused ESLint, production build with TypeScript, and diff whitespace checks passed. Actual in-app rendering inspected against the approved comparison, including full long team names. Native device share-sheet acceptance is still unverified. Remaining visual difference is minor dynamic text bevel variation rather than a functional gap.

Fresh final independent review of the updated revision found no remaining material blocker. One minor existing qualifier-priority difference remains: a game both assisted and ended early leads with different truthful labels in banner versus badge. This does not alter scores or sharing eligibility. Stop: the scoped contract is met; remaining work is physical-device share acceptance and a separately authorized release.

Final approved refinements: Crokinole name discs use light maple artwork with dark lettering; all badges read GAME NIGHT WINNER, including ties. Both were inspected in the local rendered preview.
