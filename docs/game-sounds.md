# Game sounds

The September 26 audition selections are implemented for Scrabble's scorer, signed-in viewers and private watch links. This is an implementation record, not a deployment receipt.

| Event | Mixkit recording | Item |
| --- | --- | --- |
| Score | Fairy glitter | 867 |
| Bingo | Orchestra trumpets ending | 2292 |
| Winner | Orchestra triumphant trumpets, then Cheering crowd loud whistle | 2285, 610 |
| Tie | Ethereal fairy win sound | 2019 |
| Your turn after a play (signed-in linked player only) | Achievement bell | 600 |

Start, pass, exchange, pause, resume, correction and scorer attention remain silent. The turn bell follows the score/bingo cue only on devices signed in as the linked player whose turn is beginning, except when ending the game or no player changed. Other signed-in players, unlinked accounts, local games and anonymous viewing links do not receive the turn bell. Score, bingo, winner and tie celebrations remain shared on every sound-enabled device. Only contiguous, saved revisions trigger sound. Initial loads, historical results, corrections, undo, background catch-up, connection recovery and multi-revision catch-up are silent. No private journal data is added to spectator responses.

Each device must tap **Enable game sounds** in its game tools. This unlocks browser audio and loads the assets; it never replays old events. **Mute game sounds** immediately cancels playback, including queued celebrations. Audio failure offers **Retry game sounds** without blocking scoring. Enabling is per mounted game screen/session, so a refresh may require another tap. Device volume controls the output. Browser suspension may also require Retry. Crokinole and Gym sounds are outside this Scrabble audition scope.

## Audio packaging and licence

Source and SHA-256 receipts: `config/game-sounds.json`. Official downloads are used, not third-party preview streams. The sound-effects licence at https://mixkit.co/license/modal/sfxFree/ permits incorporation into games but prohibits redistribution as standalone stock or with source files. Accordingly, WAV recordings are excluded from Git; `npm run sounds:prepare` fetches and checks the pinned approved files into `public/sounds/` for incorporation into the built app. It runs before dev/build, uses verified local files when present, retries downloads and fails the build on missing/changed assets. A fresh build requires access to assets.mixkit.co; deployed gameplay serves audio from the app's own origin. Do not commit the recordings or audition copies to the public repository.

Playback uses short excerpts with fades and reduced gain (especially crowd and turn cue); original licensed files remain unmodified. Selection does not establish physical-device acceptance of the final timing/mix. Check scorer and viewer devices with audio enabled before publishing.

## Local validation, September 26

- TypeScript, focused ESLint, production build, and pinned Node download verification passed.
- Unit suite: 930 passed, 105 skipped (database/integration suites require their separate harness).
- Targeted browser regression run: 20 passed across desktop Chromium, iPhone WebKit, iPad WebKit and iPhone landscape, including keyboard layout and spectator reconnection.
- Final sound-specific run: 12 passed across those profiles, including real AudioContext decoding of all six recordings. Event assertions instrument playback; decoding checks use the browser audio implementation.
- Physical-device listening/mix acceptance, full release checks, protected CI and deployment are not established by these local results.

## Personal turn-bell refinement

The linked player ID already returned by family sign-in now limits the turn cue to that player. It does not affect shared celebrations and adds no identity fields to anonymous spectator responses. Local verification of this refinement passed TypeScript, focused lint, formatting, production build, 931 unit tests and 20 sound browser tests across all four profiles. The prior complete browser run passed 364 tests with 32 profile-specific skips; the revised commit still requires its own protected CI before publication.
