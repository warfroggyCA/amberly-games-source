# Scrabble Gym — local build status

September 24, 2026. Local branch `codex/scrabble-gym`, based on `65ddd4a6498752c7fcaae6f763c04a94fa26c4bd`. Implementation is authorized. This is the P1 review build, **not the completed first release**. No production migration, hosted deployment or real family-data change has occurred.

## Try the preview

Run `npm run gym:preview`. The launcher prints the current same-network tablet address. The running session's address is `http://192.168.2.22:4321/gym-lab`; addresses can change when the Mac reconnects. Keep the Mac awake, the process running, and the iPad on the same network. `GYM_PREVIEW_PORT` can override port 4321.

The launcher binds the development server to the LAN, enables the lab explicitly and disables hosted account/storage connections. The route returns 404 without `AMBERLY_GYM_LAB_ENABLED=true`. LAN development assets are allowed only for the Mac's discovered IPv4 addresses. This is a trusted-network development preview, not a public hosting setup.

Results are not saved; refresh clears the puzzle. Browser layout/touch-path coverage does not establish physical iPad acceptance.

## Implemented

- Fresh seeded random legal play from the full physical tile bag, with replay validation, public setup history, seven human tiles and one simulated opponent. No preset puzzle bank.
- Complete immediate-score enumeration, tied score ranks, percentage of maximum and all maximum placements counted. Rack ownership, repeated letters and blanks are checked.
- Combined practice welcome screen, How to play, animated setup with Skip/reduced motion, tap-to-start and repeat-tap direction toggle, advancing tap/flick placement, drag adjustments, blank assignment, Undo and Return all.
- Progressive score clues, Solve and return-to-draft, exact score submission, next random puzzle and cancellable worker requests.
- Shared main-game tabletop background, typography, paper surfaces and board/tile tokens. The approved transparent Scarlett v7 lifting animation appears on the welcome screen, practice companion and Gym entry card. Pause/reduced motion selects an unaltered still frame.
- Experimental strategy sampling with unseen-tile allocation, candidate screening, full-game continuations, paired verification samples and explicit uncertainty. An incomplete comparison returns unavailable rather than a fabricated grade.

## Feasibility evidence

Node 24.18.0 on the development Mac; reference `amberly-family-v1-2121ea84c411`. These are desktop measurements, not phone measurements. The first timed generation includes lazy preparation encountered by that operation, but does not measure network download or complete browser cold launch.

| Measurement                                                | Result                                             |
| ---------------------------------------------------------- | -------------------------------------------------- |
| Fresh generation, legal replay and exact score enumeration | 100/100 completed                                  |
| Generation median / nearest-rank p95 / maximum             | 128 ms / 421 ms / 766 ms                           |
| First measured strategy comparison                         | Unavailable at 15.01 s; 31 completed continuations |
| Follow-up strategy sample                                  | 0/5 comparisons completed within 15 s              |
| Follow-up continuations completed before timeout           | 4, 37, 27, 22, 59                                  |

Raw seed-level evidence: [100-puzzle generation run](benchmarks/gym-generation-2026-09-24.json) and [20-puzzle / five-strategy follow-up](benchmarks/gym-strategy-2026-09-24.json). The second run overlapped the full browser regression suite and experienced CPU contention; its latency is not a clean comparison with the first run. Its first strategy seed repeats the original case. These six attempts therefore cover five distinct strategy positions, not six. No completed comparison was dropped from the report.

**P1 decision: strategy feasibility has not passed.** The current full-continuation policy performs exhaustive move search at every simulated turn. It cannot yet support the proposed foreground budget, and its small default verification sample would yield broad uncertainty even when completed. No calibrated strategic grade, win-probability claim or score-versus-strategy quality claim is justified by this run.

