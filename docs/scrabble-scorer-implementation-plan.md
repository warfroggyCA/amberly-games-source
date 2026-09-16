# Family Scrabble Scorer — implementation plan

**Status:** proposed implementation plan, September 13, 2026. Planning only; no application has been built or deployed.

**Intended source directory:** `/Volumes/X10 Pro/Coding Projects/Scrabble scorer`. The directory was checked during planning and exists with no application files. This planning task is currently running in a separate Codex directory; implementation must explicitly use the intended source directory.

The product is a private family companion to physical Scrabble: reproduce the table's board, enter and validate plays, calculate scores, and preserve a trustworthy family record. iPad and phone are the primary devices. The complete planned app includes assisted finishing, not just a score sheet.

The latest conversation takes precedence over the earlier [research brief](/path/to/local/Documents/Codex/2026-09-13/let/outputs/scrabble-scorer-research-and-recommendations.md) and [mockup gallery](/path/to/local/Documents/Codex/2026-09-13/let/outputs/scrabble-mockups-v1/gallery.md). Mockups are visual references, not valid board positions or scoring test fixtures. In particular, ordinary dictionary checking must not be called “assisted play”; that label is reserved for suggested or automatically chosen moves.

## 1. What the app must deliver

These requirements come from the conversation. Implementation details and unresolved rule choices appear separately below.

| Area | Required outcome |
| --- | --- |
| Family players | Persistent profiles; select existing players or add someone during setup; an empty first-use experience works naturally. |
| Setup | One to four participants; movable names around the board; choose first player and clockwise or counterclockwise order. |
| Board entry | Type directly onto a digital board matching the physical game; identify the current player. |
| Blanks | Space inserts a blank and asks for its letter. Its represented letter remains visibly different and contributes zero tile points. |
| Scoring | Validate every word formed by the placement against the selected official word source; calculate the whole turn automatically. |
| Live display | Always-visible scores and ranking, plus a hideable side panel and a round-by-round score sheet. |
| Tile inventory | Bag icon opens All Letters with original quantities and quantities remaining. Labels distinguish unplayed tiles from actual bag contents. |
| History | Preserve games, players, turns, words, score breakdowns, results, and records over time. |
| Shared access | Family members can view history and records and score new games from their own devices. |
| Administration | Doug begins as superadmin and can grant that role to others. No app user, including a superadmin, can erase history. |
| Ending | End game opens a review and confirmation; account for leftovers and classify early endings correctly. |
| Assisted finish | Enter remaining racks, generate legal suggestions, and automatically continue in the existing playing order until the selected stopping condition. |
| Achievement integrity | Assisted moves never enter personal word, best-word, best-turn, bingo, clutch, or similar human achievement statistics. Assisted final outcomes remain separate from normal competitive records. |

Additional workflow requirements needed to make those features dependable: explicit turn confirmation, pass/exchange, reversible entry mistakes, auditable corrections, autosave/resume, clear sync status, one active scorer per game, and a tested backup/restore process.

## 2. Working defaults and decisions to settle

Doug confirmed the no-draw assisted finish during planning and requested the official word reference without an additional family/school filter. Other entries below are proposed implementation defaults, not additional choices already approved by him.

| ID | Decision | Status and proposed specification | Must be resolved before |
| --- | --- | --- | --- |
| D1 | Delivery platform | Installable web app, usable in Safari and from the home screen on iPad/iPhone; responsive desktop access too. | Project scaffold. |
| D2 | Word reference | Doug wants the official reference without an extra family/school filter. Recommend the full NASPA Word List, currently NWL2023. Confirm the actual asset, long-word coverage, and permitted use; recheck the available edition when implementation begins. | Official validation ships. |
| D3 | Family rules | Family v1 based on Hasbro household booklet A8166, with the explicit app variations below. Automatic pre-submission checking; no challenge penalties. One player is Solo practice. Counterclockwise is an explicit family preference. | Rules fixtures and setup defaults. |
| D4 | Assisted remaining tiles | **Confirmed by Doug: current racks only, no further draws.** This is a disclosed house finishing variant if tiles remain in the bag. | Settled; carry into implementation. |
| D5 | Assisted end adjustments | Deduct remaining rack values. Add the usual going-out transfer only when the real bag was already empty and a rack is emptied. When bag tiles are intentionally left unused, apply no going-out transfer. | Assisted result fixtures. |
| D6 | Corrections | Current scorer can correct a live game. A superadmin applies amendments to finalized games, with a reason and a before/after preview. Originals remain readable. | Permission policies. |
| D7 | Clutch definition | A precisely defined late lead-taking play that contributes to a human, normally completed win; definition below. | Clutch records are published. |
| D8 | Hosting and recovery budget | Next.js/TypeScript, Supabase, and Vercel; production email delivery; managed database backups plus an independent export. Choose paid services and recovery targets before storing real family history. | Service provisioning and family launch. |

Both preference questions raised during planning have been answered, including Doug's subsequent clarification that all players are adults. D2 now recommends the full official North American reference and D4 is confirmed. Word-data permission and coverage remain external dependencies; choosing the source does not resolve them. Further physical or simulated draws are outside the agreed assisted finish.

