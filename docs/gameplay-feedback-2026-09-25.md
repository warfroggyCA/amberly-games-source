# Game-night feedback implementation

Release prepared from live revision `8da43605c77327df8dca4bdced5cc16a4ad79569`, preserving the deployed Gym features. Hosted rollout evidence is recorded separately after release. No family game or player data is rewritten by these changes.

- Visible Skip turn records a zero-point pass and advances play. Existing exchange support remains available.
- Score sheet → select any recorded play → Edit this play. Change tile coordinates, letters and blank identity; add/remove entered tiles. A reason is required. The entire subsequent command history is revalidated before accepting the edit; invalid later plays or physical-count/rack contradictions reject the whole correction. Original commands remain in the audit journal. Finalized games remain immutable; this editor is for games still in progress, including paused games.
- Begin play & timer explicitly starts timing. Pause/Resume stops/resumes both scoring and timing, preserving entered letters. Each player shows accumulated time beneath their name, including their current turn. The current-turn clock is visible to scorers, signed-in viewers and viewing-link guests. Sleep/refresh continues timing; pauses are excluded. Timing begins only when explicitly enabled, so older untimed turns remain unknown. Times are scorer-device timestamps for family statistics, not trusted competitive speed scores. Multipliers remain out of scope.
- End-of-game score sheet includes player total/average times and the longest recorded turn in each round.
- Authentication supports `SCRABBLE_AUTH_METHOD=both`, retaining Google and adding email codes for Hotmail/Outlook and other invited addresses. Existing `google` and `email` modes remain supported.
- New start-square selection releases stale manually chosen direction when no tiles have been entered. Empty edge starts choose the axis with room. Existing draft alignment takes precedence. Ambiguous layouts retain the chosen axis.
- Rack counts appear beneath player names on scorer and viewer screens. These are inferred from plays/draws and the existing physical count reconciliation; hidden rack letters are never exposed.
- Game history shows a prominent gold crown and winner name, including tied winners.
- Family standings is expandable from Game history; each game type has sortable Rank, Player, Played, Wins and Ties columns. Rankings use wins with shared ranks for ties. Aggregates span the full family history and do not depend on the current page/player filter. Private tests, removed games, early finishes, unresolved/upheld concerns, and noncompetitive Scrabble results are excluded, matching existing record eligibility. Doubles teammates each receive the team result.

## Release requirements

1. Apply `20260926032143_gameplay_timing_viewers.sql` through the existing migration process. This replaces the existing restricted viewing-link projection with the same authorization plus rack counts and sanitized timing events. It never exposes journal reasons, actors, account details or rack letters. It is tested against disposable PostgreSQL only.
2. Configure Supabase email OTP delivery before selecting `SCRABBLE_AUTH_METHOD=both`: enable Email provider, configure production SMTP, and include `{{ .Token }}` in the Magic Link email template. Keep existing Google setup. Reference: https://supabase.com/docs/guides/auth/auth-email-passwordless
3. Confirm an invited non-Google account is linked to its existing player profile; do not create a duplicate. The existing invitation was verified during release preparation. Actual email delivery and profile/history access still require end-to-end verification.
4. Deploy the tested application and verify both scorer and viewing-link timer updates, pause/resume, historical correction, standings and actual email delivery. Older app versions cannot safely handle the new journal commands, so rollback after new timed/edited games requires preserving the compatible rules engine.

## Validation

- Production build and TypeScript checks passed.
- Unit suite: 920 passed; 105 suite-gated skips (database tests executed separately below).
- Disposable PostgreSQL suite: 103 passed, including migration, sanitized guest timing, historical edits and standings.
- Targeted Playwright checks: 33 passed across desktop Chromium, iPhone WebKit and iPad WebKit; three landscape-only cases skipped as not applicable. The final history tests were rerun after narrowing a test locator that also matched the navigation button.
- Manually inspected scorer, viewer and history screenshots. Verified a 10-point CAT becomes 4 when C is corrected to a blank, and a later CATS score is also recalculated by regression tests.
- The isolated release excludes unrelated local artwork sources. BoardEditor retains its existing aria-description warning.
- The clear-draft browser test now waits for the existing confirmed-save message before reloading; optimistic UI clearing alone is not persistence proof.

Local browser fixtures and PostgreSQL tests do not establish hosted email delivery or physical-device acceptance. No production deploy, hosted migration, auth configuration, invitation or player-data mutation occurred.