The next engine experiment should profile repeated move enumeration and compare a compact word-graph adapter with the current implementation, using this exact custom reference and family exchange/end/tie rules. Benchmark both throughput and recommendation stability before selecting an adapter or changing computation location. An external engine's documentation alone does not establish browser speed, licensing compatibility of its data files or rule compatibility. No new package, lexicon or paid compute service has been adopted. As the release plan specifies, resolve this before expanding the production UI.

Reproduce the baseline with:

```sh
SCRABBLE_GYM_BENCHMARK=true npx vitest run tests/gym-benchmark.test.ts
```

`SCRABBLE_GYM_BENCHMARK_COUNT`, `SCRABBLE_GYM_STRATEGY_CASES` and `SCRABBLE_GYM_BENCHMARK_REPORT` control size, sampled comparisons and report destination. Reports retain failures. The normal suite skips this resource-intensive benchmark.

## Verification

- Full `npm run check` passed: lint, type checking, 875 unit tests, 87 disposable-database tests, production build, 258 browser tests and one integrated family-account/browser/database flow.
- Normal unit run skipped 88 cases (87 database cases run separately, plus the opt-in benchmark). Browser suite skipped six existing conditional cases.
- Eight focused Gym browser cases passed across desktop Chromium, iPhone WebKit, iPad WebKit and iPhone landscape, including playing the displayed solution and obtaining maximum score. A final run also checks all 225 cells remain square.
- LAN browser hydration and interactions verified through the actual network address; iPad-sized welcome and board visually inspected. Physical iPad/iPhone checks, sustained-session battery/heat measurements and target-device latency remain unverified.
- No production database was used. Existing family-game regression coverage passed. Automated secret preflight covers tracked files; new source was separately inspected and contains no credentials.

## Still required for the first release

Useful and calibrated strategy coaching; production puzzle/reference identities and worker protocol; profile-linked durable history and cross-device sync; draft recovery and retry/outbox behavior; online playable-word lookup and shared verified additions with current-puzzle recalculation; exchange/pass controls; strategy-specific hints and explanations; the final Scarlett animation; server verification, authorization/storage migrations and recovery checks; and complete physical-device/release verification. The lab's focus choice and experimental button do not complete these requirements.

## First feedback pass — September 24

- Revealed hints now accumulate in an ordered list. Optional board guidance draws an arrow and dashed outline on a valid placement square for the same highest-scoring move; the label clarifies that this need not be the word's start. The pointer neither places tiles nor changes the draft. Next puzzle clears all clue state.
- The active board uses viewport height to keep rack controls nearby, with separate feedback on desktop and a stacked layout on narrow screens. Undo, Return all and Reorder rack use icons with accessible names and tooltips. Scroll remains available rather than clipping content on short screens.
- Strategy coaching now has an expandable explanation of its purpose and current limits before an explicitly experimental action. Failure copy preserves and distinguishes exact score feedback. This is a UX improvement, not a strategy performance fix.
- Scarlett remains in the practice view, with simple cutout bob/tilt/reaction animation, a pause control and reduced-motion support. On narrow screens she occupies a reserved footer dock. Independent eye/limb character animation remains future work.
- Verified with focused browser coverage for accumulating hints, pointer/no-draft-mutation, next-puzzle reset, accessible rack actions, hidden-by-default strategy controls, simulated worker-limit recovery preserving score/tiles, desktop viewport fit and animation pause. Desktop, iPad portrait and narrow-phone layouts were visually inspected; physical-device acceptance remains outstanding.

## Second feedback pass — September 24