NASPA identifies NWL2023 as the currently effective official reference for Scrabble play in the United States and Canada. It also publishes developer licensing routes. Availability does not establish this app's permission to distribute an offline word file; obtain the relevant terms first. [NASPA Word List](https://scrabbleplayers.org/w/NASPA_Word_List), [NASPA licensing](https://scrabbleplayers.org/w/Licensing).

The Merriam-Webster OSPD seventh-edition listing describes two- through eight-letter coverage. That book's title alone is insufficient evidence of complete coverage for every longer board word. [Publisher listing](https://shop.merriam-webster.com/products/the-official-scrabble-players-dictionary-seventh-edition).

## 3. Product structure and screen flows

### Home and family

Home prioritizes Resume game, New game, recent games, and family records. The first visit offers Add your first player. A person being scored does not need their own login: a player profile and a signed-in family member are separate identities. A superadmin can later link an invited member to the appropriate player.

Use stable IDs, not names, for ownership and statistics. Renaming a player preserves their history. Warn about similar existing names without merging people automatically. “Archive player” removes a profile from ordinary setup choices while retaining all references and past appearances. Recorded names are retained as snapshots; history may also show the person's current display name.

### New game

1. Select existing players or add someone new. Prevent selecting the same profile twice.
2. Place players in seats around the board. Dragging onto an occupied seat swaps players; a tap-and-swap alternative provides the same result without dragging.
3. Select the first player and play direction. Preview the exact name sequence, skipping empty seats.
4. Show the rules and word-list edition, and confirm that the physical tile set matches the preset.
5. Start the game. Participants, order, rules, tile distribution, and lexicon version are frozen for that game.

A one-player game is labelled Solo practice. Starting a game and adding new members require connectivity in the initial release; an already prepared game can continue offline once its required assets are stored on the scorer's device.

Seats remain stable during play while leaderboard positions change. Changing device orientation or hiding a panel must never change play order. Adding/removing a participant midgame is not a normal setup edit; finish or pause the existing record instead of rewriting who participated.

### Live board

The board remains the visual focus. Player names surround it, with a persistent current-player marker. A compact score strip stays visible even when the side panel is hidden. Selecting Hide panel expands the board; a visible Show panel control restores it without losing a draft.

On iPad, use the available width for board, seating, and an optional panel with Scores, Rounds, and Turns. On phone, use a full-board overview plus an enlarged selected area for precise entry; the panel becomes a dismissible sheet. The software keyboard must not cover the current square, selected player, or Record action. Do not shrink fifteen columns and assume every cell is comfortably tappable.

The entry flow is: **tap starting square → choose across/down → type → review formed words and points → Record turn**. Support both typing through matching existing letters and extending a word from its open end. Existing tiles cannot be overwritten. The complete resulting word must be obvious in the preview.

Space at an empty entry square opens a blank-letter selector. Cancel leaves the draft unchanged. Use a blue represented letter plus a zero marker and an accessible blank label; colour alone is insufficient. Provide a visible Blank button and an option to correct the physical tile type in the draft. A recorded blank's assignment cannot later be silently changed.

Backspace and Clear draft affect draft tiles only. Suppress inappropriate autocorrect and capitalization substitutions. Handle paste, software and hardware keyboards, composition input, rapid taps, and double-space punctuation explicitly. Unsupported characters produce a clear correction opportunity rather than silently changing the intended word.

Draft points are labelled as a preview and do not alter committed scores. Record commits the turn once and moves to the next player. An invalid crossing word highlights that word on the board and preserves the draft. Unavailable validation is shown as unavailable, not “invalid.”

### Rounds, leaderboard, and turn detail

A round is one traversal of the chosen playing order, starting with the selected first player. Show one column per player and one row per round, with a toggle between round points and cumulative points. A not-yet-taken turn is a dash. Pass and Exchange display their labels with zero points; a legal zero-point placement remains a placement. End adjustments occupy separate rows, not an invented round.

Tapping a cell opens that turn's placement, every word formed, individual word scores, bonus, and running total. The full turn log also records passes, exchanges, corrections, and assisted attribution. Tied live scores display a tie; stable display order does not decide a winner.

### All Letters

Show letter, tile value, original quantity, played quantity, and unplayed quantity; include blanks as physical tiles. Caption: **“Remaining means not yet on the board; includes players' racks.”** Exhausted letters remain visible.

`Unplayed by tile type = original distribution − physical tiles on the effective board`

`Bag total = original total − board tile count − actual total rack count`

Ordinary scoring does not require private rack letters. The app can maintain expected rack sizes and an expected bag total under normal refill behaviour, but must label that assumption. At endgame or an inventory discrepancy, reconcile actual rack counts. Exchanges change neither the board nor the total number of bag tiles after a completed like-for-like exchange.

For example, a complete 100-tile set with four initial seven-tile racks has 100 unplayed tiles and 72 tiles in the bag. A blank representing Q reduces the blank supply, not the Q supply. Correcting a turn must update this accounting from the same effective history as scores.

### History, records, and sharing

Provide a searchable game list, game detail with round scores and replay, player profiles, and a family record book. Filters distinguish normal completion, early ending, assisted ending, Solo practice, participant count, and rule/word-list versions. Display the sample size behind averages.

