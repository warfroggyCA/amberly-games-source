# Mahogany board theme — September 16, 2026

Implements the owner's selected second concept, informed by the WS Game Company Deluxe Wooden Rotating Scrabble Board (Amazon ASIN B004CTH7ME). The digital treatment uses a slimmer mahogany frame, brass grid, ivory field, burgundy/red word multipliers, navy/blue letter multipliers, mahogany tiles with ivory lettering, and a forest-green cloth bag with an ivory count.

## Shared appearance

`src/components/tabletop.css` defines the material and premium-colour variables at the root, so components rendered in body portals share the same appearance. Scorer, spectator, history/results boards, setup preview, turn review, letter inventory, equipment quantities, leftover racks, flying tiles, header tiles and share-dialog decoration all use this palette. Assigned blanks retain blue lettering and a pale-blue face. Current-player, word-validity, selection and crown behaviour remain unchanged.

The owner's contrast follow-up adds a darker tile face, bright upper bevel, dark lower edge/contact shadow, and a one-pixel inset on each board tile. This separates placed tiles from dark multiplier cells at phone size. Touch targets retain their original cell size.

The frame now occupies 1.3% of the fitted board (5–10px); outer board sizing is unchanged. Its border image uses only the outer 7% of the source, without painting the generated centre. Existing bottle-table backgrounds, motion, board fit and safe-area clearance remain in place.

## Assets

New generated art is versioned; previous artwork is retained. Image generation performed the material edits; the existing Sharp dependency only resized and encoded the results.

- `public/tabletop/board-frame-mahogany-v1.webp`: 1024 × 1024, 80,622 bytes.
- `public/tabletop/tile-mahogany-v1.webp`: 256 × 256, 10,234 bytes.
- `public/tabletop/bag-forest-v1.webp`: 512 × 512, transparent, 68,138 bytes.
- `public/social/amberly-games-v2.jpg`: 1200 × 630, 150,758 bytes.
- `public/icon.svg`: existing vector geometry recoloured; v2 PNG exports at 32, 180, 192 and 512 pixels. Layout and manifest reference the v2 filenames.

Public link artwork contains branding only. Metadata does not look up game state or expose names, scores or viewing credentials. Existing installed icons and message previews may retain their earlier cached artwork.

## Verification and release state

- Production build including TypeScript: passed.
- ESLint: passed.
- Existing browser suite: 24/24 passed on desktop Chromium, iPhone WebKit portrait and landscape, and iPad WebKit. Covers scoring/undo, refresh, draft continuity, equipment, bag toggling, scoring ownership, provisional viewer totals and reconnect/selection clearing.
- Rendered scorer and actual spectator component inspected at 390 × 844 and 1194 × 834. Inventory, turn review, draft/recorded tiles, blank tile and green bag inspected. A temporary local viewer fixture was removed before the production build.
- No data, rules, API or database changes. Physical iPhone/iPad acceptance has not been performed.
- Implemented locally; not deployed in this change.

## Word-details and palette refinement — September 16

The scorer's selected-word dialog, spectator detail card and history word meanings now share `PlayedWordDetails`. It reuses `ReviewWord` with the recorded turn's placements and score: the tile strip preserves blanks and distinguishes premium squares applied on that turn from those already used. Player, round and assisted attribution remain visible. The dictionary link is visually shorter but retains a word-specific accessible name. Definition loading, missing entries, failure/retry and request cancellation retain their existing behaviour.

The dialog has a smaller heading, compact attribution, a separate score and a matching green entry button. In short landscape viewports the spectator card is constrained to the right side below the header, preserving a tappable section of the board. The first browser check exposed whole-board overlap there (23/24 passed); the layout was corrected before repeating validation.

Multiplier colours were softened twice following owner feedback: TW `#956774`, DW `#cfa1a4`, TL `#5e7592`, DL `#aabbd0`. TW/TL retain ivory labels; DW/DL use darker labels. Calculated label contrast is 4.52:1, 5.93:1, 4.55:1 and 6.59:1 respectively. Board, setup, review/detail strips and the unreleased v2 app icon share those colours. Letter-tile materials remain unchanged.

Desktop and phone word details, assigned blanks, score attribution, spectator clearing and the local board palette were visually inspected. Temporary visual fixtures were removed. The final production build and lint checks passed, and all 24 browser checks passed after the landscape correction. This remains a local update.