- Tiles now have a pointer-following preview from pickup through drop, including rack blanks and moved draft letters. Cancellation/invalid drops remove the preview and preserve tile ownership. Placement instructions explicitly mention dragging.
- Gym reuses the main scorer's direction inference, with a starting-edge fallback when continuation is impossible. Repeated square taps and the direction button set a manual override. Existing draft lines stop at an edge rather than bending.
- Shuffle uses Fisher-Yates over physical rack IDs, preserves drafts and checked scores, and animates tiles from their old positions to the new slots. Reduced motion skips that animation. The control uses crossing shuffle arrows. A valid random permutation can occasionally match its previous order.
- A separate reusable worker checks live move validity against the pinned reference after short input debounce. New drafts invalidate old replies; failed/slow checks report unavailable. This covers all formed words and placement legality, but does not trigger ranking or strategy simulation on each tile.
- A labelled score meter compares the checked move's points with the maximum. Solve offers up to three highest-scoring placements, one at a time, with gold/silver/bronze tiles, explicit option numbers, scores and tie labels. These are placement options, not three guaranteed distinct score levels or strategic rankings.
- Type checking, lint, formatting and build passed. All 878 unit tests passed (88 expected skips), and 13 focused browser cases passed across desktop, iPhone, iPad and landscape (three desktop-only cases skipped on other devices). Visual inspection confirmed alternative solution highlights and live validity. Physical touch/drag acceptance remains to be tried on the user's iPad.
- Scarlett's custom weightlifting animation and further visual polish remain deferred. A separate asset-development thread was recommended; none was created.

## Third feedback pass — September 24, 2026

The authorized local-preview updates are implemented:

- Setup tiles animate over normal empty board squares; no brown reserved destinations appear before arrival.
- Rack shuffle retains physical tile identity and true random ordering, with a raised, tilted lift and settle animation plus more dimensional tile shading. Reduced motion skips the animation.
- A live badge sits beside the placed word: green check and points for valid moves, red cross and explicit invalid wording otherwise. Invalid dictionary words can show potential points; structurally invalid placements receive no invented score.
- Undo restores the previous completed edit, including tile relocation, Return all and rack shuffle. Mere square selection does not add an undo step. Dragging hides the source tile copy; invalid/cancelled drops restore it.
- Back to Gym returns to the welcome screen, with a keep-practising/discard choice for active work. One combined practice mode replaces the earlier Score/Strategy selector. Exact score evaluation is working; strategy coaching remains an optional experimental comparison and has not passed its feasibility gate.

Verification: production build, type checking and lint passed; 878 unit tests passed (88 conditional cases skipped); 15 focused browser cases passed across desktop Chromium, iPhone/iPad WebKit and iPhone landscape (nine desktop-only combinations intentionally skipped). Added regression coverage verifies moved-tile Undo, Return all/shuffle reversal, safe leaving/restarting, hidden drag sources, empty intro destinations and actual lift keyframes. The animation assertion waits for its scheduled frame rather than inspecting before it starts. LAN preview visually verified with both green valid and red invalid point badges. Physical iPad acceptance remains separate. No deployment, hosted data change or Scarlett asset integration was performed in this pass.

## Fourth feedback pass — September 24, 2026

Implemented empty used rack slots (no dots), a lighter wood rack, and independent valid/invalid letter colouring for all contiguous words touched by the draft. Fixed letters participating in those words are included; untouched setup words and singleton tiles remain neutral. Mixed crossings use split green/red letter ink and explicit per-word text/accessibility labels. Move legality and the existing live point badge remain separate. The badge sits beyond the horizontal word so it does not obscure those letters.

Setup tiles now arrive with independently scattered timing, horizontal travel and rotation, stable within each generated puzzle. The board remounts for each new puzzle; Skip animation and reduced motion still settle immediately. iPad-sized visual inspection exposed temporary scrollbars from the flying tiles; clipping the intro prevents those changing the board's scroll extents.

Verification: 882 unit tests passed (88 conditional cases skipped), including ARE/NEM, conflicting crossings, blanks, isolated fragments, dictionary failure and malformed placements. All 15 focused browser cases passed (nine desktop-only combinations skipped), including real live word colours, blank used slots, independent flight timing/path, initial/next intro and no intro scrollbars. Type checking, lint, production build and formatting passed. Desktop and iPad-sized LAN visual checks covered the lighter rack, mixed valid/invalid words and the unobscured badge. Physical-device acceptance remains unverified.

