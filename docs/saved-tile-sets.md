# Saved physical tile sets

Status: published on September 16, 2026 after explicit user approval. READY preview `dpl_9K9i48dLAsYvjPN6tra8ZUNPso65` serves https://amberly-games-preview.vercel.app/family.

## Everyday use

Open the game menu → Settings (gear) → Tile sets. Add a named physical set, adjust A–Z and blank quantities with the tile controls, and optionally record that the tiles have been counted. The saved default is used automatically for new games. Setup has a collapsed Change set selector only when saved sets exist; equipment is not an extra per-game confirmation step.

The built-in Standard English set remains available with its original 100 tiles. A saved set can contain 1–200 physical tiles, including missing letters or additional blanks. Starting a game requires at least seven tiles per player. Letter values, the board, and the seven-tile rack rule stay standard English. Nonstandard quantities remain in game history but are excluded from standard player records under the existing custom-supply policy. A named set with exactly standard quantities retains normal eligibility, subject to the other existing record rules.

Changing quantities clears the last-counted date unless the scorer confirms a new count. Saved sets can be renamed or adjusted and a different default selected. The application does not erase saved sets. Counts cover the complete physical set before dealing; the bag estimate subtracts the initial racks and subsequent draws. Per-letter unplayed counts continue to include both racks and the bag.

## Data and authorization

- Every new game copies the selected set ID, name, quantities, last-counted date, and catalog revision into its original definition. Later equipment edits affect future games only. Existing games without a tile-set snapshot continue to use the original standard distribution; no history is rewritten.
- Local preview sets use the existing IndexedDB store. Shared sets belong to the family. Active family members can save them; public viewers cannot read or change the equipment catalog.
- Shared setup sends only a set ID and revision. The server resolves and validates the quantities, rejects stale selections, and creates the immutable game snapshot. Client-supplied quantity overrides are rejected.
- Shared catalog saves require the expected revision, run under the existing family transaction lock, and append an actor-attributed audit entry. Simultaneous saves cannot silently overwrite each other. Exact request retries remain idempotent; delayed acknowledgements return current equipment. Errors preserve the editor input, and conflicting edits have an explicit discard-and-reload action.
- Shared and local history exports include the saved catalog. Scoring, inventory warnings, rack reconciliation, undo/replay, assisted solving, and the spectator inventory all use the game's copied quantities.
- Settings do not alter the quantities of an in-progress game. The existing audited per-game supply extension and rack/bag reconciliation remain separate.

## Release and recovery

Apply `supabase/migrations/20260916150031_saved_tile_sets.sql` before publishing the new app. It adds one private family-keyed table with RLS, runtime member policies, a bounded JSON payload, actor membership reference, and no-erasure trigger. It does not modify existing game or player records. It passed disposable local PostgreSQL verification, then was applied to the existing Amberly hosted project as provider migration `20260916152145_saved_tile_sets` after explicit approval. The source timestamp remains `20260916150031`; do not blindly reapply it through `db push`.

The same release includes the scoring-tab takeover fix documented in `scoring-tab-takeover.md`. Its browser database version-2 compatibility must be preserved. After custom-set games exist, a rollback must also retain tile-set snapshot interpretation; use a forward fix rather than an older binary that cannot replay those definitions. Do not drop the equipment table or clear browser storage as recovery.

## Verification

- Full app suite: 696 passed; the 36 database cases are skipped in the ordinary run and all 36 passed separately against real disposable PostgreSQL.
- TypeScript, project-wide ESLint, formatting checks, and optimized production build passed.
- Tests cover malformed/sparse/accessor input, missing letters and blanks, minimum starting inventory, unchanged legacy games, immutable snapshots, scoring/replay/undo, exhausted letters, stale/concurrent saves, retry identity, delayed acknowledgements, API quantity injection, family isolation/RLS, audit history, spectator quantities, and export.
- Browser checks used isolated localhost:3009 storage through the real UI: created and counted a 99-tile set missing one C, reloaded, started a two-player game using that default, and verified 85 expected in the bag and C 1 of 1. Editing the default to 98 tiles/C 0 did not change the already-running game's 99 tiles/C 1. The changed set correctly cleared its count confirmation.
- Phone-sized 390×844 and tablet-sized 1024×768 browser layouts were inspected. The phone editor had no horizontal overflow; clearing a numeric field disabled Save and entering a valid quantity restored it. Save controls were reachable by scrolling. No browser warnings/errors were captured in this local check. Temporary viewport overrides were reset.
- Hosted migration and deployment passed. Hashes and row counts for all four game definitions/states, 22 events, three results, and five player profiles matched before and after migration. RLS, member-only runtime grants, three policies, and the no-erasure trigger were verified; the new equipment table remained empty. Security advisors were unchanged from baseline, with only the existing [leaked-password-protection advisory](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Authentication settings were not changed.
- The hosted optimized build/TypeScript passed. An independent lookup confirmed the stable alias points to READY preview `dpl_9K9i48dLAsYvjPN6tra8ZUNPso65`. Signed-out preview sign-in loaded. Signed-in Chrome loaded existing history, Settings → Tile sets, and the full editor; editing was canceled without saving invented equipment. A second Chrome tab automatically took ownership; Use this tab returned ownership to the original tab, and its board input was enabled. The temporary tab was closed and the original left on Settings. No scored turn, profile, or saved equipment record was created during these live checks.
- Actual shared equipment saving remains covered by local database/API/store tests rather than a hosted test record. Physical iPhone/iPad keyboard and touch behavior remain unverified.
