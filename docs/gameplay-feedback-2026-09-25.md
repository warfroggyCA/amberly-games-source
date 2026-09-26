# Game-night feedback implementation

Released to Preview on September 26, 2026. See [current release status](release-status.md) for the authoritative deployment and acceptance record. Earlier preparation notes below retain their historical status.

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
3. Invite Erin's exact Hotmail address and associate the invitation/member with her existing player profile using existing member management. Do not create a duplicate player. Verify sign-in and profile/history access on her device. No invitation was sent in this implementation task.
4. Deploy the tested application and verify both scorer and viewing-link timer updates, pause/resume, historical correction, standings and actual email delivery. Older app versions cannot safely handle the new journal commands, so rollback after new timed/edited games requires preserving the compatible rules engine.

## Validation

- Production build and TypeScript checks passed.
- Unit suite: 920 passed; 105 suite-gated skips (database tests executed separately below).
- Disposable PostgreSQL suite: 103 passed, including migration, sanitized guest timing, historical edits and standings.
- Targeted Playwright checks: 33 passed across desktop Chromium, iPhone WebKit and iPad WebKit; three landscape-only cases skipped as not applicable. The final history tests were rerun after narrowing a test locator that also matched the navigation button.
- Manually inspected scorer, viewer and history screenshots. Verified a 10-point CAT becomes 4 when C is corrected to a blank, and a later CATS score is also recalculated by regression tests.
- Changed-code ESLint has no errors; BoardEditor retains its pre-existing aria-description warning. Full-repository lint remains blocked by six pre-existing require-import errors in art/scarlett/v5, v6 and v7 package-preview.cjs scripts, left untouched.
- The clear-draft browser test now waits for the existing confirmed-save message before reloading; optimistic UI clearing alone is not persistence proof.

Local browser fixtures and PostgreSQL tests do not establish hosted email delivery or physical-device acceptance. No production deploy, hosted migration, auth configuration, invitation or player-data mutation occurred.

## Release preparation

The isolated release checkout is `/private/tmp/amberly-gameplay-feedback-release`, based on the verified live source `8da43605c77327df8dca4bdced5cc16a4ad79569`. This preserves deployed Gym features and excludes unrelated local changes. PR: https://github.com/warfroggyCA/amberly-games-source/pull/12. Current candidate: `80d939d8a7a94afbd934cb85c73080bca4191025`; exact-commit Verify: https://github.com/warfroggyCA/amberly-games-source/actions/runs/36216026233 (running when this note was written).

Full verification caught and repaired short landscape keyboard clipping from the new toolbar. The clock and Pause control now use a left rail while typing. All eight focused keyboard tests passed; the complete suite is rerunning. The fix is also copied to this workspace.

Hosted inspection found that the viewer migration is missing and custom SMTP is disabled. The existing non-Google invitation is already active and linked to its player; no duplicate was created. Fresh backup/restore through the existing owner-run helper is pending. No hosted migration, auth setting or deployment was changed during this preparation.

### September 26 follow-up

The temporary release checkout was restored after temporary files were cleared. Overnight CI on `80d939d` passed 335 browser cases and failed five iPhone landscape cases because the toolbar overlapped header controls. The final repair reserves the menu/brand and bag/score gutters, keeps save status visible, and preserves the keyboard-side clock/Pause rail. All 15 affected landscape cases pass. The isolated integrated identity/scoring/recovery test passes. Screenshots at 667px and 844px were inspected.

Final published candidate: `8398c0c8cb4384521bd7160c62dffdd5fae3e49f`. Full CI: https://github.com/warfroggyCA/amberly-games-source/actions/runs/36239960626 (running at this update). PR #12 remains the review. No hosted mutation/deployment has occurred; backup/restore and SMTP setup are still pending. Supabase path: Authentication → Emails → SMTP Settings.

### September 26 release execution

Owner confirmed the fresh backup PASS. Archive `backup-20260926T123727.217526Z` has SHA-256 `03842a39334951c7aa0e8bab62c6959a99b41246b09833d4074bf6b7f3a30174`. Independently restored all 26 tables with grants, matched the helper fingerprints, and applied the viewer migration twice without changing any table fingerprint. Hosted migration `20260926123933_gameplay_timing_viewers` is applied; schema v2, timing/rack projection and invalid-link rejection verified. Backup scope is the game schema; iCloud off-device upload and whole-project identity recovery are not proven.

Custom SMTP is configured through Resend; real email delivery and code sign-in worked for Doug, and the second message arrived in his main inbox. The exact Preview callback is already allowed in Supabase. Erin's existing invitation remains linked to her existing profile; her device sign-in remains acceptance work.

Commit `8398c0c8cb4384521bd7160c62dffdd5fae3e49f` passed the full Verify run `36239960626`. Final email callback fix `7f64c6086af58fab239064adf3232276f4e33940` passed 80 focused auth tests plus format/type/lint (one existing accessibility warning). Full Verify `36242562622` is running. Application deployment is pending its success; current Preview remains source `8da43605c77327df8dca4bdced5cc16a4ad79569`.

### Released to Preview — September 26

Final commit `7f64c6086af58fab239064adf3232276f4e33940` passed Verify `36242562622`: 920 unit, 103 database, 340 browser and one integrated test. Browser suite had 32 applicability skips; unit runner had 105 suite-gated/benchmark skips. Release gate passed with a clean isolated checkout.

Deployment `dpl_4ubKsKWqE5Q45neN9HxqsjBLi1R8` is Ready and `https://amberly-games-preview.vercel.app` points to it (September 26, about 09:22 EDT). Deployment URL: `https://amberly-games-d4j4qsedm-dougs-projects-e9ca299b.vercel.app`. Preserved Crokinole, Gym and Gym history gates; enabled Google plus email sign-in. Prior deployment `dpl_6mJuiH1LEs6KahHbKUWA2UtQ7u9Q` is retained, but old journal readers are not safe rollback targets after new commands are used. No merge or Production deployment.

The old CLI 47.1.3 was rejected by Vercel; endpoint-suggested minimum 47.2.2 was absent from npm. Official npm version 60.1.3 successfully deployed via npm exec, without dependency/source changes.

Hosted postflight: auth session endpoint reports configured/both; signed-in history loads; winner crowns show Cici and Froggy; sortable standings show one win each and exclude the early-ended test; the saved final board and rack counts load with existing scores unchanged. An initially open tab showed a sign-in error after cutover; a fresh navigation resolved it, and subsequent normal history navigation worked. Advise refreshing clients before play.

Remaining acceptance: Erin's first email sign-in on her device, physical iPhone/iPad gameplay, and the optional email-button click on the deployed build. Real code sign-in and delivery were verified before deployment. No live game was created, rescored or edited for testing. Guest timing and pause/edit gameplay were exercised in browser/database/integrated fixtures; an existing guest token was not available for hosted postflight and no viewing link was replaced.