The spec records original scoring-game candidates for separate review and connected 1–5 reps as a future feature. Neither was implemented here. No Scarlett asset integration, deployment or hosted data change was performed.

## Fifth feedback pass — September 24, 2026

Touch pickup enlarges the carried tile to at least 64px (or 115% of its source width) and lifts its bottom edge above the finger. Rack tiles now maintain a square aspect ratio at desktop, phone and tablet widths. Desktop board sizing reserves enough vertical room for the square rack and controls.

Pulling a placed tile off the board returns it to the rack, including drops on the rack itself. Only rack-origin gestures may use the quick upward flick-to-cursor shortcut. Invalid occupied-board drops and cancelled gestures retain the tile; returns remain undoable. Native Chromium touch injection verifies the raised ghost and off-board return; mouse tests verify a direct rack return. Physical iPad acceptance remains outstanding.

Structural placement errors show “Invalid placement” without points. New draft tiles continuously wiggle and retain a dashed warning outline until the arrangement is corrected; fixed tiles never wiggle. Reduced motion suppresses animation while preserving the outline. Individual dictionary words keep their green/red verdicts independently. Mixed crossing colours have a short on-screen explanation. No strategy, profile, shared dictionary or original scoring-game behavior was changed.

Validation: production build, type checking, lint and formatting passed. Seventeen focused Gym browser cases passed, with fifteen intentional desktop-only combinations skipped. Coverage includes square rack geometry across all four viewport projects, native touch pickup/return, direct rack return, Undo, infinite warning animation and reduced-motion fallback, and disappearance of placement warnings on valid solutions. Desktop and iPad-sized visual checks completed; no full database suite was rerun for this UI-only pass.

## Sixth feedback pass — September 24, 2026

Live scoring strength now shows rising bars beside a legal draft's points. Maximum-scoring moves, including ties, get five bars, a brief sparkle and a lasting star. Expandable feedback gives competition rank among every legal placement, ties, total placement count and percentage of maximum. Checked ranks use the same placement-count semantics; the earlier distinct-score rank has been superseded. Strategy strength remains unavailable rather than receiving an invented rating.

Mixed-colour letters carry the valid word direction and flip their diagonal treatment accordingly. Settings offers live coaching (default on) and reduced motion (default off), both for the current visit. Gym's explicit setting controls setup, companion, shuffle, warning and sparkle animation. The global OS-motion rule now excludes Gym descendants; other game screens retain their prior behavior.

Validation: 885 unit tests passed (88 conditional cases skipped), including score tie/rank/bars and valid-down crossings. All 17 focused browser cases passed (15 desktop-only combinations skipped), including maximum indicators, detailed rank, coaching toggle, explicit motion setting and continued animation under an OS reduced-motion preference. Build, type checking, lint and formatting passed. Desktop and iPad-sized LAN visual checks showed the maximum indicator and expanded details. Physical-device acceptance remains outstanding; no deployment or hosted data changes.

## Seventh feedback pass — September 24, 2026

Return all clears the start, cursor and manual direction override as well as the placed tiles; Undo restores the previous draft. Selecting a different square or dragging to a new location releases a stale direction override. The TENANTS-to-SKY regression now infers down from the new tiles and advances below Y.

The family chooser has a feature-gated Gym entry beside Scrabble and Crokinole. The isolated preview offers the matching launcher at `/gym-lab/games`, with hosted family services still disconnected. Back to games returns to the originating chooser. The original `/` scorer route is unchanged.

Approved Scarlett v7 is copied byte-for-byte to `public/gym/scarlett-lift.webp` and used on the welcome screen, companion and entry card. SHA-256 matches the source: `e7c75308723411072bd3f08e82fba6232c7a5cb296b17eea7fdc62a7f085e22e`. Pause and explicit Gym reduced motion use an unaltered extracted frame. Synthetic companion transforms are disabled; source art and the approved loop are unchanged.

