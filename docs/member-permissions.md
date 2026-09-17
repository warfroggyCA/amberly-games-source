# Member permissions and private tests

Superadmins open **Game menu → Family access → Permissions** beside a member. Each switch has a description and applies to that person’s verified account across devices. Role and linked player are in an expandable section. A reason is required and every saved change is audited. Stale forms must be reopened; an interrupted save retries the original request ID.

## Capabilities

| Switch | Member default | Scope |
| --- | --- | --- |
| Start games | On | Shared game creation; also needs Keep score |
| Keep score | On | Enter, undo and finish the games where this person is designated scorer |
| Add players | On | Shared roster creation |
| Edit their profile | On | Name, photo and bio of their linked profile |
| Change tile sets | On | Saved bag quantities for future games; existing games retain their snapshots |
| Share viewing links | On | Create, replace and close links for games they score |
| Edit anyone’s profile | Off | Roster-wide profile changes |
| Take over scoring | Off | Become another game’s designated scorer with a reason; also needs Keep score |
| Review game concerns | Off | Resolve concerns; original scores remain unchanged |
| Invite people | Off | Allow emails to join as ordinary members, or revoke pending invitations |
| Export the shared archive | Off | Shared history, excluding private tests and internal audit data |

Existing memberships and new invitees use these defaults when no override is saved. New members can be customized after they join. Superadmins retain every capability; individual switches apply when the role is Member. Only superadmins may change membership, roles, linked profiles, or permissions. The last active superadmin cannot be demoted or suspended.

Viewing shared history and reporting concerns remain available to active members. Suspending Account access blocks family access without deleting the person’s history. The share switch controls link management: previously issued links retain their normal expiration/revocation behavior.

## Private tests

Shared games with `mode=practice` are visible only to superadmins, including historical tests. Regular members cannot create them, open them by ID, read their draft, export them, or see their concerns. Practice links cannot be created and existing practice viewing tokens no longer resolve. Enabling every member capability does not grant private-test access. The independent local `/` preview remains a device-only development sandbox and does not read shared tests.

**Delete practice game…** appears in Home, History and the game details for superadmins. It requires confirmation and a reason. Removal is an immutable marker, not a physical deletion: original definitions, turns, results and audit evidence remain in the internal archive. Finalized practice games may be removed; confirmed games cannot. Removed tests disappear from normal lists and cannot be scored or restored by an old request. Retries acknowledge the original removal once, including when the connection fails after commit.

## Enforcement and recovery

The server checks capabilities on every action using fresh membership inside the existing family transaction lock. The database adds permission checks to roster, equipment and invitation writes, and applies practice visibility to game-related tables. Request replays return current scoring access rather than restoring obsolete ownership. Permission-only refusals refresh access while keeping the member signed in and preserving unsent tiles. Revoked membership remains fail-closed.

Visible shared workspaces refresh access every five seconds and on focus/resume, except while resolving a pending action. New writes are checked immediately even before the interface refreshes. Private games already loaded by a subsequently demoted superadmin are cleared on the next successful refresh. Previously delivered data or screenshots cannot be remotely recalled.

## Migration and release

The additive migration is `supabase/migrations/20260916234943_member_permissions_and_practice_removal.sql`. It adds membership permission overrides, validates their keys/values, adds immutable practice-removal markers, and tightens practice read policies and spectator functions. It changes no scores, player identities or original game journals.

Apply the migration before publishing the matching API, after separately approving the hosted change. Inspect the provider migration history first: hosted versions differ from local filenames. Do not use a blind migration push. The checked-in migration and isolated test results are not evidence of a hosted migration or release.

Do not roll back to an older API after enabling restrictions or removing tests: earlier API versions do not implement all capability and removal checks. Prefer a forward fix or a rollback build that retains this authorization layer. Keep the additive schema and audit evidence intact.

Verification covers direct API denial, SQL read isolation, stale forms, simultaneous access updates, duplicate retries, permission removal during scoring, cached practice visibility after demotion, removed-game replay, finalized results, transaction failure rollback, and touch controls across Chromium desktop and WebKit phone/tablet/landscape. These are isolated browser tests, not physical iPhone/iPad acceptance.
