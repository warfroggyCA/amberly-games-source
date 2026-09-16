# Reliability milestone — implemented, pending release

The original `baseline-2026-09-16` and development history remain in the private archive. The sanitized source is published independently as `warfroggyCA/amberly-games-source`. Existing deployments remain unchanged until this milestone is verified and approved for publication.

## Deliverables

- [x] Sanitized source repository and private historical baseline; credentials, personal media and original word assets excluded from public source.
- [x] Pinned private word artifact; clean-checkout reproduction on Node 24.
- [x] CI: lint, type checking, unit tests, real PostgreSQL tests, build, desktop and mobile browser tests.
- [x] Versioned record-eligible reference for new games; old dictionaries and history unchanged.
- [x] Bounded official-word requests and privacy-conscious failure diagnostics.
- [x] Encrypted operator backup and isolated restore rehearsal with integrity comparisons.
- [x] Small, test-protected UI responsibility extraction.
- [x] Current setup/recovery/release documentation.

## Boundaries

Browser emulation is not physical iPhone/iPad acceptance. Disposable-database restore verification is not proof of a hosted backup. No production history migration, automatic deployment, privileged backup credentials, or external monitoring service is introduced implicitly. Historical migration identifiers differ between the hosted database and local source: do not blindly run a database push.

## Verification on Node 24.21.0

- 705 unit/domain/storage/API checks passed.
- 37 real PostgreSQL checks passed, including encrypted operator recovery and table-by-table content comparisons.
- 24 production-mode browser scenarios passed across desktop Chromium and iPhone, iPad and landscape WebKit.
- Lint, strict type checking, formatting and production build passed.
- Tests identified and fixed a landscape toolbar hit area that intercepted lower-board taps.
- Browser auth/shared-service responses are controlled fixtures; real authorization and mutation behavior is covered by the database/API suites. No new live Google sign-in or physical-device acceptance is implied.

The first Linux run passed 22/24 browser scenarios; two longer flows exhausted the overall 45-second test budget after successful steps. Traces were retained and reviewed. CI runs one browser worker with a 90-second scenario budget, 10-second individual-action limits and no retries.

The GitHub workflow is the clean-checkout release gate; its run is linked in the pull request. All browser tests use isolated storage and disable live database configuration.

## Remaining operational work

- Configure a hosted backup operator, off-device encrypted storage/key custody and an approved schedule; capture and rehearse an actual hosted snapshot.
- Choose an external alerting destination/retention if durable operational alerts are wanted. Current diagnostics use provider logs only.
- Obtain approval for promotion; no live application code or family database was changed by this branch.