Validation: 886 unit tests passed (88 conditional skips); 101 browser cases passed (15 intentional desktop-only combinations skipped), covering Gym, family access and Crokinole navigation across desktop Chromium, iPhone/iPad WebKit and landscape. Type checking, production build, application lint and formatting passed. Repository-wide lint reports six pre-existing CommonJS-import errors in independently authored `art/scarlett/v5`, `v6` and `v7` packaging scripts; those files were left untouched. An initial browser run used the previous production build and was discarded; the 101-pass result is from the freshly rebuilt application. LAN visual inspection verified chooser layout, animated Scarlett, pause/resume and clearing the start indicator. Physical iPad acceptance remains separate. No deployment or hosted data changes.

The active header now says **Back to Games** and returns directly to the chooser. Keep practising preserves the draft; Leave practice confirms navigation. Production build and focused lint passed; nine navigation browser cases passed (three intentional skips).

## Sampled strategy coaching — September 24, 2026

The foreground strategy worker now uses `sampled-reply-rack-v1`: immediate points minus a sampled opponent reply, plus the heuristic rack-value difference after draws. Each candidate gets four common discovery worlds. The selected option and actual user move get twelve fresh paired verification worlds. Candidates include score leaders, rack-preserving plays, legal exchange subsets selected by the existing shortlist, pass and the actual submission. Every search must complete; timeout/cancellation does not silently omit a difficult sample. Whole-game continuations remain in `strategy.ts` as a research baseline.

The review panel displays exact points and retained tiles, average opponent reply, compared words/coordinates, shortlist coverage and an explicit uncertain verdict where fresh samples disagree. Numerical estimates, observed ranges and methodology are expandable. These are not winning odds, confidence intervals, exact strategy ranks or calibrated player grades. Score-dependent risk and endgame tactics remain outside this midgame evaluator; at least fourteen bag tiles and zero consecutive passes are required. Thus the original expected-game-result quality gate remains unresolved; this is a usable, separately labelled coaching preview.

[100-position sampled-coaching benchmark](benchmarks/gym-coaching-2026-09-24.json): all 100 randomly generated positions and comparisons completed within their 15-second engine budgets. Warm core comparison median 1.60 seconds, nearest-rank p95 6.11 seconds, maximum 11.10 seconds on Node 24 on the development Mac. Requested moves were the immediate-score leader in each position; this is not an arbitrary-move or phone-latency benchmark. Normal development and one live browser check occurred during the run, but no concurrent bulk test suite. The chosen alternative scored fewer immediate points in 47 cases; 53 comparisons were uncertain, 46 retained the requested move, and one alternative was stronger in all fresh samples. These counts demonstrate behavior, not strategic accuracy. Ten small rack/cross fixtures separately cover blanks, repeated letters, vowel/consonant imbalance, exchanges and pass.

A small solver optimization skips perpendicular checks when neither the required physical letter nor a blank is available. The existing independent exhaustive solver tests remain the correctness reference. No new dependencies, hosted computation, database change, profile persistence or deployment were introduced.

Validation for this pass: 889 unit tests passed (89 conditional skips), including existing solver completeness/oracle tests and new coaching checks. Type checking, application-source lint, formatting and production build passed. The Gym browser suite completed 27 cases with two new-test assertion failures and 15 intentional skips; those assertions incorrectly included an asynchronously updating score badge in the draft comparison. After comparing tile coordinates/content instead, all four real-worker coaching cases passed across desktop Chromium, iPhone/iPad WebKit and landscape. This covers 29 distinct passing Gym browser cases overall, including timeout preservation, cancellation/retry, completed feedback and invalidation after editing. Desktop and narrow-screen visual inspection verified a completed THANE/THINE comparison and readable side-by-side trade-offs. These browser projects run on the Mac; physical iPad/phone performance and strategic-strength acceptance remain unverified.

## Live medal feedback — September 24, 2026

