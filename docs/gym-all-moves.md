# All moves

Gym's All moves button searches the original rack against the fixed puzzle board. The player's tentative placement is preserved separately. The catalogue captures each unique physical placement from the existing solver, including blank assignments and crossword scores, sorts by descending whole-turn points with deterministic ties, and groups repeated word labels under their highest-scoring placement. Each choice also identifies every formed word and its coordinates; the headline follows the axis of the newly placed tiles, with an across/down arrow and an “Also forms” line for crosswords. Single-tile crossings name both formed words (across then down) without choosing an arbitrary primary word.

One tap previews a group's best placement. Other placements expand under that word. The list renders 25 groups at a time and 10 alternatives at a time. My move or Close move list restores editing of the original draft. Actual score tiers determine gold/silver/bronze; other previews use a neutral highlight. On small screens the selected placement is scrolled into view.

A separate worker performs catalogue search. It bounds nodes, elapsed time and retained output (25,000 placements). Only completed enumeration is labelled All moves. Capped/interrupted output is labelled Moves found, with an incomplete-search explanation and retry. A worker-level timeout reports failure without inventing an exhaustive list. Closing the explorer terminates its worker; puzzle/reference changes close and invalidate its results.

Compare strategy for this move runs bounded sampled coaching for the selected placement only. It does not create a player attempt or attach a coaching assessment to a different draft. Viewing the list records an all-moves assistance event; subsequent attempts are assisted. Recovered practice remains a resumed assisted segment. Computed catalogues and explored previews are not persisted as the player's draft.

This feature does not expose rack-based suggestions in ordinary scorer word entry: those inputs do not establish an actual rack. Reuse in an explicitly assisted scorer workflow requires that workflow's supplied rack.

Verification includes complete-key comparison against exhaustive miniature lexicons, blank alternatives, truncation labels, real selected-move strategy requests, retained drafts after preview, desktop height, phone/iPad WebKit flows and database assistance classification. Physical device acceptance is separate.
