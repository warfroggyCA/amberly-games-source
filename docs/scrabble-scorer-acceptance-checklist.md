# Family Scrabble Scorer — acceptance checklist

Companion to the [implementation plan](/path/to/local/Documents/Codex/2026-09-13/let/outputs/scrabble-scorer-implementation-plan.md), September 13, 2026.

**Status: planned checks, not test results. None of these checks has been executed against an app.** Record the app commit, engine/lexicon versions, environment, device/OS, actual result, and evidence when each relevant check is performed. A mockup, successful compile, or simulated phone viewport is not proof of physical-device behaviour.

The final selected rules and decisions D1–D8 control the expected results. Doug has confirmed current racks only with no new draws for assistance, and the official dictionary without an additional family/school filter. The recommended North American source is NWL2023, subject to its data requirements. When another default changes, update this checklist before implementation relies on it. Scoring examples below are independently specified fixtures; official lexical acceptance still uses the selected permitted asset.

## 1. Entry dependencies and independent arithmetic

| ID | Check | Required result |
| --- | --- | --- |
| DEP-01 | Confirm project source | Work is in `/Volumes/X10 Pro/Coding Projects/Scrabble scorer`; inspect its actual state and instructions before any scaffold. |
| DEP-02 | Word asset | Provider/edition/filtering, complete required word lengths, checksum, permitted server/offline/solver use, and retention terms are documented. |
| DEP-03 | Rules preset | Exchange procedure, blocked ending, ties, direction, Solo rules, and assisted adjustments are explicit. No unlabelled household/tournament mixture. |
| DEP-04 | Solver spike | Complete legal move generation works with the chosen lexicon, blank identity, and deployment runtime; licence and cold/warm timing evidence retained. |
| CALC-01 | Opening CAT at H8–J8 | On the standard board, `(3 + 1 + 1) × 2 = 10`. |
| CALC-02 | Opening QUIZ at H8–K8 | `(10 + 1 + 1 + 10) × 2 = 44`. |
| CALC-03 | Same QUIZ with a physical blank for Z | `(10 + 1 + 1 + 0) × 2 = 24`; blank count decreases, physical Z count does not. |
| CALC-04 | CAT already at H8–J8; add S at K8 | CATS scores `3 + 1 + 1 + 1 = 6`; the old centre premium does not reactivate. |
| CALC-05 | Opening READING at H8–N8 | L8 doubles the I: word subtotal 10, centre doubles to 20, seven-new-tile bonus makes **70**. |
| CALC-06 | READ already at H8–K8; add ING at L8–N8 | Full READING scores **10**, including the new L8 letter premium. Three new tiles means no bingo; old centre does not reactivate. |
| CALC-07 | Natural rack-out, bag empty | Scores 100/90/85 and leftover values 0/3/5 produce **108/87/80** under the proposed normal transfer rule. |
| CALC-08 | Blocked normal ending | Scores 100/90/85 and leftovers 2/3/5 produce **98/87/80**, with no going-out transfer. |
| CALC-09 | Assisted no-draw rack-out with bag tiles unused | Scores 100/90/85 and leftovers 0/3/5 produce **100/87/80** under proposed D5, not the CALC-07 result. |
| CALC-10 | Inventory after four initial racks | 100 tiles unplayed, 28 on racks, 72 in bag; the interface explains what “remaining” includes. |

Use actual valid board histories for integration tests. Do not rely on a board that could never have arisen legally just because its isolated arithmetic looks plausible.

## 2. Rules engine and inventory