A record links directly to the game and turn that produced it. A small share card contains a selected score or achievement, players as chosen by the sharer, date, and the relevant normal/early/assisted label. Use the device share action only when the user invokes it. Internal links require family sign-in; public browsing of family history is not part of this release.

Favourites and short game notes may mark memorable moments. Editing a saved historical annotation retains its prior version. Share images already exported to another app are snapshots; a later correction updates the app's record but cannot replace somebody else's saved image.

## 4. Scoring and rules contract

### A deterministic domain engine

Create a small UI-independent engine that accepts the versioned game state and a proposed action. It returns either a precise validation error or the complete resulting state and score breakdown. Use it for browser previews and server validation. The server reconstructs the trusted board and recomputes the result; it never accepts a client-supplied total as authoritative.

The engine owns board geometry, physical tile identity, blank assignment, word discovery, premium application, turn order, inventory, round assignment, and end adjustments. It does not use a language model to decide spelling, legality, arithmetic, or the next “best” move.

Opening and placement checks cover board bounds, a centre-covering opening, a single line of new tiles, continuity through existing letters, board connection, no conflicts, and every newly formed word. Do not require entry of opponents' rack identities during ordinary play; the app cannot prove that a player physically held a tile that was never entered.

For each distinct formed word, apply letter premiums to newly placed tiles, then applicable new word premiums. Existing premiums do not reactivate. A blank's base value remains zero. The turn total is the sum of word scores plus the seven-new-tile bonus, when applicable. Store word contributions separately from the bonus. [Mattel rules and scoring examples](https://service.mattel.com/instruction_sheets/53639-ENG.pdf).

Store coordinates in a documented canonical format, independent of screen orientation. Identify a formed word by its start coordinate, direction, and extent, so a one-tile placement making two words is scored correctly without duplicate entries. Reject more new tiles than the player's available rack count, and impossible global tile usage. Validate opening rack assumptions and actual end racks separately.

### Published rules versus family choices

