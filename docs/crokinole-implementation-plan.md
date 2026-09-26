# Amberly Games: shared hub and Crokinole implementation plan

Status: approved planning baseline, now implemented locally on `codex/crokinole-shared-hub`. See `crokinole-gauntlet.md` for final evidence and documented implementation adjustments. No hosted migration or deployment has been applied.

Source inspected: `/Volumes/X10 Pro/Coding Projects/Scrabble scorer`, branch `polish-watch-sharing`, commit `8a1bfdb8941d7729d4013617284381180882f596`. The working tree was clean when inspected. Recheck the branch, current instructions and live schema before implementation; this is a source review, not verification of the hosted database.

**1. Intended outcome and authority**

Amberly becomes one shared family scoring hub. Scrabble and Crokinole use the same accounts, invitations, permissions, player roster and history entry point. Each game has its own scoring rules and presentation. Playing Crokinole does not replace, convert or reset a Scrabble session.

The user's Crokinole proposal remains the functional baseline except for the explicit adaptations below. The approved screen concepts establish direction, not pixel-perfect specifications or a replacement brand system. Use the actual Amberly wordmark and controls rather than generated approximations.

| Proposal assumption | Amberly implementation decision |
| --- | --- |
| Device-only persistence; no backend | Use the existing shared backend. Preserve drafts locally and synchronize them for the scorer. |
| Separate player name fields | Select existing shared player profiles. Offer the existing Add Player flow only when permitted. |
| Locally customized colour palette | Shared Crokinole equipment palette, controlled by the existing equipment permission. |
| Replace an unfinished active match | Preserve every match. Confirm starting another and retain the previous match as resumable. |
| Alternating starting side in doubles | Track the actual starting player, rotating clockwise through all four seats; scores still belong to teams. |
| Replace saved rounds or results | Append correction events and derive the current result; preserve previous entries and results as evidence. |
| Completed-match editing | Support explicit Crokinole amendments, including reopening a match. Existing Scrabble finality rules stay intact. |
| Dark-theme requirements | Use Amberly's existing light theme. Ensure accessible contrast; do not introduce a new theme system. |

Included: all proposed two-, three- and four-player formats; the three scoring modes; piece colours; setup; round entry; standings; corrections; completion; rematch; shared history; interruption recovery; existing access controls; optional wake lock.

Excluded: simulated play, per-shot/disc entry, tournament management, ratings, new leaderboards, public accounts, new authentication providers, Crokinole spectator links/live broadcasting, and a general framework for arbitrary future games. Existing Scrabble sharing remains available. Shared member access to saved Crokinole games is included; anonymous viewing is not.

**2. Repository patterns to reuse and boundaries to protect**

| Area | Current implementation | Plan |
| --- | --- | --- |
| Shared entry and sign-in | `/family`, `FamilyApp.tsx`, `FamilyAccess.tsx` | Keep this installed-app entry; introduce the shared hub behind the existing access boundary. |
| Local preview | `/`, `preview-store.ts` | Preserve as a separate development sandbox; never silently upload its games. |
| Installed app | `src/app/manifest.ts`: identity and start URL `/family` | Keep app identity, icons, scope and start URL stable. Update description to cover multiple games. |
| Shared players and access | `shared-contract.ts`, `member-permissions.ts`, PostgreSQL family/player/membership tables | Reuse identities and capability keys. Do not create Crokinole accounts or duplicate profiles. |
| Scrabble | `ScorerApp.tsx`, `domain/game.ts`, `shared-store.ts` | Keep the domain, payloads, journals and record calculations Scrabble-specific. |
| Presentation | `BrandWordmark`, `Modal`, profile controls, `CrownIcon`, buttons, segmented choices, `SwipeToDelete`, theme tokens | Reuse or extract only the portions actually needed by both games. |
| Score sheet | `RoundTable.tsx` depends on Scrabble game state | Reuse visual conventions; implement Crokinole's own data adapter and round display. |
| Shared writes | `shared-repository.ts`: verified actors, family transaction lock, revisions, request IDs, audit | Reuse the narrow transaction/access helpers, with tests around any extraction. |
| Browser drafts | Versioned IndexedDB, retained pending requests, transactional tab ownership | Use the same safety patterns without mixing Crokinole into strict Scrabble draft validators. |
| Tests | Vitest, fake IndexedDB, real PostgreSQL, Playwright Chromium and WebKit | Extend the existing commands and isolated fixtures. |
| Recovery | Whole private `scrabble` schema archive, table-digest restore rehearsal | Include every new table and export projection in recovery verification. |

