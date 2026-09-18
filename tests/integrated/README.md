# Local integrated smoke check

Run `npm run build`, then `node scripts/test-integrated.mjs` with Node 24,
PostgreSQL 17 client/server binaries, and the Playwright Chromium browser installed.
Set `SCRABBLE_PG_BIN` when PostgreSQL is outside the Homebrew default directory.

The harness starts a disposable PostgreSQL cluster on a random loopback port,
applies all application migrations, provisions the existing restricted runtime
role, and starts the production Next server on another random loopback port.
It overrides service configuration with local fixture values. It neither loads
hosted family records nor accepts a hosted database/auth target.

The browser exercises normal sign-in routes and session cookies, invitation
acceptance, new profile creation, Crokinole setup/draft reload/completion, shared
history, and an offline draft whose replay is denied after scoring permission
removal. The denied action is retired, the local draft is retained, and the
member can still view saved scores after reload. Scrabble scoring,
finalization and idempotent retry also pass through real application HTTP routes.
No application API requests are intercepted. Screenshots and failure traces go to
`output/integrated-tests`, separate from the ordinary browser suite.

Only the external Supabase Auth service is simulated: a loopback HTTP fixture
implements the email OTP, verification, user and refresh endpoints for two
synthetic users. This proves application integration with the auth client and
cookie flow (session refresh is not exercised); it does **not** prove real email delivery, OAuth consent, hosted
Supabase configuration, deployment health or physical-device behaviour.

The harness stops its servers and deletes its database on completion or failure.
All generated scores, accounts and invitations belong to the disposable cluster.