Legal live moves now receive a gold, silver or bronze tile rim and score-badge medal for the top three distinct score levels. New tiles shimmer briefly; their validity ink is preserved. Ties share the same medal, independent of competition rank. Pending/invalid drafts and hidden live coaching suppress medals, and reduced motion suppresses shimmer. Solve stores and displays one representative per medal score, preserving score histogram/counts and the original strategy shortlist.

Validation: 890 unit tests passed (89 conditional skips), 29 Gym browser cases passed (15 intentional skips), and type checking, application lint, production build and changed-file formatting passed. Added tests verify tier/rank separation, representative scores against the exhaustive histogram, live gold rims and disabling medals with coaching. A live THANE move was visually checked with gold rims and green letters. Physical-device acceptance remains separate; no deployment or hosted changes.

## Browser-injected root hydration attribute — September 24

The reported mismatch was `__gcrremoteframetoken` on `<html>`. The server response and app source contain no such attribute. The static root now uses React's scoped `suppressHydrationWarning`; application descendants retain diagnostics. Development-browser regressions inject the reported root attribute before hydration and confirm usable controls without a hydration error, then inject an unexpected body attribute and confirm the warning remains active. Both tests passed. Run `npx playwright test --config=playwright.hydration.config.ts`; this uses/reuses the isolated local Gym preview through `localhost:4321`. The normal production suite skips these development-only diagnostics.


## Solve lock and feedback cleanup — September 24, 2026

Solve now locks draft edits, undo and rack controls independently of the solution overlay. My move restores the user's view without unlocking it. Return all remains available even for an empty entry, clears the draft and cursor, and unlocks editing. Revealed hints remain recorded for the puzzle. Next puzzle resets the lock.

Scarlett shares a compact feedback heading; the status chatter and inline Pause button are removed. Animate Scarlett is in Settings. Checked scores precede supporting validity details; coaching and hints are grouped. Strategy analysis displays Thinking with an indeterminate activity bar and Cancel, preserving the existing timeout and draft recovery. Sample and shortlist counts live in the expandable explanation of completed results.

Validation: production build, type checking, focused lint and changed-file formatting passed. All 29 Gym browser cases passed across desktop Chromium and iPhone/iPad WebKit (15 intentional desktop-only combinations skipped), including Solve/My move locking, Return all unlocking, Settings animation control, strategy activity and cancellation. LAN preview was visually inspected; physical iPad acceptance remains separate. A final CSS-only correction supplied the lock notice's border colour explicitly. No deployment or hosted data changes.


## My move correction, open rack and brighter medals — September 24

Supersedes the preceding persistent Solve lock: My move immediately unlocks editing and restores any existing draft; assistance remains at hint level 3. Return all still clears the draft and cursor. Removed the separate lock state to keep editing tied directly to the visible solution. Used rack slots and drag sources are transparent without borders or inset shadows, exposing the continuous wooden ledge. Tiles retain predictable tap targets. Medal rims now have brighter layered highlights and a broader 1.8-second glimmer, with a white silver highlight; validity ink and explicit reduced-motion behavior remain.

Validation: build, type checking, focused lint and formatting passed. Browser suite: 28 passed, 15 intentionally skipped, one iPad strategy completion timed out; that unchanged strategy case passed in isolation (7.9 seconds). New regressions verify immediate unlock for empty and existing drafts, draft preservation, retained hint assistance and bare rack gaps. LAN visual review confirmed silver rims and editable My move. Physical-device acceptance is separate; no deployment or hosted data changes.


## Profile history development — September 24, 2026

Implemented behind `AMBERLY_GYM_HISTORY_ENABLED=true` for the signed-in Games entry (`/gym-lab?from=family`). The ordinary `/gym-lab` LAN lab remains unsaved and isolated from hosted credentials. This is local implementation, not a deployed capability.

