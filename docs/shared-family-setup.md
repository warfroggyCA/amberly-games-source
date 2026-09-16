# Shared family setup

**Status: September 14, 2026 — Google sign-in and owner bootstrap verified; shared preview reachable without Vercel login.**

This document describes configuration for an independent installation. Operator-specific project/account identifiers and historical verification evidence are kept in a private provisioning archive. Bind administration to an explicitly verified owner account, never signup order.

The sequence below describes the setup and access contract; completed steps are recorded in the provisioning record and must not be blindly repeated. Normal games use the approved concern/review process without participant-approval gates.

## Workspaces and access

| Address | Behaviour |
| --- | --- |
| `/` | Existing local scorer. Games, players, and drafts remain in this browser’s IndexedDB; no account or cloud configuration is required. |
| `/family` | Shared beta. A verified email account must also have active family membership. The server validates all shared commands and returns acknowledged state. Missing configuration produces an explicit setup state. |
| `/watch` with a valid private link | Simplified board, scoreboard, rounds, and final adjustments for one game. No guest account/sign-in is needed; no score changes or administrative actions are available. It still requires the configured shared database to serve that game. |

A normal shared **Family game** starts with player names only. Only the scorer needs an authenticated, active family account; other players need no email, account link, or approval to participate, score, or finish. Optional account links can be added later for profile ownership and family access. **Practice game — no records** remains an optional game type, not a requirement for guests. The persisted internal `confirmed` mode label is retained for compatibility and no longer implies an approval gate.

Any active member can **Report a concern** for themselves or on a guest’s behalf with an optional name. Open or upheld concerns hold that game out of records while scoring can continue. A superadmin clears/upholds the concern with a reason; original scores, the report, and the terminal decision remain in history. Clearing one concern restores only normal eligibility and cannot bypass another open/upheld concern. Guests watching a private link cannot submit writes directly. Legacy approvals remain historical evidence and compatible saved requests; they do not gate current games.

All supplied beta lexicons use `status: "test"`. Finalized beta results and cleared concerns remain outside achievements. The private watch link is a bearer capability: anyone who possesses it can watch. It lasts seven days; replacement invalidates the previous link for that game, and the scorer or a superadmin can close it. The database stores a token hash, and guest responses exclude account details, profile images/biographies, rack contents, and administrative journal/audit data.

## Configuration contract

The exact variable names are in [`.env.example`](../.env.example). Use a private local environment file or the target host’s secret store. None of these variables use the `NEXT_PUBLIC_` prefix; operator credentials must never be available to the Next.js process or browser bundle. Do not paste credentials into documentation, chat, command arguments, screenshots, or Git.

| Variable | Required value |
| --- | --- |
| `SCRABBLE_SUPABASE_URL` | The selected dedicated project’s Auth origin. The app requires HTTPS except for a loopback development service. |
| `SCRABBLE_SUPABASE_PUBLISHABLE_KEY` | That same project’s modern `sb_publishable_…` key. The current adapter rejects legacy/secret keys. |
| `SCRABBLE_AUTH_METHOD` | `google` for the approved shared setup. Omitted/empty retains the existing email-code flow; any other value fails configuration. |
| `SCRABBLE_APP_ORIGIN` | The exact origin serving this app, with no path, query, or fragment. The current local origin is `http://127.0.0.1:3000`; a deployed origin must use HTTPS. Mutation Origin checks and secure-cookie settings depend on it. |
| `SCRABBLE_FAMILY_ID` | The explicitly chosen UUID of the family created by the operator bootstrap. |
| `SCRABBLE_DATABASE_CA_CERT` | Optional PEM CA contents for verified TLS; required by the selected Supabase pooler. See [certificate documentation](../config/certs/README.md). |
| `SCRABBLE_DATABASE_URL` | A PostgreSQL connection for the dedicated non-owner runtime login described below. Never use the database owner, `postgres`, `supabase_admin`, or a service credential. |
| `SCRABBLE_OWNER_DATABASE_URL` | Operator-only connection used by `scripts/bootstrap-family.mjs`, outside the application environment. Do not copy it into `SCRABBLE_DATABASE_URL`. |

Leave shared configuration absent when using only the root preview. A partially configured service should fail explicitly rather than silently treating local data as shared data. Keep the same browser profile and origin for existing local history. There is no automatic local-to-shared import.

