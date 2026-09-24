# Amberly Games

A companion with private family access for scoring physical Scrabble games, with shared family history and live spectator boards. Built with Next.js, React, TypeScript and PostgreSQL/Supabase Auth.

The hosted family app is [Amberly Games](https://amberly-games-preview.vercel.app/family). `/family` uses Google sign-in and invited family membership. `/watch#…` is a private, revocable, read-only link; spectators need no account. `/` is a separate local preview stored in this browser’s IndexedDB. Local previews are never uploaded automatically.

## Source and release status

Use the [release ledger](docs/release-status.md) for independently observed deployment state, the current repair candidate, and remaining acceptance gates.

The public source repository is `warfroggyCA/amberly-games-source`. It starts from a sanitized source snapshot; earlier operator notes, personal media and source history remain in a separate private archive. The reliability milestone is included, but source publication does not deploy the hosted app. Consult [release instructions](docs/releasing.md) before deploying.

The proposed [Scrabble Gym practice and training mode](docs/scrabble-training-spec.md) has a feature specification covering freshly generated random two-player puzzles, score and strategy feedback, hints, and practice results saved to player profiles and available across signed-in devices. Future Easy, Medium and Hard modes are captured for later design. Scrabble Gym is the working name, with Scarlett the dog lifting Scrabble-themed weights as a mascot concept. A local engine preview is now implemented; the full release is not complete. See the [build status and benchmark report](docs/scrabble-gym-build-status.md).

The [Scrabble Gym first release plan](docs/scrabble-gym-release-plan.md) sets out the engine prototype, profile sync, practice flow, verification and release sequence. Run `npm run gym:preview` to open the isolated local preview; the launcher prints a same-network iPad URL. It uses port 4321 by default, disables hosted account/storage connections, and exposes `/gym-lab` only with its explicit preview flag. Keep the Mac awake and both devices on the same network.

The local game chooser is at `/gym-lab/games`. With the Gym preview flag enabled, the family hub also shows a Scrabble Gym entry beside Scrabble and Crokinole. Back to games returns to the originating chooser. The original local scorer remains at `/`.

## Fresh checkout

Use Node **24.21.0** and npm. Versions are pinned in the lockfile. Word sources are a separate private artifact accessible only to authorized maintainers; missing or modified sources fail the build rather than selecting another dictionary.

```sh
gh repo clone warfroggyCA/amberly-games-source
cd amberly-games-source
gh release download lexicon-data-v1 --repo warfroggyCA/amberly-games --pattern amberly-lexicons-v1.json.gz --dir /tmp
node scripts/lexicon-artifact.mjs restore /tmp/amberly-lexicons-v1.json.gz
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Cloud credentials are unnecessary for the local preview. To use shared services, configure server-only variables from `.env.example` and follow [shared setup](docs/shared-family-setup.md). Never put an owner connection, database password or service credential into a browser bundle or Git.

The public repository does not grant access to the restricted word assets. Obtain an authorized copy of the pinned inputs before running the complete app. The dictionary is not offered for redistribution.

## Verification

```sh
npm run test:browser:install
npm run check
npm run format:check
```

`check` runs lint, type checking, domain/storage/API tests, real PostgreSQL tests (including concurrent requests, access controls and restore verification), production build and browser flows. Set `SCRABBLE_PG_BIN` to the directory containing PostgreSQL tools; the local default is Homebrew PostgreSQL 17. CI discovers the runner’s installed PostgreSQL tools.

Browser tests own port 4319 and fresh browser contexts. They refuse to reuse an existing server and explicitly disable live cloud configuration. They cover Chromium desktop and WebKit iPhone, iPad and landscape. This is browser emulation, not proof of real-device keyboard or installed-app behavior. `npm test` intentionally skips the real-database suite; `npm run test:database` and CI run it explicitly.

## Data and scoring contracts

- Turns are retained in an append-only journal; undo records a correction. Final results are immutable.
- Shared mutations enforce verified membership, the designated scorer, revision checks and idempotent retries in database transactions. The current scoring tab can take ownership; older tabs retain unsaved work without continuing to write.
- Each game snapshots its physical tile set. Equipment changes affect future games; existing games keep their own quantities.
- The approved custom reference contains **176,974 words**, combining the September 14, 2026 website collection and the 130 additional OSPD5 words. It is not represented as a licensed NWL/OSPD edition. See [word provenance](docs/dependencies.md).
- New games use `amberly-family-v1-2121ea84c411`, a record-eligible reference. Original beta references remain registered with their original test status; nothing promotes or rewrites old history.
- Only shared family games without unresolved/upheld concerns appear in the family record book. Personal word records use finalized human turns. Assisted moves, solo practice and custom sets remain excluded as defined by the domain rules. Wins and clutch awards additionally require a normal unassisted ending.
- A spectator’s live draft is provisional, expires automatically, and never changes confirmed scores.
- Superadmins configure [member permissions and private tests](docs/member-permissions.md). Shared practice games are superadmin-only; removing one preserves original evidence. Confirmed game history remains protected.

## Recovery and operations

Use [backup and recovery](docs/backup-recovery.md) for encrypted operator archives and isolated restore rehearsals. The in-app JSON export is useful evidence, not a complete infrastructure backup. Hosted backup capture/scheduling and off-device key custody must be established separately; a passing local rehearsal does not prove hosted disaster recovery.

[Diagnostics](docs/diagnostics.md) describes failure reports, dictionary resource limits and their boundaries. No third-party tracking service is installed. The deployment provider’s log retention still applies.

Trusted CI uses a read-only deploy key held in a repository secret to read a pinned private word-input commit. It never uploads dictionary files as build or test artifacts. External pull requests receive no such secret and require maintainer review before full verification.


Gym profile history is staged behind `AMBERLY_GYM_HISTORY_ENABLED=true`, alongside the existing Gym entry flag. The signed-in Games entry uses profile persistence after migration `20260924214100_gym_profile_history.sql`; the standalone LAN `/gym-lab` remains an unsaved preview. Do not enable the history flag on a hosted environment until its migration and release are approved. See `docs/scrabble-gym-build-status.md` for validation and limitations.