| ID | Check | Required result |
| --- | --- | --- |
| RULE-01 | Invalid opening, disconnected placement, gap, conflicting tile, out-of-bounds coordinate, multiple rows/columns | Reject with a specific reason; no committed state changes. |
| RULE-02 | Word extended before/after existing letters and placement through matching existing letters | Discover the full word, preserve old tiles, consume only new physical tiles. |
| RULE-03 | Parallel placement forming several crosswords | Every formed word is validated and scored exactly once. |
| RULE-04 | Single new tile forms both horizontal and vertical words | Both contributions count once; no duplicate artificial main word. |
| RULE-05 | New letter/word premium participates in multiple new words | Apply its permitted effect to each relevant word. Previously covered premiums never reactivate. |
| RULE-06 | More than one new word premium in a word | Combine the multipliers, rather than adding them. |
| RULE-07 | Blank on letter and word premiums; blank reused on later turn | Blank remains zero; its represented letter remains fixed; applicable word multiplication still works. |
| RULE-08 | Two blanks, exhausted Q/Z supply, too many new tiles, insufficient late-game rack count | Legal physical inventory accepted; impossible placement rejected without altering the draft. |
| RULE-09 | Invalid crossing word with valid typed word | Identify the crossing word and location; reject the turn without losing input. |
| RULE-10 | Dictionary unavailable, asset checksum wrong, or unsupported asset version | Report unavailable verification; never silently mark the word invalid or switch dictionaries. |
| RULE-11 | Lowercase entry, paste, unsupported punctuation/characters | Normalize supported case predictably; unsupported input does not silently become a different word. |
| RULE-12 | Pass, exchange, legal zero-point placement | All are distinct journal actions; turn/round progression is correct; blocked-pass counter follows the selected rule. |
| RULE-13 | Exchange near bag threshold and wrong quantity | Apply the chosen preset and available rack/bag constraints, not a hardcoded mixture of variants. |
| RULE-14 | Undo/correct placement involving a blank | Board, physical supply, totals, pass state, round, and next player return to the same consistent effective state. |
| RULE-15 | New engine or lexicon release while old games exist | Old games remain reproducible with their recorded versions; no silent historical verdict/score changes. |
| RULE-16 | Generated legal game histories | Tile counts never go negative; derived totals equal the sum of turn components and adjustments; replay produces the same state. |

## 3. Setup, touch entry, and live screens

| ID | Check | Required result |
| --- | --- | --- |
| UI-01 | First family use with no players | Clear add-player path; no empty dropdown dead end. |
| UI-02 | Add new player during setup, then start another game | Profile is reusable; repeated submissions do not create accidental duplicates. |
| UI-03 | Same/similar names, rename, archive, later membership link | IDs remain distinct; history survives; no automatic person merge. |
| UI-04 | One, two, three, four participants | Solo is separate; multiplayer seats and score displays fit; same profile cannot occupy two seats. |
| UI-05 | Seat drag and tap-to-swap, every starting seat, both directions | Preview and actual order agree, skipping empty seats. Ranking never rearranges seats. |
| UI-06 | Type directly onto board; change direction; extend through existing tiles | Caret and draft match the physical intended play; old letters cannot be overwritten. |
| UI-07 | Space/Blank button, cancel selector, backspace, edit blank type | Represented letter and physical blank identity stay correct; cancelling preserves the previous draft. |
| UI-08 | Software keyboard, hardware keyboard, composition, rapid input, double-space substitution | One intended tile/action per input; no stray punctuation, duplicate blank prompt, or lost letter. |
| UI-09 | Keyboard open on physical phone | Selected board area, player, score preview, and Record action remain reachable; zoom/pan is usable. |
| UI-10 | Hide/show panel repeatedly, rotate device, open/close All Letters | Draft, selection, totals, and player order are preserved; compact live scores stay visible in the scoring layout. |
| UI-11 | Rounds with unfinished seats, pass/exchange, ending partial round | Dash versus zero is meaningful; cumulative totals reconcile; adjustments are separate rows. |
| UI-12 | Draft edit and repeated Record taps | Committed leaderboard remains stable until confirmation; exactly one turn is recorded. |
| UI-13 | Long names, large text, screen reader, keyboard-only navigation | Names remain identifiable; focus order works; blanks/current player/premiums have non-colour cues. |
| UI-14 | Modal cancel, validation error, server error | Return focus correctly and retain work. No accidental finalization or silent clearing. |

## 4. Ending and assisted continuation