Keep one explicit preset initially, with edition and version stored on every game. The selected Hasbro household booklet uses clockwise play, 100 tiles including two blanks, a seven-tile rack, and a blocked ending after everyone passes twice consecutively. Its natural end and leftover adjustment rules should be represented by tested fixtures. [Hasbro household rules](https://www.hasbro.com/common/documents/dad2884b1c4311ddbd0b0800200c9a66/0606acdbbc9d4b55bfd2df956f61a723.pdf).

For proposed Family v1, exchange one or more tiles only when the bag has enough replacement tiles: set the discards aside, draw replacements, then return the discards. Record the quantity and zero-point turn. Do not add a seven-tile bag minimum to this household procedure. The tournament rulebook specifies that different threshold; it would require an explicitly different preset. [NASPA tournament rules](https://www.scrabbleplayers.org/rules/rules-20161201.pdf).

For the proposed household pass rule, count consecutive passes, not all zero-score turns. A placement or exchange breaks the sequence. For Solo practice, allow manual practice completion or completion when bag and rack are empty; deduct any remaining rack value without a transfer to another player. Solo completion never creates a multiplayer win.

Automatic word checking is standard for this app's family scoring mode and does not itself trigger an assisted flag. Challenge penalties, dictionary overrides, custom tile sets, and reclaimed blanks are separate possible future variants; none should be quietly included in normal records.

### Lexicon assets and reproducibility

The selected lexicon must support every applicable board word length and preserve blank-aware move generation. Store provider, edition, filtering, asset checksum, licence reference, and engine version on the game. Package a permitted local asset for fast/offline lookup, and verify its availability before declaring a game ready for offline scoring.

Do not scrape a public checker, substitute a generic English dictionary, fill long-word gaps from another list, or treat a network error as a spelling verdict. Rights for a solver's code and rights for its word data are separate dependencies. Definitions are optional and need their own permitted source; they are not required to calculate scores.

A new dictionary affects new games. Historical verdicts and original totals are retained with their original versions. A rules-engine bug discovered later requires an explicit, auditable amendment process for affected history, not silent recalculation of every old record.

## 5. Ending a game

### Normal and early endings

End game opens a review rather than committing immediately. Resolve or retain any draft explicitly. Display the ending reason, turn counts, bag status, each player's remaining rack, score before adjustments, deduction, any transfer, and proposed final score.

| Ending | Treatment |
| --- | --- |
| Bag empty and a player has used their last tile | Validate the physical state; apply the preset's leftover deductions and going-out transfer. |
| Blocked under the selected preset | Deduct remaining rack values; do not invent a player who went out. |
| Stop now | Deduct actual leftover rack values with no going-out transfer. Label ended early, show whether turns were unequal, and exclude the result from normal competitive game records. |
| Finish the current round manually | Continue normal human entry through the remaining seats, then offer early finalization. Equal turns alone do not make it a normally completed game. |
| Finish with assistance | Use the separately labelled process below. |
| Pause | Preserve the live game without final results or a winner. |

The final review offers Confirm final results and Return to game. The server checks the game version again at confirmation. A duplicate confirmation returns the already-created result. Normal turn entry stops after finalization; later corrections create an amended result version.

Enter actual leftover letters, including blanks, so deductions are reproducible. A blank has zero leftover value. Allow negative final totals. Proposed Family v1 breaks a tied final score by the higher score before leftover adjustments; retain a shared tie if still equal. Never use leaderboard array order to award a win.

Expected bag counts are not enough to certify an end condition after an unrecorded draw or exchange. If the entered racks and board cannot reconcile to the physical set, preserve the review and explain the mismatch. Resolve it before claiming a verified final result.

### Assisted finish: exact proposed behaviour

This section implements confirmed D4 using the proposed D5 adjustment policy. It is intentionally described as a house finish when bag tiles remain unused; automation does not retroactively equalize the human turns already played.

1. **Freeze the human stopping point.** Start only between recorded turns. Save board, scores, next player, turn counts, rules, game revision, and the last human turn. Synchronize before starting assistance.
2. **Enter every remaining rack.** Record actual tile types and blanks, with a review per player. Validate rack sizes and combined inventory. If a natural ending already occurred, offer the ordinary finalization path instead.
3. **Explain the outcome category.** Display “Current racks only; no more tiles drawn,” the adjustment rule, and exclusion from normal game records. Confirm before revealing recommendations.
4. **Mark assistance before exposing a suggestion.** Record the assistance boundary on the server. Suggestions and all subsequent play belong to the assisted portion, even if the scorer pauses automation or types a later move manually.
5. **Generate legal placements for the next player.** Search the actual current board and that player's rack using the game's exact lexicon. Score complete turns, including crossing words and bonuses.
6. **Rank by points.** Highest immediate turn score wins. For equal scores, use more tiles placed, then a documented canonical coordinate/direction/tile ordering. This is not a claim of optimal long-term strategy. Show up to five alternatives on request; a manually selected suggestion remains assisted.
7. **Commit, then recompute.** Apply the selected move, consume that rack's physical tiles, append an assisted turn, and generate the following player's options from the updated board. No independent batch of suggestions from the old board.
8. **Handle no move correctly.** A completed search with no legal placement records a pass. A timeout or solver error pauses the process and retains state; it is never converted into a pass.
9. **Stop explicitly.** Under the no-draw variant, stop when a player empties their rack or one complete cycle passes with no placement. With unchanged racks and board, that full cycle establishes that nobody can continue. No exchanges occur in this variant.
10. **Review and confirm.** Show human stopping scores, assisted additions, end adjustments, and assisted final totals before final confirmation.

Playback offers Pause, Next move, and Skip animation. Animation is a view of persisted steps; skipping it cannot manufacture a completed simulation. If computation is still running, show that state. Closing the browser pauses orchestration safely; reopening resumes from the last committed step instead of replaying it twice.

If the family cancels after seeing suggestions, the assistance classification remains. The app can preserve a paused assisted game or finalize early with assistance disclosed. It must not quietly restore normal record eligibility after the advice has been revealed. Cancelling the setup before assistance is confirmed and suggestions are exposed leaves the human game unchanged.

Quackle's interfaces distinguish move score from equity and expose legal-move generation. Those are useful references, but they do not establish that its code will fit the proposed deployment unchanged. The first implementation phase must evaluate the licence, language/runtime packaging, exact lexicon use, and measured performance before choosing an engine. [Quackle generator interface](https://github.com/quackle/quackle/blob/master/generator.h), [Quackle move and ranking interface](https://github.com/quackle/quackle/blob/master/move.h).

The integration must prove that “highest scoring” means a completed legal-move search. Each selected move is independently checked by the application's scoring engine before persistence. Store solver version and relevant search settings. Avoid an open-ended strategic simulation or language-model service for this feature.

## 6. Records and achievement eligibility

The server owns these rules. A frontend flag, an edited label, or a superadmin amendment cannot turn an assisted move into a human achievement.

| Evidence | Human word/turn records and bingos | Normal wins, best game, game averages, streaks | Clutch/comeback records |
| --- | --- | --- | --- |
| Valid human moves in a normally completed multiplayer game | Eligible | Eligible result | Eligible if the definition is met |
| Valid human moves before the assistance boundary | Eligible, with the game's assisted label visible | Assisted outcome excluded | Excluded because the winning outcome depended on an assisted finish |
| Suggested or automated moves, and subsequent play after assistance starts | Excluded | Excluded | Excluded |
| Human moves in an early-ended game | Eligible after finalization, with early-ending context | Excluded | Excluded |
| Solo practice | Separate practice category | Separate practice category | No multiplayer awards |
| Superseded, voided, or invalid plays | Excluded from effective records; original evidence remains visible | Use latest valid result only | Use latest valid result only |
| Active or paused game | Show provisional personal-best information in the game | No completed result | No final award |

Ordinary dictionary validation and arithmetic are not suggestion assistance. The system records the source of a move from the workflow, not from a user-editable checkbox. It cannot detect advice received outside the app; this is a trusted family scorekeeping tool, not an anti-cheating surveillance system.

The assistance exclusion takes precedence over the practice category too: an assisted Solo move is not a human practice achievement. A displayed win resolved by the preset's tie-break counts as a win, but the stricter sole-lead condition still governs clutch awards.

### Definitions to implement once

| Metric | Definition |
| --- | --- |
| Highest-scoring word | Maximum individual formed-word contribution on an eligible human turn. Excludes the separate bingo bonus. Main and crossing words are both eligible. |
| Highest-scoring turn | Maximum complete eligible human turn total, including crossing words and any bingo bonus. |
| Words formed | Count each distinct word occurrence formed by an eligible turn. Do not recount an unchanged word on a later turn. |
| Unique words | Distinct normalized spellings among eligible occurrences; preserve the separate underlying occurrences. |
| Bingo count | Eligible human turns using seven new physical tiles. A seven-letter word using old tiles is insufficient. |
| Best game / average final score | Latest effective final scores from normally completed, unassisted multiplayer games, filtered by participant count and compatible rules. |
| Points per turn | Human turn points divided by eligible human turns, including labelled passes and exchanges. Excludes leftover adjustments; exposes its game-category filter. |
| Win rate | Wins divided by eligible completed games, with ties reported separately and still included in the denominator. |
| Head-to-head | Direct two-player results by opponent initially; do not reinterpret every four-player placing as a two-player match. |
| Winning streak | Consecutive eligible games in stable game-start order; ties break a win streak. Early, assisted, and practice games neither extend nor break the normal-game streak. |
| Biggest comeback | For the eventual sole winner of an eligible game, the largest deficit to the leader at a completed-round boundary before the ending. This compares equal opportunities to play. |
| Clutch lead-taking play | Proposed D7: in the last two rounds containing play, a human placement takes a player from tied/behind to sole lead; the player remains sole leader after every later scoring event, including final adjustments, and wins the eligible game. |

For clutch ranking, prefer the largest pre-play deficit overcome, then turn points; display tied achievements if those values tie. An empty round created only by UI state does not count. Include an ending partial round among the last two played rounds. If there is no qualifying turn, show none; do not invent an award. A win created solely by leftover adjustments is visible in results but is not a word-play clutch award.

Example: a player on 150 trails 174, then scores 44 to reach 194. The move crosses from 24 behind to 20 ahead. It qualifies only if the timing and subsequent lead/win conditions also hold. The engine does not infer a win probability from unknown racks.

Store a definition version for derived achievements. Corrections recompute affected effective records atomically or leave them visibly “updating” until a complete replacement is ready. Do not briefly publish old and new awards together. Keep final-score records separate from human stopping scores in assisted games.

## 7. Technical architecture

### Recommended stack and boundaries

| Component | Responsibility |
| --- | --- |
| Next.js with React and TypeScript | Responsive UI, installable app shell, authenticated server endpoints, and result-share rendering. |
| Shared TypeScript domain module | Pure placement, scoring, inventory, turn, ending, and eligibility logic with versioned fixtures. |
| Supabase Auth | Family member authentication; proposed email one-time-code sign-in. |
| Supabase PostgreSQL | Durable game journal, current projections, membership, results, and history queries. |
| Supabase Realtime | Notify authorized viewers that a game revision changed; refetch the authoritative state. |
| IndexedDB and service worker | Device drafts, pending actions, approved offline assets, and app-shell caching. |
| Vercel Node runtime | Web/server hosting, subject to the assisted-engine packaging and timeout spike. |
| Solver adapter | Narrow legal-move search interface; concrete implementation selected after Phase 0 evidence. |

Use one application repository. No separate mobile codebase, generalized multi-organization product, payment system, or orchestration framework is needed. Use SQL migrations and generated database types. Add libraries only for a specific validated need, such as input validation, database transactions, accessible controls, or test tooling.

Next.js documents home-screen installation and treats offline support as additional work. Installation alone does not provide reliable offline games. Use stable APIs; do not make game recovery depend on an experimental navigation retry feature. [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps).

Pin compatible stable framework/library versions and a supported Node runtime when implementation starts; record them in the lockfile and deployment configuration. Supabase's changelog currently includes runtime-support and API-exposure changes, so old scaffolding defaults are not sufficient evidence of compatibility. [Supabase changelog](https://supabase.com/changelog).

### Logical data model

This is a schema contract, not a migration already applied. The exact SQL is reviewed in Phase 2.

| Entity | Essential information and invariants |
| --- | --- |
| Family | Single private family scope, settings, version, and administrative lock target. |
| Membership | Stable authenticated subject, family, member/superadmin role, active status; role changes audited. |
| Player | Stable ID, display name, archived status, optional member link; never identified only by name or email. |
| Game | Stable ID, family, current lifecycle, revision, active scorer identity/device generation, current result reference. |
| Participants | Frozen player references, name snapshots, seats, and play-order positions; no duplicate participant in a game. |
| Rules/lexicon metadata | Tile set, premiums, direction preference, ending rules, edition/checksum, and engine version. |
| Game journal | Append-only ordered actions and amendments, with actor, command ID, timestamp, payload version, and source attribution. |
| Current game projection | Effective board, rack-count assumptions, scores, next seat, pass sequence, round, and sync revision; rebuildable from the journal. |
| Effective turns/words | Queryable current turn and word contributions linked to original journal evidence; supersession retained. |
| Result versions | Immutable finalizations/amendments: ending category, adjustments, ranks, eligibility, and source revision. |
| Assistance run | Frozen human boundary, entered racks, draw policy, solver version, progress, and current step revision. |
| Historical annotations/admin audit | Who changed what, when, and why; no overwrite-only historical edits. |

Suggested event types include GameStarted, TurnPlayed, Passed, Exchanged, TurnUndone, CorrectionApplied, GamePaused, GameResumed, AssistanceStarted, AssistedStepRecorded, GameFinalized, ResultAmended, and ScorerTransferred. Avoid a general event-sourcing framework: this is a small explicit journal supporting the no-erasure requirement.

Use database constraints for unique game sequence numbers, command IDs scoped to a game, participant positions, membership identity, and valid references. Foreign keys must not cascade-delete game history when someone loses access or a profile is archived. Current projections may be replaced; their source journal and result versions may not.

Record server timestamps in UTC, the game's display timezone, and a stable played-at ordering. Preserve the device's claimed action time separately if useful, without trusting its clock for event order. A game spanning midnight stays one game; amendments do not move it to the amendment date in competitive streaks.

### A single safe mutation path

Keep lifecycle and result classification distinct. A game is active, paused, or finalized; its practice/multiplayer mode and assistance boundary are separate attributes. End review is a preview tied to a revision, not a committed finalization. Pausing and resuming never remove an assistance boundary. Finalized games accept amendments, not ordinary new turns. Reject impossible combinations, such as an assisted game publishing a normal unassisted result.

Every game action includes a command ID, expected revision, scorer generation, and validated payload. The backend verifies authentication, then checks current membership and authority in the transaction. It locks the game, validates the requested transition, recomputes the result, appends the journal action, updates projections, and commits together.

A retry with the same command ID and payload returns the original outcome. Reusing the ID with different content is rejected. A stale revision or scorer generation returns a conflict with the current authoritative revision, preserving the user's pending input. A timeout after the database commit must not create a second turn when retried. Profile and game creation use stable creation-request IDs too, so a retry before a game exists cannot create duplicate people or games.

Locking and revision checks are complementary: the lock serializes accepted mutations; the revision prevents an older client from applying an action to a board it did not see. PostgreSQL documents row-level locking for this use. Keep network calls and solver searches outside the locked transaction, then recheck the input revision before committing their results. [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).

The server validates the maximum newly placed tiles, payload size, coordinates, permitted characters, ownership, lifecycle, rules version, and totals. It derives assistance attribution and record eligibility. Finalization and assisted steps use the same idempotency and revision protections as human turns.

### Read performance

Index membership lookup, game ordering, game-event sequence, participant history, and normalized word lookup. Paginate game/word history with a stable cursor. Fetch a score sheet or game detail in bounded queries, not one query per player or word. Read records from effective turns and the latest eligible result versions; do not repeatedly replay all family history on every board keystroke.

Realtime is a delivery hint, not the journal. Ignore duplicate or older revision notifications and refetch if revisions are skipped. A disconnected viewer sees the last synchronized state with a stale indicator. Private pages and authenticated responses must not enter a public CDN cache.

## 8. Access, permanent history, and corrections

### Permissions

| Action | Family member | Active scorer | Superadmin |
| --- | --- | --- | --- |
| View family history and records | Yes | Yes | Yes |
| Create players and start a new game | Yes | Yes | Yes |
| Record turns/finalize the active game | No, until scoring is handed over | Yes | Can take over through the explicit handoff flow |
| Correct the current live game | No | Yes, with audit | After taking over |
| Amend a finalized game | No under proposed D6 | No under proposed D6 | Yes, with reason and preview |
| Invite/revoke members or grant roles | No | No | Yes |
| Delete historical games, turns, or result versions | Never | Never | Never |

Doug's initial superadmin assignment is bound to his verified authenticated identity during setup. Do not use “first person to sign up becomes admin.” Protect the final active superadmin against removal/demotion, including two concurrent role changes, using a serialized family-level operation. A lost-account recovery procedure restores access to an existing identity/history; it does not reset the family.

Use current database membership for authorization. Never grant authority from user-editable metadata. Cover every browser-exposed table with explicit grants and row-level policies; authentication alone is not family membership. Protect views with invoker behaviour or keep them unexposed. Server roles and secret keys stay on the server, and server-side privileged paths still perform explicit family/role checks. [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

Use the current supported server-auth integration, verified credentials, origin/CSRF protections for mutations, bounded requests, and safe text rendering. Do not cache responses containing another user's authentication/session material. [Supabase server authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs).

Email sign-in needs production delivery before inviting the family. Supabase states its default SMTP service is restricted and not intended for production. Select/configure a suitable sender, test one-time codes in the installed iOS app, and handle expiry/retries without losing a game draft. [Supabase SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp).

Revocation blocks future server access and mutations, including those from an unrefreshed session. It cannot retract information already seen or exported to another device. On sign-out, synchronize pending actions first when possible and remove accessible cached private views. If synchronization fails, retain unsent actions in a recovery queue bound to the original verified account ID. The app can unlock or replay that queue only after the same account authenticates again; a different account must not see or submit it.

### What “no one can delete history” means in implementation

Remove historical DELETE/UPDATE/TRUNCATE privileges from ordinary application runtime roles, and do not expose destructive history endpoints. Keep insert-only original journal/result records; expose effective projections separately. Audit role changes and amendments. Tests must attempt deletion through both the UI's API and direct browser-accessible database APIs, including a superadmin session.

This protects history from app users and ordinary runtime code. A database infrastructure owner can ultimately alter or destroy infrastructure, so recovery also requires separate backups and restricted owner credentials. Do not describe application immutability as protection against every possible infrastructure disaster.

### Correction behaviour

- **Draft edit:** change unsent tiles without touching history.
- **Undo last recorded turn:** append a reversal and restore board, points, inventory, next player, and round together. Explain any physical board/rack reconciliation needed after players have already drawn.
- **Older live correction:** preview replay of affected later turns. If the change makes a later play invalid, require an explicit corrected sequence or a reviewed voiding of dependent turns; never relocate letters or drop turns automatically.
- **Final result amendment:** superadmin previews the complete revised game and affected records, gives a reason, then commits a new result version. The original final result and intervening amendments remain available.

Correction previews bind to a game revision and must be recalculated if the game changes before submission. An unfinished correction does not partly alter official totals. Amendments preserve the original assistance boundary; assisted play cannot be made human by editing a word or removing a visible badge. A record-book rebuild selects only the latest valid effective result for each game.

## 9. Offline play, interruption, and multiple devices

One device is the active scorer for a game; other members can watch. Several different family games may run independently. Store a scorer device generation on the server and use a single-tab lock locally. A second tab cannot silently become another offline writer.

The proposed initial offline scope is **continue a game that was started online and prepared on this device**. Cache its engine/lexicon assets, last synchronized game, draft, and ordered pending actions in IndexedDB. Record local actions durably before announcing local success. Distinguish “Saved on this device,” “Syncing,” and “Saved to family history.” Published final results and family records require server acknowledgement.

On reconnect, upload the ordered commands from their known base revision. The server validates each action and returns its authoritative revision. If an action conflicts, stop that queue and retain it for reconciliation; do not overwrite another device's work or merge two boards heuristically. Idempotent retries handle a response lost after a successful commit.

Scoring ownership does not expire just because a phone sleeps. A normal handoff synchronizes pending actions first, then changes the scorer generation. A superadmin can explicitly force a takeover when necessary; the old device's later pending actions then require review and cannot silently append. Preserve those pending actions for recovery rather than declaring them synchronized.

An expired login, network timeout, or server failure preserves entered text. If local storage fails, do not falsely announce a saved turn: keep the draft visible and require a successful server save or recovery action before advancing. Browser storage may be evicted; it is not the only copy of family history. [MDN storage persistence and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Offline normal ending can be prepared locally but is labelled awaiting sync until validated and finalized on the server. Assisted finishing, invitations, role changes, final-history amendments, and scorer transfers require connectivity in the initial release. Do not depend on iOS background sync or a sleeping browser to finish an assistance run.

App updates must not force-reload during entry. Version cached assets and keep active-game rules available. A deployment that cannot safely process an older active game's engine or command version must leave it readable and preserve its pending actions, rather than silently running it under new rules. Test resume across a deployment before family launch.

## 10. Backups, operations, and privacy

Use separate development/test data and production family data. Preview deployments must not write to the production database. Store secrets outside source control and browser bundles. Logs should identify command/game revision and failure category without printing login tokens, invitation codes, raw rack input, or unnecessary personal information.

Before real family history is relied upon, choose and verify a backup policy. Proposed baseline: managed database backups plus an automated encrypted daily export kept outside the hosting account, with an owner-readable restore procedure. A daily independent copy implies up to a day's exposure in that recovery path; select point-in-time recovery if a tighter loss window is required. Set an explicit recovery target after measuring a restore, not by assumption.

Restore into an isolated environment and verify row counts, event ordering, representative replays, results, membership, runtime permissions, and record totals. A backup job's success message is not sufficient. Supabase notes that database backups do not contain Storage object contents; any uploaded media or retained assets need their own recovery coverage. [Supabase backups](https://supabase.com/docs/guides/platform/backups).

Keep production account ownership and recovery credentials under Doug's control. Document who can deploy, migrate, restore, and grant app access; app superadmin access does not automatically confer database-owner access. Record migration and deployment versions, and preserve a rollback path that does not erase newly written games.

Monitor failed turn submissions, persistent sync conflicts, solver failures, authentication delivery failures, and stale/missing backups. Prefer bounded operational alerts over collecting family gameplay telemetry. No advertising, public profiles, or unrelated tracking is needed for this private app.

## 11. Build sequence and completion gates

Build in the verified source directory. Each phase produces a reviewable increment and passes the relevant checks before the next phase relies on it. The first playable milestone is not the completed app; assisted finishing and permanent shared records remain part of the full commitment.

| Phase | Concrete work | Exit evidence |
| --- | --- | --- |
| **0 — Resolve dependencies and prove the difficult interactions** | Record D1–D8 defaults/decisions; confirm word-data permission and coverage; select the exact household preset; prototype phone board entry with Space/Blank and open keyboard; evaluate solver licence, packaging, complete move search, and timing on difficult boards. | Written decision record, permitted lexicon path, independently scored fixtures, observed iPhone/iPad entry behaviour, and a solver integration decision. No “official” checker claim without the data gate. |
| **1 — Rules engine** | Board/tile model, legal placements, blank identity, all-word discovery, scoring, pass/exchange, inventory, rounds, endings, result classification, and metric eligibility functions. | Golden score fixtures, generated invariant tests, and independent comparisons pass, including failure cases. |
| **2 — Durable shared foundation** | Repository/CI, SQL migrations, Auth, private membership, Doug bootstrap, players, journal, projections, idempotent commands, authorization, and no-erasure permissions. | Two-account access tests, direct API permission tests, concurrent-command tests, and replay-from-journal tests pass. |
| **3 — Complete human scoring flow** | Home/setup, seating/order, board input, blanks, live leaderboard, collapsible panel, rounds, All Letters, pass/exchange, end review, pause/resume, basic game history. | A complete physical two-player and four-player game can be recorded and independently reconciled from start to final adjustments. |
| **4 — Family history and records** | Player profiles, search, replay, eligibility-aware achievements, normal/early/assisted categories, sharing, annotations, live corrections, and final amendments. | Every record resolves to evidence; amendment tests preserve original history and replace effective statistics exactly once. |
| **5 — Reliable devices and recovery** | Installable app shell, offline queue, draft recovery, sync status, single-scorer handoff, session recovery, service-worker updates, backup export/restore, and accessibility refinement. | Physical iPhone/iPad sleep, refresh, offline, reconnect, two-tab, takeover, and deployment-resume scenarios pass. Restore drill succeeds. |
| **6 — Assisted finish** | Rack-entry flow, immutable assistance boundary, solver adapter, suggestions, sequential generation, persisted progress, pause/resume/playback, blocked finish, final review, and record exclusions. | Complete no-draw runs on 2/3/4-player fixtures plus Solo category checks; every move independently validates; retries never duplicate steps; no assisted metric leakage. |
| **7 — Family acceptance and release** | Integrated regression, security/permissions checks, production configuration, sample-data separation, owner review, and private family pilot. | All release-blocking checks pass; real-device evidence and remaining limitations are recorded; owner authorizes the concrete production release. |

The critical dependency chain is **word/rule decisions → deterministic engine → durable game commands → complete human game → recovery and assisted integration → family release**. A solver runtime problem discovered in Phase 0 can change its adapter/hosting choice before the rest of the UI is built. Do not defer that uncertainty until the last week of an invented schedule.

Estimate calendar time and service costs after Phase 0 yields actual licensing, packaging, and device-input evidence. Avoid promising a fixed launch date or zero-cost lifetime hosting while those dependencies are unresolved.

## 12. Validation strategy and definition of done

The detailed [acceptance checklist](/path/to/local/Documents/Codex/2026-09-13/let/outputs/scrabble-scorer-acceptance-checklist.md) is the release companion to this plan. Its checks are planned, not already passed.

Use unit tests for pure rules; independently calculated examples for arithmetic; generated legal-position invariants for inventory and replay; database integration tests for atomicity, access, and history; and browser tests for end-to-end user flows. Use a second trusted calculation/source where appropriate—calling the same scoring function twice is not independent verification.

Prioritize failures that can corrupt a game: a duplicate turn, a missing crossword, a blank counted as a real letter, an incorrect leftover transfer, a stale device overwriting play, a correction losing later history, or assistance entering human records. Then verify practical touch behaviour, accessibility, readable error messages, and performance.

Suggested performance targets to measure, not claims already established: responsive board feedback within roughly 100 ms on the agreed test phone, ordinary local draft validation within 200 ms after assets are ready, visible save feedback immediately, and normal synchronized commands usually completing within two seconds on a healthy connection. Measure solver cold/warm timings in Phase 0; choose a bounded timeout and honest progress state from the results.

Family release requires:

- Every required screen and flow above works with 1–4 players in its appropriate category.
- Normal scores, rounds, tile counts, and end results reconcile with independent fixtures and real physical games.
- Every accepted action survives refresh and has a truthful local/server save status.
- Attempts to delete historical data fail for all app roles; corrections retain their predecessors.
- Assisted moves and outcomes pass the full exclusion matrix, including shared cards and amended history.
- Unauthorized users cannot read family records or mutate games, and revoked access is enforced on the next server request.
- Real iPhone and iPad tests cover the software keyboard, installation, sleep/wake, interruption, offline resume, and handoff. Desktop emulation is not reported as physical-device proof.
- Backup restoration, migration compatibility, and rollback handling are demonstrated without modifying real history during tests.
- Type checks, lint, meaningful automated tests, and production build checks pass; known unresolved defects are documented with impact.
- The selected dictionary and solver have documented permitted use; production credentials and data are separate from previews.

Native App Store packaging, camera/OCR input, online opponents, regular-play move coaching, tournament challenge mode, additional languages/tile sets, and public family profiles are not part of this first complete release. Add them only through a later explicit scope decision.

The implementation should begin with Phase 0 when building is authorized. This document is the detailed plan for that work, not evidence that the app, licensing, infrastructure, tests, or physical-device acceptance already exist.