Proposed routes: `/family` for Games; `/family/scrabble` for the existing scorer; `/family/crokinole/new` for setup; `/family/crokinole/[gameId]` for scoring/results; and `/family/history`, `/family/players`, `/family/settings` for shared destinations. A small family layout hosts access and navigation. Audit existing auth redirects, game URLs and pending-work restoration before moving rendering. Existing `/family` bookmarks remain valid and `/watch` links remain unchanged.

The home screen is the installed-app landing screen. It exposes each game's resumable sessions instead of forcing the app directly into the last scorer. Browser back/forward and reload should preserve the selected game route and retained input.

Keep Scrabble's existing Records page reachable from its game navigation and the shared history context. Adding the hub must not remove records, equipment, concerns or other existing actions. Crokinole version one adds match results and history, not a new rankings system.

Design references: [phone home, standings and entry concept](/Users/dougfindlay/.codex/generated_images/01a09d72-eaef-7bd1-a690-a8eb904bf456/exec-157df8cf-8dee-44a9-9e71-075320981014.png) and [setup and tablet score-sheet concept](/Users/dougfindlay/.codex/generated_images/01a09d72-eaef-7bd1-a690-a8eb904bf456/exec-82251a6e-91f5-4666-8fa9-179de553b01d.png). Generated labels, slogans, wordmark differences and the incorrect starter-disc colour are not implementation requirements.

**3. Product decisions and defaults**

| Setting | Planned behaviour |
| --- | --- |
| Player count | 2 by default on first use; 2, 3 or 4 supported. Remember the scorer's last successful setup preferences. |
| Format | Singles for 2; Family Free-for-All for 3; Doubles by default for 4, with Individual as an alternative. |
| Default scoring | Cumulative Round Totals. First-use match length: 4 rounds, matching the concept. Settings remain changeable before starting. |
| Traditional | Difference awarded to the higher side; target 100 default, 50/150/custom positive multiple of 5. |
| NCA-style points | 2–0 for a win, 1–1 for a tie; fixed 4 rounds or first to 5/7/9/11. Label target formats distinctly. |
| Cumulative | Target 100/200/custom positive multiple of 5, or fixed 4/6/8/custom positive integer rounds. |
| Target ties | Evaluate all participants together after each round. Highest total wins when the target is crossed; equal leaders tie, including NCA-style 5–5. No automatic extra round. |
| Fixed rounds | Play the full configured count, even if a lead cannot be caught. Equal highest totals produce a tied result. |
| Starter | Random individual by default, or a named player selected manually. Random selection occurs once and is persisted, including retries. |
| Doubles seats | Partners sit opposite. Store explicit clockwise seat order, such as Doug, Erin, Nate, Cristine. |
| Rematch | Create a new match, preserve settings and historical snapshots, rotate initial starter one seat clockwise. The previous match stays in history. |
| Leaving play | Returning home keeps the match resumable. An explicit confirmed End Early action retains scores and labels the match unfinished/ended early, without declaring a normal winner. |
| Crown | Only for a sole current leader; hide on a tied Crokinole lead. Do not import Scrabble's unequal-turn tie rule into simultaneous round scoring. |