- New `/api/family/gym` uses the existing verified identity, request-account header, same-origin/body limits and private responses. Ownership is resolved from the active membership's linked player for every request. Reads and append-only writes use the restricted runtime role and own-player RLS; superadmins do not receive other profiles' Gym history.
- CLI-generated additive migration `20260924214100_gym_profile_history.sql` creates immutable session snapshots plus ordered event journals, indexes and limited grants. Snapshot-per-session is used initially instead of a separate deduplicated puzzle table; fingerprints detect repeated public positions independently of seed/rack order. No historical game tables or schema-v2 marker changes.
- Server verifies the legal generation trace, reference, rack ownership and move points. Attempts preserve first-attempt status and assistance at that time; later hints cannot rewrite earlier attempts. Score ranks/percentages and sampled strategy feedback are explicitly browser-calculated, not server-certified rankings or winning probabilities. There is no independent-success aggregate based on ambiguous offline encounter order.
- IndexedDB retains pending events before upload, with account/family/player partitioning. Identical retries receive the original logical receipt, conflicting IDs and sequence gaps are rejected. Events only leave the queue after matching receipts. Reconnection, focus and bounded retry backoff resume saves; changed accounts/profiles pause the original queue. Local storage failure is visible, not labelled saved.
- My practice history offers bounded cursor pages and read-only original board/rack, attempts, hints, Solve, live coaching and completed strategy summaries. Tile drafts themselves do not sync or resume across devices. Shared word lookup remains a separate outstanding feature.

Rollout remains gated: review the migration and exact application revision, run the controlled release procedure, then explicitly authorize the hosted migration and deployment. Keep the history flag off until the matching migration exists. Rollback disables the feature flag and retains both Gym tables and all history. No hosted commands or real practice records were written during development.

Validation for the profile-history checkpoint: full unit run passed 892 tests (93 conditional skips); four focused API/outbox tests passed after the final sync refinements. Disposable PostgreSQL suite passed 92 tests, including migration replay through the manifest, owner isolation, conflict/idempotency, generation/score validation, immutable grants, pagination and relinking. The combined Gym browser run passed 33 cases (15 intentional skips); the final expanded history/LAN suite passed all eight cases across desktop, iPhone/iPad WebKit and landscape. Browser cross-client history uses a controlled API fixture; independent-client persistence/ownership uses real disposable PostgreSQL. This does not claim a hosted sign-in-to-database or physical-device sync acceptance. Build, application lint, types, formatting and tracked-file credential preflight passed. Reviewed desktop and phone history screenshots. No hosted changes.


## Release candidate verification — September 24, 2026

The isolated `codex/gym-history-release` candidate passed Node 24 lint, type checking, formatting and production build; 894 unit tests passed (94 conditional skips), 92 disposable PostgreSQL tests passed, 287 production-browser cases passed (29 intentional skips), and the integrated identity/profile/scoring/history/permission journey passed. The integrated auth provider is a local fixture, not hosted Supabase. Staged-file credential scanning passed for 402 files.

The first full browser run had one iPad strategy-success timeout on a random position (286 passed). The success-path test now uses a reproducible generated position with the real worker; the complete browser rerun passed. Random generation and timeout/cancellation preservation remain separate tests. This does not establish that every random strategy comparison completes on every device. A sync-status refinement also prevents reporting Saved to profile while additional queued events remain.

Current hosted migration history was inspected read-only and does not include Gym history. Protected GitHub Verify, owner-approved hosted backup/restore, migration, deployment and physical-device/cross-device acceptance remain distinct rollout steps. The existing LAN preview still responds at port 4321 and remains unsaved standalone practice.


## Touch landing preview — September 24, 2026

Dragging now outlines the precise destination cell and shows its coordinate above the lifted tile, clear of the finger. Occupied cells use a red cross and Occupied label. Preview and release share the pointer hit-test; dropping, leaving the board and cancelling clear the preview. This indicates placement space, not whole-move or word validity.

Type checking, focused lint, production build and five drag/drop browser cases passed (three native-touch cases intentionally skipped outside Chromium). Native touch injection covers blocked-to-empty preview transitions, exact-coordinate release, return to rack and undo. The rendered preview screenshot was inspected. Physical iPad acceptance remains with the owner.