## 1. Select and inspect a dedicated development target

Record the intended organization, project, region, family name, and exact app origin before provisioning. A dedicated development target avoids sharing runtime credentials or schema changes with another personal project. Inspect the target’s existing schemas and migration history before applying anything.

The implementation uses Supabase for Auth and a server-side PostgreSQL connection for application data. Keep `scrabble` out of the Data API’s exposed schemas and retain the migration’s revocations for `anon`, `authenticated`, `service_role`, and `PUBLIC`. Do not add browser-role grants to resolve a connection problem: family access goes through the Next.js APIs. Supabase’s changing public-schema exposure defaults do not replace this explicit private-schema boundary. See [Data API security](https://supabase.com/docs/guides/api/securing-your-api) and the [April 2026 exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

No Supabase CLI target has been selected by this guide. If the CLI is used, inspect its installed `--help` and the selected project before using migration commands; do not infer a target from another checkout’s linkage.

## 2. Review and rehearse the schema

Apply the ordered migrations: [20260914184358_shared_family_foundation.sql](../supabase/migrations/20260914184358_shared_family_foundation.sql) creates the private schema and restricted `scrabble_runtime` group role; [20260914195113_game_protests.sql](../supabase/migrations/20260914195113_game_protests.sql) adds concern and decision tables, policies, and immutable-history triggers without rewriting existing games/results/approvals. Original definitions, game events, final results, participants, legacy approvals, concerns, decisions, verified-word evidence, audit entries, and request acknowledgements are append-only. Mutable projections, profiles, membership, invitations, and watch-link state have separate permissions. Application superadmins receive no database erasure capability.

Use the disposable local integration suite to rehearse both exact migrations and role behaviour:

```sh
npm run test:database
```

This requires PostgreSQL 17 binaries. The runner defaults to `/opt/homebrew/opt/postgresql@17/bin`; `SCRABBLE_PG_BIN` can point to another compatible installation. It starts an isolated cluster with synthetic identities, applies both ordered migrations there, runs the repository tests, restores a logical dump into a separate test database, and normally removes the cluster afterward. It does not contact or migrate a Supabase project. Its temporary loopback trust configuration is a test harness, not a deployment configuration.

The migrations have no standalone dry-run flag. Local execution in the disposable cluster is the schema rehearsal; cloud application remains a separate reviewed operation. Apply each once in order through the target’s controlled migration process. The foundation deliberately does not silently overwrite an existing `scrabble` schema; the protest migration adds tables to that foundation. If any existing schema or migration conflicts, inspect and resolve that history; do not drop/recreate it or rerun a partially understood migration.

## 3. Create the least-privilege runtime login

The migration creates a non-login group, `scrabble_runtime`. After reviewing the target, an operator creates a dedicated login with no object ownership, superuser capability, role/database creation, replication, or RLS bypass. A representative role definition is:

```sql
create role scrabble_app_login
  login nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls;
grant scrabble_runtime to scrabble_app_login;
```

Use the approved credential-management workflow to assign a strong unique password; no password is embedded in this template. Confirm the login can connect to the intended database and execute `SET LOCAL ROLE scrabble_runtime` inside a transaction. It must not own the schema/tables or belong to owner/admin roles. The server applies that restricted role and transaction-local actor/family claims on every repository transaction, then rechecks membership.

Obtain the correct endpoint and custom-role username for the selected connection mode from the project’s Connect settings. Do not substitute the dashboard’s owner connection into the runtime variable. Direct connections or session pooling suit migration/restore work; runtime pooling must preserve the implementation’s transaction boundaries. `postgres.js` is configured with prepared statements disabled. Remote runtime connections require full TLS verification; do not weaken verification to bypass a certificate problem. See [connection modes and TLS](https://supabase.com/docs/guides/database/connecting-to-postgres) and [PostgreSQL roles](https://supabase.com/docs/guides/database/postgres/roles).

Run the authorization checks with this restricted login in the configured target, rather than relying on successful queries as a database owner. Verify denied browser-role/Data API access and absence of update/delete/truncate rights on immutable evidence. A locally passing test of synthetic roles is not evidence about the real project’s configured grants.

## 4. Configure Google authentication and verify the owner

Google sign-in is the approved shared sign-in method. Set `SCRABBLE_AUTH_METHOD=google` only with a configured Google provider. The `/family` screen then offers **Continue with Google**. Spectators continue to use private viewing links without accounts. Family invitations are shared by the organizer; the app never reveals or distributes another person’s sign-in credentials.

Create a Google OAuth **Web application** client for Amberly Games. Configure its Google Auth Platform audience and basic `openid`, email, and profile scopes. Put the Google client ID and secret in the selected Supabase project's Google provider settings; they do not belong in this app's JavaScript or environment. Google’s authorized redirect URI is the selected Supabase project's `https://<project-ref>.supabase.co/auth/v1/callback`, copied from that project's provider settings. In Supabase, add the app's exact `<SCRABBLE_APP_ORIGIN>/api/auth/callback` to the redirect allow list and configure its Site URL. Keep nonce checking enabled. See [Supabase Google sign-in setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

The app starts Google sign-in through same-origin `POST /api/auth/google`, stores the PKCE verifier in an HTTP-only cookie, and exchanges the returned one-use code in `GET /api/auth/callback`. Successful exchange still requires a fresh server-confirmed verified email. The callback always returns to `/family` on the configured origin, ignoring supplied `next`/host values; cancelled, expired, mismatched, and unavailable sign-ins return a safe retry message. Authentication never grants membership or administrator rights. The private database independently checks invitations and active memberships.

Existing email-code installations remain supported when `SCRABBLE_AUTH_METHOD` is empty or `email`; the Google endpoints are disabled in that mode. Conversely, the email-code endpoints are disabled in Google mode. Email mode requires a template with the numeric OTP token and a working sender. New Free-tier Supabase projects using default SMTP cannot customize auth templates, and default SMTP is restricted to organization team addresses, so use custom SMTP before offering that legacy flow to family members. See [email OTP setup](https://supabase.com/docs/guides/auth/auth-email-passwordless), [SMTP limits](https://supabase.com/docs/guides/auth/auth-smtp), and the [June 2026 template change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

After the intended owner signs in and verifies **owner@example.test**, inspect that account in the selected Auth project and record its exact UUID. Do not identify the owner by signup order or user-editable metadata. The bootstrap verifies that the given UUID has that exact verified email and is neither deleted nor currently banned.

With the operator connection supplied securely outside the app environment, preview the bootstrap using the exact reviewed identifiers:

```sh
node scripts/bootstrap-family.mjs \
  --family-id '<chosen-family-UUID>' \
  --family-name '<chosen-family-name>' \
  --owner-user-id '<verified-Auth-UUID>' \
  --owner-email 'owner@example.test' \
  --player-name 'Doug'
```

Without `--apply`, this checks the existing identity and prints the proposed family/owner binding without inserting family records. It requires the schema to exist; it does not create Auth users, passwords, database logins, or email invitations. `--help` can be used before configuration to inspect the contract.

Review the dry-run output and target before explicitly authorizing the same command with `--apply`. Applying creates the family, Doug’s profile, linked superadmin membership, and audit entry atomically. An exact rerun detects the existing family; a conflicting family/owner is rejected. The script does not repair, reassign, or elevate an existing family automatically.

## 5. Verify the real family workflow

After configuration and bootstrap, use synthetic acceptance games in the dedicated development target before involving durable family records:

1. Sign in as Doug, invite a second verified account through **Family access**, and have that account accept its invitation. An account link is optional for playing; link profiles only where authenticated profile ownership is desired. A non-invited account must not see family history.
2. Create a normal two-player Family game with an unlinked named guest. Verify immediate scoring and finalization without player approvals or guest email. The scorer must still be authenticated as the designated account; that account can score from any device. Competing turns must respect the current game revision.
3. Record a turn from the designated scorer. Check the observer’s simplified header-free board/scoreboard, accessible cell coordinates, refresh, and interrupted-save retry. Have another active member report a multiline concern for the guest; verify the record hold and absence of member review controls. Clear/uphold concerns as a superadmin with a reason, verify terminal/stale-decision handling, and check that finalized-game review status refreshes automatically. No beta result should enter achievements.
4. Close/reopen the scoring tab. Check retained drafts and identity. Explicitly transfer scoring to another device with a reason, and verify that the old device cannot add new turns. A retained request that already committed may be acknowledged without duplicating its score; unsent entries remain for review.
5. Create an optional Practice game and a private watching link. Verify watching without sign-in, no editing controls, no account/rack data in the response, link replacement/revocation, and expiry. Do not publish a private link in logs or source control.
6. Exercise profile ownership, stale profile revisions, role delegation, last-admin protection, access revocation, account switching in another tab, and superadmin-only administrative export.

The local implementation has server tests for these boundaries, but real Google sign-in (or email delivery for a legacy email installation), project grants, hostname/cookie behaviour, and physical-device acceptance still need this configured-target evidence.

## Backups, export, and recovery

There are three distinct artifacts:

- **Preview JSON export:** local games/profiles from the browser. Clearing browser data still destroys that local store; UI import/restore is not implemented.
- **Shared superadmin JSON archive:** permanent game definitions/events/results, legacy approvals, concerns/decisions, profiles, verified words, and audit evidence. It is a readable archive, not a complete database/Auth/credential restore package. It deliberately excludes runtime secrets and private watch tokens.
- **Operator database backup:** the basis for infrastructure recovery. Define retention, independent storage, access, monitoring, and recovery objectives for the selected project. Include the relevant schema, memberships and login/role restoration, Auth identity continuity, and application configuration in the recovery plan.

The local database suite verifies a logical `pg_dump`/`pg_restore` round trip into a separate test database with matching permanent rows. It does not prove real Supabase disaster recovery, restore the hosted Auth service, validate a production backup schedule, or establish a recovery-time guarantee. Review the actual project’s backup capabilities and limits before choosing a plan; no plan or managed backup has been selected here. See [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

Before shared family release, restore an independently retained backup into an isolated target and verify journal replay, original results, legacy approvals, concerns/decisions, roles, revoked access, and owner sign-in. Avoid restoring over the active family database as a rehearsal. Finalized-game amendments and older-turn correction workflows remain future work; operator access is not a substitute for an application correction trail.

## Local verification checkpoint

The latest completed full checkpoint is **555 passing non-database tests and 28/28 passing real PostgreSQL integration tests**, plus lint, formatting checks, optimized build, and TypeScript. The normal suite skips the database tests; they passed separately against a disposable real PostgreSQL cluster. The full suite includes the regression for valid UUID-shaped display names. PostgreSQL coverage includes both migrations, multiline reasons, the 100th/101st report boundary, immutable reports/decisions, terminal competing decisions, record holds/restoration, unchanged historical results, roles, device ownership, retries, spectator restrictions, and isolated logical restore.

Browser verification with disposable PostgreSQL and a loopback Auth stub exercised a synthetic owner adding Cara by name with no email, starting a normal Family game, and recording CAT for 10 without approvals. A separate member reported a multiline concern for Cara without review controls; a superadmin cleared it with a multiline explanation. Finalization accepted seven-tile leftover racks without approvals, and a subsequent member report automatically appeared as **Under review** on the scorer’s final results. The superadmin upheld that second concern. Reload retained both reports and review reasons, displayed **Excluded from records**, and left final scores at Ada 3 and Cara −7. Scorer and spectator boards each had 225 cells and zero `.board-axis` elements. Desktop and phone screenshots were visually inspected; a 390px spectator viewport had a measured document width of 375px. These browser checks do not establish physical-device acceptance. See [implementation status](implementation-status.md#immediate-games-and-concern-review--september-14-2026) for final evidence and retained earlier screenshots.

The earlier synthetic fixtures below do not establish cloud acceptance. The current hosted migrations and preview are separately recorded in [the provisioning record](shared-provisioning.md); real Google sign-in, owner bootstrap, hosted scoring, anonymous spectator updates, and link revocation have now passed. Multiple real scoring accounts and physical iPhone/iPad acceptance remain pending. Earlier private-link recovery, guest updates, copy, and revocation evidence remains in the status document; old screenshots may show the previous coordinate labels.

Official Supabase changelog, connection, role, Data API, email OTP, and backup guidance were checked on September 14, 2026. Recheck target-specific settings and installed tooling when provisioning; those have not been selected by this milestone.
