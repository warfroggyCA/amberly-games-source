# Gym history navigation and access recovery

History navigation is independent of profile connection and durable sync. Each
list/detail navigation invalidates and aborts the previous read before waiting
for queued writes. Generation and full family/user/player guards remain after
prerequisites and around response, error and finalization handling, including
when cancellation is ignored. Closing history invalidates reads immediately;
an original-owner outbox flush can finish independently.

A current HTTP 401/403 or `NO_PROFILE`/`PROFILE_CHANGED` response removes displayed
profile history and blocks owned actions. This denied state survives dialog
close/reopen, background sync completion, focus and online events. Reload and
check the profile through Games to reconnect. Initial temporary connection
failures can still retry in place; an established profile cannot silently switch
to another account or linked player.

Temporary service/network failures retain the identity and queued work. History
offers retry and labels retained same-owner content as potentially out of date.
HTTP status survives empty or malformed error JSON. Malformed successful
account/history responses and mismatched detail IDs are service failures, not
proof of access denial. Optional expected family/player parameters are checked
inside the existing authenticated read transaction; they do not select another
owner or change write behavior.

The current puzzle remains available when history access is denied. Local drafts
and pending events keep their original owner keys. A matching in-flight write
receipt can acknowledge only its exact original-owner event without restoring
access. No migration, saved format, journal event, scoring rule or dictionary
behavior changes are involved.

[Same-device recovery](gym-draft-recovery.md) describes puzzle, rack, tile and
undo restoration. Recovery is promised only after the current snapshot is
successfully stored. Storage failure retains the explicit **Leave practice**
path. [Word lookup](gym-word-lookup.md) is already available and uses the existing
verified-word catalog.

## Regression coverage

`tests/browser/gym-history-hook.spec.ts` mounts the real hook and history
component under React Strict Mode in a test-only browser fixture.
`tests/browser/gym-history-navigation.spec.ts` operates the actual GymLab. Their
30 cases per browser profile include ignored aborts, both response orders,
close/reopen, delayed sync prerequisites, stale flush/account checks, denial with
malformed bodies, retryable failures, owner changes and original-owner refresh
recovery. Existing draft tests also verify explicit leave after storage failure.

With the approved private inputs and pinned toolchain prepared:

```bash
npm test -- tests/gym-history-read-state.test.ts tests/gym-history-api.test.ts tests/gym-history-outbox.test.ts tests/gym-draft.test.ts
CI=1 npm run test:browser -- tests/browser/gym-history-hook.spec.ts tests/browser/gym-history-navigation.spec.ts tests/browser/gym-connection-recovery.spec.ts tests/browser/gym-draft.spec.ts --project=desktop-chromium --workers=1
```

Follow the environment's browser setup instructions before running WebKit.
Database ownership checks run through `npm run test:database`; the repository's
Verify workflow runs broader code, database, integrated and browser checks.

The November 8, 2026 implementation validation at commit
`09088c4c54a951162fa7551e22f6a7c8fa08cac7` passed 1,206 unit tests, 160 isolated
database tests, four integrated journeys and 1,143 browser cases across the four
profiles. All 30 new B1 cases passed in every profile, with none skipped. The
broader matrix had 53 existing guarded skips (development-only diagnostics,
Chromium touch injection and viewport/desktop-specific cases). Independent QA
also passed eight actual-app journeys. These are historical results; subsequent
publishing checks and exact-head CI must be reported separately. Emulated
WebKit does not establish physical iPhone/iPad Safari acceptance, and synthetic
services do not establish hosted authentication/database behavior.
