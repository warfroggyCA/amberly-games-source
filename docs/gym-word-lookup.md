# Gym word lookup

Gym reuses the scorer's **Search official site** dialog and publisher-verdict adapter. **Word lookup** prefills invalid words from the current draft. A confirmed definition alone is insufficient: the publisher must explicitly mark the exact word playable.

Signed-in Gym uses the append-only family verified-word catalog. `/api/family/words` requires the current authenticated account and active membership; writes also require the configured same origin. The server accepts only up to eight word strings, obtains its own publisher evidence, rechecks membership under the family lock, and inserts missing entries with an audit record. Concurrent/repeated saves converge on the existing confirmation without replacing it. The catalog is capped at 10,000 additions. No schema migration is required.

The scorer and Gym use the same catalog. Future scorer games inherit its additions; existing game journals retain their original reference and normal explicit verification/resume behavior. Both modes use the existing bounded server lookup cache and show the correct storage scope. Failed dialog saves retain the query, evidence display and board, and can be retried.

Standalone Gym uses the existing local scorer store, preserving other local games and drafts. Those additions stay on that device/origin; they are not silently promoted into a family catalog.

## Current puzzle and history

Puzzle generation continues to use the pinned base dictionary and random legal play. Scoring/coaching extends that reference with the loaded verified additions. After a successful save, Gym clears obsolete grading, hints and solution previews and recomputes the answer set in a worker, preserving rack identity, blanks, placements and undo history. Failed/cancelled recomputation keeps scoring and hints disabled until retry succeeds. Starting a new puzzle only commits its word list when generation succeeds.

Each saved Gym event may include `referenceWords`, the sorted word names used for that evaluation. Earlier events without the field retain the base reference. The server resolves additions from the same family's immutable evidence catalog, rejects unconfirmed words, validates the generation trace against the base reference, and verifies attempt points against that event's exact additions. Score/strategy events must match the associated attempt's word snapshot. Lookup is recorded as assistance; subsequent additions do not rewrite earlier attempts. History exposes the additions used for each attempt.

## Verification and release

Regression coverage includes publisher failure, save failure/retry, interrupted recalculation and generation, retained tiles, refreshed validity/ranks, reload persistence, family isolation, duplicate insertion, membership revocation during lookup, and historical word snapshots. Browser publisher/family responses are controlled fixtures; real database authorization and persistence run separately against disposable PostgreSQL. These do not claim physical-device or live publisher availability proof.

This change affects persisted event semantics and server authorization. Use full release verification before hosted publication; the earlier expedited presentation-only releases are not its release gate. Keep the new history reader/writer when rolling back, or pause Gym history writes while preserving pending queues and catalog entries. Never remove saved additions or attempts to make older code accept them.
