# Automatic scoring-tab takeover

Status: published on September 16, 2026 in READY preview `dpl_9K9i48dLAsYvjPN6tra8ZUNPso65`, after explicit approval, together with saved tile sets. The usual Amberly alias was independently verified against that deployment.

Opening or reloading /family claims this browser’s shared workspace for the signed-in account. The earlier tab displays **Scoring moved to another tab** and **Use this tab**. Selecting that action reloads the older tab to claim ownership again. There is no cross-tab sign-out, automatic focus-based stealing, or change to which family member may score the game. Shared observer links do not participate in the writer claim.

## Integrity and compatibility

- Replaces the Web Locks `ifAvailable` hard stop with a per-family/account ownership record in the existing IndexedDB workspaces store. Claiming ownership and reading the saved checkpoint share one transaction. The stored device identity is resolved within that transaction, including competing first-use identities.
- Every local save checks the owner and writes the checkpoint in the same read-write transaction. Delayed code or missed notifications cannot replace the new owner’s draft or issue a new scored command without first preserving its pending request.
- BroadcastChannel is an immediate UI notification only; focus/visibility changes also recheck ownership. It is not the storage authority. Displacement retires the old store, aborts its requests and closes storage/listeners. Actual React unmount retires the owner while retaining Strict Mode effect replay compatibility.
- Saved requests retain their exact idempotency key across a takeover, including requests still in flight. A late old response cannot overwrite the new checkpoint. A retained uncertain action must still be confirmed before more scores are entered.
- Refresh server state after a previous owner exists. Server account, current revision, scorer generation and idempotency authorization remain unchanged.
- IndexedDB database version increases from 1 to 2, preserving all existing workspace records and their version-1 data format. The bump causes legacy clients to close through their existing versionchange handler; it never deletes/recreates the object store. Truly unresponsive old connections can still delay the browser upgrade; the existing bounded storage-open timeout retains data rather than forcing destructive recovery.
- Application rollback must retain database version-2 compatibility and the ownership checks. Old code that explicitly opens version 1 cannot open an already upgraded database. Do not clear or downgrade browser storage as rollback. No server database migration, sign-in change, historical-data change, dependency or permission expansion is part of this patch.

## Verification

- 83 shared-store tests passed, including automatic takeover, retained letters, delayed/missing notification fencing, in-flight acknowledgement/retry identity, refreshed server denial, repeated and overlapping openings, competing device identities, legacy storage upgrade, and existing recovery/security cases.
- Full app suite: 679 passed; 34 database tests skipped (no server/schema change).
- Project-wide lint and formatting checks, TypeScript, and optimized build passed. The temporary test route was removed before the final build.
- Two real browser tabs on isolated localhost:3008 ran the actual FamilyApp/ScorerApp with real IndexedDB and BroadcastChannel, mocked accounts/API responses and blocked server writes. CAT restored on automatic takeover; Review remained enabled. Editing CAT to COT worked after takeover. Use this tab reversed ownership and restored COT; the displaced tab had no board input. React Strict Mode was enabled by the dev runtime.
- The initial browser pass exposed an incorrectly positioned paused-screen rendering branch; it was corrected and the full handoff repeated successfully. Existing duplicate React keys for the adjacent share/bag controls appeared in this shared fixture; these predate the patch and were not represented as a clean-console pass.
- Temporary browser fixture source retained at /tmp/amberly-tab-takeover-qa.tsx, outside the release. The separate test tabs/server were closed. No hosted accounts/games or real saved local game were mutated.
- A hosted authenticated Chrome check on September 16 verified automatic takeover into a new tab, the older tab’s paused state, Use this tab reclaiming the original tab, and enabled board input afterward. No turns were entered. The temporary tab was closed. Physical iPad/iPhone acceptance remains outstanding.

## Reference

The Web Locks standard explicitly notes that stealing a lock rejects its released promise without stopping the previous callback’s code: https://www.w3.org/TR/web-locks/. Durable transactional ownership avoids relying on that mechanism alone.