These are stated implementation defaults, not new claims about official rules. In doubles, clockwise starting-player rotation and the four-round NCA scoring convention are supported by [Tracey Boards' NCA rules explanation](https://traceyboards.com/crokinole-skills-video-series/crokinole-rules-official-national-crokinole-association-rules-by-wcc-board-builder-jeremy-tracey/). Family Free-for-All and cumulative scoring remain explicitly family variants.

**4. Domain and historical data**

Add a `src/domain/crokinole/` module containing types, configuration validation, scoring, projection, commands and colour validation. Calculations are pure and shared by browser previews and authoritative server validation.

Persist an immutable match definition containing game type, schema/rules versions, family and game IDs, mode (confirmed/private test), player IDs plus name snapshots, team assignments, clockwise seat order, starting player ID, scoring mode, end condition and assigned colour snapshots. Profile photos can come from the shared roster with initial fallbacks; do not copy base64 photos into every event.

Keep scoring participants separate from people: player IDs for singles/individual play; match-scoped team IDs for doubles. Starter calculations always return a player ID and can derive the corresponding team. Team labels default to partner names; custom team names are not required in version one.

Commands include create, record round, correct round, undo latest round, pause/resume if used by the shell, end early, and private-test removal. Each saved round has a stable ID and a complete raw-score entry for every scoring participant. Event sequence, actor and server timestamp provide auditability. Round numbers and starters are derived from the effective round order.

The event journal is authoritative. The current head, cumulative totals and result are projections that must be reproducible from the definition and accepted events. A round correction references its stable ID; it never edits an earlier journal row. Match completion is produced in the same transaction as the round/correction that causes it. Old results remain in the journal when an amendment changes or reopens the match.

Validation must reject duplicate/missing/unknown participants, duplicate players, blank trimmed names, invalid teams, unsupported mode/format combinations, duplicate assigned colour IDs, invalid numbers and forged totals. Accept zero, ties and non-negative safe integer multiples of 5. Validate aggregate arithmetic against safe integer overflow. Enforce documented payload/event limits for system safety rather than treating theoretical disc totals as hard scoring limits.

Use 240 as the initial unusually-high-score warning threshold per entered side/player, clearly a confirmation threshold rather than a permitted maximum. A confirmed larger valid total is accepted. Keep that threshold in one named rule constant; do not imply it models every family's disc set. Warn again if an acknowledged value changes.

**5. Shared persistence, API and permissions**

Use additive Crokinole tables in the existing private `scrabble` schema. Retaining this internal schema name avoids an unrelated operational rename and keeps the new data inside the current archive scope.

Proposed tables: `crokinole_definitions`, `crokinole_heads`, `crokinole_events`, `crokinole_participants`, `crokinole_palettes`, `crokinole_drafts`, `crokinole_removals`, and Crokinole concern/resolution tables where required by existing foreign-key boundaries. Reuse family/player/membership tables, audit records and request-id infrastructure. Do not add a mutable result table merely to duplicate a reconstructible projection.

Use composite family/game keys, family/player foreign keys, unique event sequence and command IDs, bounded revision values, and indexes for family history order, participants and scorer resume lists. Definitions/events/removal markers are immutable; heads and scorer drafts use guarded updates. All related writes commit or roll back together.

Add a Crokinole API and store rather than changing the meaning of the existing Scrabble API response. Suggested endpoints: `/api/family/crokinole` for reads/commands, `/api/family/crokinole/draft` for scorer draft synchronization, and `/api/family/games` for small cross-game summaries. Runtime validation rejects unknown or mismatched game types. No browser can submit authoritative match totals, actors or timestamps.

For each mutation: verify account, lock the family using the existing ordering, read fresh active membership/capabilities, verify visibility and designated scorer, validate request ID/fingerprint, lock/check game revision and scorer generation, apply the command with the pure domain, persist journal/head/audit/response, then acknowledge. Identical retries return the original accepted operation with current access restrictions; reused IDs with different payloads fail. A timed-out response is an unknown outcome, not permission to invent a new request ID.

Apply database grants and row policies as well as API checks. New tables stay outside the public Data API; no new browser/service-role access. Check policies for reads, writes, joins, exports and summaries. A shared summary query must not bypass visibility through a privileged view. [Supabase's RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) distinguishes table grants from row policies; both are required here.

| Existing capability | Crokinole use |
| --- | --- |
| Start games + Keep score | Create a confirmed match. |
| Keep score | Enter/correct/undo/end games where that account is designated scorer. |
| Take over scoring + Keep score | Change the designated account with a reason, including taking ownership before a completed-match amendment. |
| Add players / profile permissions | Existing shared roster controls only. |
| Change tile sets (`manageEquipment`) | Relabel to Manage equipment; description covers Scrabble sets and Crokinole colours. Preserve stored capability values. |
| Review game concerns | Existing protest/review model, adapted to Crokinole identities. No mandatory player approvals. |
| Export shared archive | Include permitted Crokinole history and palette. |
| Superadmin | Private test access/removal and existing administration. |

All regular members may view permitted shared history. Only the designated scorer may edit; superadmin status does not silently bypass ownership. Private tests are superadmin-only in every read path, draft path and export. Removal uses the existing swipe/reveal plus confirmation-and-reason interaction and leaves immutable evidence. Confirmed matches cannot be deleted.

**6. Draft recovery, shared saving and device handoff**

Use a dedicated versioned Crokinole IndexedDB workspace with the existing transactional ownership pattern, keyed by family, signed-in account and match. Preserve setup choices, entry text (including blank or temporarily invalid values), add-versus-edit mode, edited round ID, base game revision, scorer generation, pending command envelope and acknowledgment state.

Keep the shared family shell stable while navigating games. Opening a different game should not mount two competing writers. Within the same browser, the current scoring workspace claims ownership and retires the previous tab, preserving pending work. Across devices, scorer authorization remains account-based; conflicting writes are rejected by revisions and guarded draft versions. Do not reintroduce a device-bound scoring lock or a sign-out requirement.

Drafts persist locally after each meaningful change. Validated draft envelopes also synchronize to a scorer-only server record with a separate draft revision and ordered updates. Saving a round checks the applicable draft version and atomically retires that version, preventing a late autosave from resurrecting submitted values. Older responses cannot replace a newer local checkpoint.

On another device, load confirmed state and the last synchronized scorer draft. If local and shared drafts disagree, preserve both and offer a choice; do not silently merge numbers or discard either. Drafts based on older match revisions require review before submission. A new designated scorer does not automatically inherit the previous scorer's private unsent entry.

Display truthful states: Saved; Draft saved on this device; Syncing; Waiting to confirm save; or Couldn't save. A round's official totals and round number advance only after server acknowledgment. If the response is lost after commit, retain the exact request and retry safely. Block another scored command until that outcome is resolved; retained entry stays visible. Handle a local checkpoint failure after server acknowledgment by reconciling with the same request on reload.

Version one supports network interruption recovery and retained draft editing, not a queue of independently committed offline rounds or guaranteed offline cold launch. It must not claim otherwise. If local persistence fails, keep the input visible and warn before deliberate in-app navigation/sign-out; export/retry is available. Browser termination cannot be guaranteed safe after a reported storage failure.

On membership suspension or loss of private-test access, clear protected screen data and stop synchronization. Locally retained recovery data must remain scoped to the account and unavailable through ordinary UI after access revocation; never load one user's draft for another account.

**7. Screens and interactions**

| Screen | Implementation |
| --- | --- |
| Games home | Two game entries with recognizable board art and concise New/Resume actions. If multiple matches exist, show the latest appropriate resume and an In progress list; do not assume one global active match. Games scored by someone else open read-only. |
| Shared navigation | Games, History, Players and Settings outside active play; retain compact in-game navigation. Brand always returns to Games after protecting pending work. |
| Crokinole setup | One screen: player count, conditional format, shared player selection, visible teams/colours, expandable rule/length/starter options, Start. Doubles seat order shown compactly; swaps keep two partners per team. |
| Phone standings | Every player/team and total visible; stable ordering; chronological round comparison; Add Round and Undo within reach. For four individuals, use readable stacked round summaries rather than tiny columns. |
| Tablet/landscape standings | Pinned identity and total columns, horizontally scrollable round columns. Awarded values sum to displayed totals. Selecting any value opens all participants for that round. |
| Round entry | Full-screen sheet on phone, suitably sized dialog/panel on tablet. Name, disc, current total, blank-aware number entry, -5/+5, deliberate Set to 0 and shared Save action. Show preview awards/totals, labelled provisional. |
| Round details/correction | Show raw inputs, awarded points and cumulative result. Edit all participants atomically using the same validation. |
| Completion | Clear winner or tie, colours, final totals, round summary, Rematch, New Game, Games and Edit Rounds. A completion celebration occurs once for a newly accepted result, not on every refresh. |
| Shared history | All / Scrabble / Crokinole filters, participant filter, clear result/status/scorer. Open the appropriate game's details. Label corrected and ended-early matches. |
| Equipment/colours | Named swatches, Add, custom-name/value edit, reorder, hide, restore defaults. Available from setup and shared Settings. |

Blank input remains distinct from 0. +5 from unset enters 5; -5 from unset remains unset. At confirmed 0, -5 cannot make it negative. Direct numeric entry and step buttons share one state. Save requires a complete valid entry for every side. Closing the sheet preserves its draft, with an explicit Discard entry action if needed.

Use disc shape, name and selection checkmark as well as colour. Choose foreground text by measured contrast; very light/dark swatches need contrasting edges. Validate names and hex values rather than accepting arbitrary CSS. Different records with near-identical colours show a non-blocking warning. Hiding or restoring palette entries cannot change an existing match's colour snapshots. Restore Defaults restores the original default records/order while retaining custom records.

Use actual theme tokens and wordmark; no extra promotional slogans, bottles over text, glass blur, or new large decorative board in the scoring workspace. Respect safe areas, keyboard resizing, 44px minimum touch targets, visible focus, native dialog focus behaviour, reduced motion, save/error announcements and long family/team names. Acquire wake lock only while active scoring is visible; release on leaving and tolerate rejection silently. Check current platform documentation when implementing that API.

**8. Corrections and completion integrity**

Undo latest round appends an undo event, recalculates the match and restores the round's values into a new-entry draft. Protect any already-entered next-round draft with a choice instead of overwriting it. Undoing a completing round can reopen the match. Announce the change clearly.

An earlier-round edit first computes a preview. If the corrected match would finish at an earlier round, list the later rounds that would be excluded and ask for confirmation. Save one correction command identifying that excluded tail against the expected revision. Cancel changes nothing. Original round entries remain in the immutable journal, although they no longer contribute to the current result. Apply this rule to every target-based scoring mode.

A completed-match amendment requires the designated scorer, Keep score capability and explicit confirmation with a reason. It may change the winner or return the game to active; history identifies the amendment. Do not amend Scrabble's existing final results through this new code path.

Arbitrary deletion of a middle round is omitted from version one: it is optional in the proposal, and editing plus undo handles the required correction cases with less ambiguity about physical starter order.

**9. Cross-game history, exports and operational compatibility**

Introduce a small discriminated summary type containing game type, ID, timestamps, status, participant snapshots, scorer/access information and game-specific result summary. Do not coerce Crokinole into Scrabble `GameState` or feed its totals into word records.

Read summaries with stable pagination across both game sources, using timestamp, game type and ID as the cursor order. Avoid fetching every journal or issuing a query per displayed match. Keep detailed game loading behind its own adapter. Refresh from the shared source on focus and at the existing reasonable interval while visible; no new realtime service is required for version one.

Extend the existing archive to a documented version two with separate game collections. Keep old archive readers supported. Normal exports continue excluding private tests/internal audit; superadmin export rules stay explicit. Extend restore fixtures and content digests to include completed, corrected, unfinished, private and removed Crokinole matches, shared colours and synchronized drafts. Local unsynced drafts retain their separate recovery export.

No hosted backup schedule, paid service, OAuth change or source/dictionary publication is part of this feature. The existing hosted-backup readiness gap remains an operational fact; a schema rehearsal is not proof of a current hosted backup.

**10. Implementation milestones and completion gates**

| Milestone | Deliverables | Gate before moving on |
| --- | --- | --- |
| 1. Contracts and isolated foundation | Confirm routes, decision table, shared summary type and source baseline; add isolated Crokinole fixtures. Read installed Next.js guides before framework changes. | Scope matches this plan; no existing data conversion required. |
| 2. Scoring engine | Domain validation, raw-round awards, full replay, starters, target/fixed results, corrections, undo, rematch and version rules. | All calculation and malformed-input tests pass independently of UI/storage. |
| 3. Shared persistence and access | Additive migration, Crokinole repository/API, snapshots, palette, journal, request retries, read projections and access policies. | Real PostgreSQL tests prove atomicity, privacy, retry safety and preservation of existing records. |
| 4. Recovery store and first complete flow | Local/shared drafts, uncertain-save recovery, current-tab behaviour, simple setup → enter → save → reload flow. | Duplicate clicks, dropped acknowledgment, two-device conflict and restored edits cannot duplicate or lose accepted rounds. |
| 5. Hub and finished screens | Shared launcher/navigation, existing-player setup, colours, adaptive standings, entry, results, history and equipment integration. | Phone/tablet concepts implemented with real two-, three- and four-participant data; all required controls work. |
| 6. Full corrections and administration | Earlier edits with tail confirmation, completed-result amendments, read-only member views, concerns, private-test removal, permission changes and archive updates. | End-to-end histories and access changes agree with authoritative journal replay. |
| 7. Release candidate | Full suite, diff review, migration/restore rehearsal, device checks and release notes. | Exact candidate passes CI; material limitations documented; no live release implied by local success. |
| 8. Approved release | Verify hosted schema baseline, capture/rehearse an approved current backup, apply additive migration, deploy checked commit, verify shared read paths, enable Crokinole. | Live revision and permissions verified; family release follows physical-device acceptance. |

Implement the scoring/correction semantics in milestone 2 even if their final interface appears later. Build the first successful shared round before spending time on finishing animations or artwork. Keep changes in small reviewable commits with focused regression evidence.

**11. Test and acceptance matrix**

Calculation: traditional 65–40, reversed scores, ties and zero; NCA 2–0/1–1; cumulative singles/doubles/three/four individuals; exact/overshot targets; simultaneous target ties; fixed-round completion; total/visible-award consistency; four-player starter rotation; rematch starter rotation; corrected earlier wins; undo; completed-to-active transition.

Setup/palette: 2/3/4 only; valid teams and opposite seats; shared roster IDs; trimmed names; unsupported combinations; count/format switching leaves no stale assignments/drafts; hidden and restored colours; duplicate record rejection; similar-colour warning; accessible foreground; historical snapshots unchanged by roster/palette edits.

Storage/API/database: missing, extra and forged fields; duplicate IDs; NaN/infinity/fractional/overflow values; database rollback; storage quota/unavailable IndexedDB; corrupt/unknown local schema preserved; local upgrade; lost response after commit; same request replay; mismatched request fingerprint; two clients at the same revision; stale draft autosave; clock skew; failed acknowledgment checkpoint; revoked scorer/member; private-test isolation in every list/direct-ID/draft/export path; cross-family attempts; restored journal/result equality.

Interaction: unset vs deliberate zero; +/- and typing; keyboard entry and close/reopen; full draft restore while editing an old round; newest-round scroll after save without stealing focus during history review; undo with a next-round draft; confirmation cancellation; duplicate tap; current-tab takeover; no device-bound refusal; cross-device draft conflict; rematch preserving configuration; completed games retained; new game preserving unfinished sessions.

End-to-end scenarios: all seven scenarios from the original proposal, plus account-based cross-device continuation, sharing the roster between games, ordinary-member read-only access to another scorer's match, private-test removal/cancel, completed-match amendment/reopen, combined-history pagination, network failure/retry and full Scrabble regression.

Run `npm run check`, `npm run format:check`, `npm run check:secrets`, and the existing exact-commit release check after CI. Use existing Chromium desktop and WebKit phone/tablet/landscape projects. Add normal-motion coverage for any completion animation; existing browser runs use reduced motion. Cover empty, long-name, long-match, keyboard-open, loading, error and permission-denied views.

Physical acceptance on an iPhone and iPad must cover Home Screen launch, portrait/landscape, safe-area clearance, numeric keyboard, background/resume, long match history and scorer handoff. Browser emulation is separately reported, never described as proof of physical-device behaviour.

**12. Rollout and rollback**

Keep the feature behind a server-controlled release flag during integration. The flag does not substitute for permissions. Public UI and server command admission agree on whether new Crokinole games may be created; private fixtures use isolated data. After games exist, disabling creation must not hide their history or erase draft recovery.

Prepare migrations locally with the installed Supabase tooling and current documentation. Verify provider migration history explicitly before any hosted application; local and hosted version names already differ. A normal feature deployment must not perform a blind schema push.

Apply additive tables/policies before the matching application release, with separate explicit approval for hosted changes. Take a reviewed pre-change backup and rehearse recovery; do not create or repair scores in real family matches as a deployment smoke test. Record source commit, migration identity, CI run, deployment ID and verification outcome.

Rollback preserves the schema, journals, drafts and permission protections. After Crokinole records exist, prefer a compatible build that disables new creation/writes but still reads retained data. Do not roll back to an older browser-store format, remove tables, clear device storage, or weaken private-test restrictions to get the app running.

**13. Implementation file map**

| Area | Planned additions / focused edits |
| --- | --- |
| Rules | `src/domain/crokinole/{types,validation,scoring,game,colours}.ts` |
| Shared contracts | `src/lib/crokinole-contract.ts`, `src/lib/game-summary.ts`; preserve existing Scrabble contract shapes |
| Server | `src/server/crokinole-repository.ts`, summary repository; narrow extracted family transaction/access helpers if needed |
| Client persistence | `src/lib/crokinole-store.ts`, versioned local workspace and draft synchronization |
| Hub | Shared family shell, Games home, game-specific route adapters, shared History/Players/Settings |
| Crokinole UI | Setup, standings, score sheet, round entry/details, results, colour settings and disc swatch under `src/components/crokinole/` |
| Database | New additive migration generated with the migration tooling; no invented provider version mapping |
| Verification | `tests/crokinole-*.test.ts`, real database scenarios, `tests/browser/crokinole.spec.ts` and hub regressions |
| Documentation | Repository implementation plan, acceptance checklist, shared access/equipment, recovery and release notes |

File names may be consolidated where a small component/function is clearer than a new abstraction. No new dependency is assumed. No broad renaming of the existing database schema, package or Scrabble domain is required.

**14. Definition of done**

The family opens the same Amberly app, chooses either game, selects the same people and scores a valid match. Every accepted round and correction survives reload and is available on another authorized device. A network problem is visible and recoverable. Names, colours, totals and round history are clear on phone and tablet. Only permitted accounts can change scores; private tests remain private. Existing Scrabble history, scoring, sharing, equipment and final results remain intact. The tested, approved release—not only the mockups or local build—delivers the feature.

Planning artifact only. Implementation, hosted migration and publication have not begun.