| ID | Check | Required result |
| --- | --- | --- |
| END-01 | End game with a draft | Resolve/retain the draft explicitly; opening the dialog does not finalize anything. |
| END-02 | Natural rack-out or preset blocked ending | Correct reason and adjustments; actual rack inventory validates; no award based on inferred bag state alone. |
| END-03 | Empty rack while bag still contains tiles in normal play | Do not declare a normal rack-out win prematurely. |
| END-04 | Early stop with unequal turns or after manually completing the round | Label the ending and turn counts accurately; neither enters normal game-win records. |
| END-05 | Leftover blank, negative final score, tie after adjustments, unresolved tie | Correct values and preset tie handling; no winner from list order. |
| END-06 | Return from end review or change to game while review is open | Returning preserves the live game; stale confirmation is rejected and recalculated. |
| END-07 | Double finalization or lost response after finalization | One final result version and one effective contribution to statistics. |
| AST-01 | Invalid rack input or inconsistent combined inventory | Show the exact mismatch; preserve all entered racks; do not start a fictitious run. |
| AST-02 | Cancel rack-entry/setup before revealing advice | Human game and record eligibility remain unchanged. |
| AST-03 | First suggestions exposed; automation subsequently cancelled | Assistance boundary was committed before exposure and cannot be erased by cancellation. |
| AST-04 | Correct next player from a partial round, both directions, 2/3/4 players | Continue the existing sequence from the real stopping point. |
| AST-05 | First automated move opens/closes another player's best placement | Next search uses the updated board and rack, not the initial snapshot. |
| AST-06 | Score versus equity; equal-score candidates | Rank by actual complete-turn points and documented tie-breaks; never claim strategic optimality. |
| AST-07 | Crosswords, blanks, seven tiles, and a legal zero-point move | Same legality/scoring contract as human play; selected move independently revalidated. |
| AST-08 | Complete search finds no placement versus search timeout | Only the complete empty result can produce a pass; timeout pauses and retains progress. |
| AST-09 | Rack emptied versus full cycle with no placements | Stop under the documented no-draw rule; no hidden draws or exchanges. |
| AST-10 | Retry, two tabs, stale solver response, browser close, reconnect | At most one step per revision; resume from committed progress; preserve changed-state conflicts. |
| AST-11 | Pause, Next, Skip animation, final review | Playback reflects persisted steps; skipping animation does not skip required calculation/confirmation. |
| AST-12 | Manual selection from suggestions or later manually typed play | Remains assisted; no path restores human eligibility after the boundary. |
| AST-13 | Proposed D5 with bag empty versus bag tiles unused | Adjustment policy is visible and correct in both cases; normal and house results cannot be confused. |
| AST-14 | Solo assisted finish | Retain practice and assistance labels; generated moves cannot enter human practice word/turn records. |

## 5. History and achievements

| ID | Check | Required result |
| --- | --- | --- |
| HIST-01 | Every word, turn, round, and result link | Opens its original game context and score components. |
| HIST-02 | Main word plus several crosswords and a bingo | Word records receive their own contributions; only the turn total includes all components plus bonus. |
| HIST-03 | Human words before assistance | Eligible word/turn/bingo achievements retained with game context; no assisted points included. |
| HIST-04 | Assisted words, turns, bingos, final scores, wins, averages, streaks, clutch, comeback | Excluded from normal human records everywhere: queries, profiles, home cards, exports, and share cards. |
| HIST-05 | Early and Solo games | Visible history with the specified eligibility/category; no normal competitive outcome inflation. |
| HIST-06 | Clutch conditions fail on timing, lead retention, final adjustment, tie, or assistance | No clutch award. Qualifying fixture yields the exact expected deficit and turn reference. |
| HIST-07 | Comeback across completed rounds and participant-count filters | Deficit uses the defined boundary; comparisons and sample counts are traceable. |
| HIST-08 | Latest turn undo; old correction breaks a later placement | Atomic consistent reversal; older correction requires a valid reviewed sequence, never silent downstream deletion. |
| HIST-09 | Final amendment and another amendment to the same game | All originals remain; effective results/records count that game once at its latest valid version. |
| HIST-10 | Attempt to remove the assisted label through a correction | Source attribution and cutoff remain; derived eligibility cannot be forged. |
| HIST-11 | Rename/archive player, revoke membership, change timezone, cross midnight | Historical references, game ordering, dates, and statistics remain coherent. |
| HIST-12 | Replay and rebuild projections from the journal | Matches effective board, scores, results, words, and record eligibility, including amendments. |
| HIST-13 | Empty history, no qualifying clutch, tied records, larger seeded history | Honest empty/tied states; bounded pagination; no invented awards or duplicate pages. |
| HIST-14 | Share an early/assisted result and later amend it | Export shows its category and version context; internal link resolves to updated history with prior result available. |

## 6. Authorization, transactions, and recovery

| ID | Check | Required result |
| --- | --- | --- |
| DATA-01 | Retry identical command after server committed but response disappeared | Return the original outcome; no duplicate turn, player, assisted step, or final result. |
| DATA-02 | Reuse command ID with changed content | Reject; do not return unrelated success or apply a second payload. |
| DATA-03 | Two commands against one revision; stale board submission | Exactly one accepted transition; conflicting input preserved for review. |
| DATA-04 | Fail between journal insert, projection update, and result update | Entire transaction rolls back or entirely commits; no half-recorded score. |
| DATA-05 | Invalid type, oversized payload, negative quantity, malformed coordinate, forged score | Server rejects invalid input and recomputes trusted data. |
| SEC-01 | Signed out, unrelated authenticated user, revoked family user | No access to family tables, pages, private realtime, records, or command endpoints. |
| SEC-02 | Member impersonates scorer, promotes own role, changes user metadata, calls admin endpoint directly | Denied by server/database authorization, not merely hidden UI controls. |
| SEC-03 | Doug bootstrap and simultaneous last-superadmin demotions | Only verified configured identity is bootstrapped; at least one active superadmin remains. |
| SEC-04 | Delete/update/truncate historical evidence through app runtime and browser API, including superadmin | Historical mutation denied; permitted amendments only append new evidence. |
| SEC-05 | Remove/archive identities referenced by games | No cascading history loss; actor and player references remain meaningful. |
| SEC-06 | Read via views, realtime, share URLs, caches, and preview deployment | Same intended family boundary; no public cache/session leakage or production writes from preview. |
| SEC-07 | Forged assistance source, result eligibility, finalization authority | Trusted workflow and current role checks control the outcome. |
| REC-01 | Draft refresh, tab crash, app switch, lock screen, browser restart | Restore last durable draft/game and truthful sync status without duplicate entry. |
| REC-02 | Disconnect during several turns; reconnect normally | Ordered pending actions upload once and converge to the correct board/round. |
| REC-03 | Offline finalize | Clearly pending until server validation; no prematurely published family win or achievement. |
| REC-04 | Token expires, OTP delayed/expired, reauthentication | Input retained; unauthorized writes rejected; successful login resumes without another game copy. |
| REC-05 | Local storage quota failure or unavailable offline asset | No false saved/validated indicator; preserve visible work and explain required recovery. |
| REC-06 | Two tabs on one device; normal scorer handoff | One local writer; pending actions synchronized before ownership changes. |
| REC-07 | Force takeover while old device is offline | New generation enforced; old pending actions quarantined for review, never silently overwritten or merged. |
| REC-08 | App/service-worker deployment while a game has pending actions | Compatible resume or explicit protected recovery; no mid-turn reload or automatic rules change. |
| REC-09 | Sign out with pending changes and sign in as another person | No silent pending-action deletion and no exposure of the first account's private cached game. |
| REC-10 | Restore backup into isolated environment | Journal, results, permissions, representative replays, and effective records verified; media covered separately if used. |

## 7. Release evidence

Keep a short evidence record for each release: source commit, migration IDs, engine/lexicon/solver versions, automated check results, physical device/OS coverage, restore test, known limitations, and the concrete deployment approved by the owner.

Any unresolved scoring mismatch, historical-data loss, authorization bypass, duplicate-action defect, or assisted-record contamination blocks family release. A failed check is not converted into a pass by removing the fixture or describing the affected path as unlikely.

Run appropriate unit, integration, type, lint, build, and browser checks. Verify important calculations independently. Complete physical iPhone/iPad gameplay and interruption trials; mark any untested device behaviour as unverified. Broaden testing only when a new change, failure, or unresolved concern warrants it.
