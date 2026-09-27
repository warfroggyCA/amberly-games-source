# Family experience update

This candidate is under local verification. It is not a deployment receipt; use the annotated release tag and `docs/release-status.md` to identify the hosted application.

## Players and history

Shared Players has an active list, search by name or nickname, and an Archived list for superadmins. Swipe left to reveal Archive, then tap it; the Actions menu provides the same operation for keyboard and mouse. Archiving and restoring take effect after the server confirms them and offer Undo while the returned revision is still current. An interrupted operation remains in the existing saved-action queue for a safe retry.

Archiving removes a profile from new-game selection, retaining its account access, historical games, profile photo and statistics. Only superadmins can archive, restore or permanently delete profiles; these capabilities cannot be delegated through the member-permissions switches. Invitations and sign-in access are reachable directly from Players. Archiving a profile does not suspend its account.

Permanent deletion is offered only in Archived players. It requires confirmation and an unused profile without membership, invitation, Scrabble, Crokinole or Gym references. Profiles with historical references stay archived. The API and database enforce these restrictions, and an immutable tombstone prevents delayed create retries from resurrecting the deleted ID. Migration 15 and the v3 capability marker are required before the matching API is published; see `releasing.md`.

History rows show participant photos using current profiles matched by player ID. Winners receive a crown, including each member of a winning doubles team and every tied winner. Missing or corrupt winner photos fall back to the crown; other players use initials. Saved participant names remain the fallback if a profile is unavailable. Photos and nicknames do not rewrite historical scores or journals.

The photo editor previews the same crown geometry used by result portraits and share images. Show crown starts on; toggling it leaves the crop unchanged, and the overlay does not capture drag input. The saved 256-pixel image contains only the photo (JPEG for opaque photos, PNG for transparent photos after the transparency migration). Existing cropped photos cannot recover pixels discarded from the original upload.

## Family standings

Overall, Scrabble and Crokinole are selectable views over the existing full-history aggregate. The history list's pagination and player filter do not limit those totals. Overall adds wins and games played across game types; equal wins share a competition rank (1, 1, 3). Ties count as games played but not wins. Each doubles teammate receives the team's result. Win percentage is wins divided by games played, not an average of per-game percentages. Nicknames are displayed and used by Player sorting, with real names only as the fallback. Every column is sortable, and Overall includes a per-game breakdown.

Existing eligibility rules remain: only completed competitive games qualify, excluding private tests, early endings, assistance and unresolved/upheld concerns as defined by the server aggregate.

## Phone Gym

See `scrabble-training-spec.md` for temporary drag zoom, edge panning and cancellation semantics. No draft or game schema is changed by the viewport assistance. Native phone/iPad touch acceptance remains separate from automated browser coverage.

## Lobby music audition

Three composed recordings are offered for selection before choosing the app's track: Agecaf's *Out in Space — Menu* (CC0), Peachtea's *Somewhere in the Elevator* (CC BY 4.0 option), and Eric Matyas's *Hypnotic Puzzle* (CC BY 4.0). The local listening page credits and links each original. Audition copies have matched loudness and a 10 ms overlap at the loop seam; original files are preserved separately. The owner selected B, *Somewhere in the Elevator*, on September 26.

Music has its own device controls, separate from game sound effects. It is intended for lobby/history/players/settings, with silence in game and Gym views. The selected recording is bundled as lossless FLAC, with PCM samples verified identical to the approved audition. Credits, source, licence, modifications and checksums are in `public/music/README.md` and `config/lobby-music.json`. Music defaults on, preserves playback between lobby pages, and fades out for games. The header contains only a mute/unmute toggle; Settings contains the volume slider and a credits link. Mute and volume persist on the device. Returning to a visible lobby resumes unmuted music when permitted; a blocked autoplay attempt retries on the first real tap/click or keyboard interaction.

## Candidate verification — September 26

Local production build and TypeScript passed. The final unit run passed 982 tests; the separate disposable PostgreSQL suite passed 112, including nine archive cases. The affected browser batch covered 132 profile cases: 99 eligible cases passed after updating selectors for the revised UI, with 33 intentional device-specific skips. Final standings layout and retry checks were rerun successfully. The integrated test passed against real local HTTP/auth-cookie handling, a restricted disposable database and browser UI. No hosted records were changed by these checks.

Visual inspection covered phone drag zoom, phone/desktop history, photo framing, exported portraits and phone/iPad standings. Music controller tests cover permission, interruption, async races, fade, timeout and cleanup; the audition page verified playback and isolated selection persistence. The track is now selected; final in-app physical-device listening remains pending. CI, hosted migration rehearsal/application, publication and physical-device acceptance are separate from these local results.

The selected-music follow-up passed its production build, TypeScript, focused lint and formatting, 18 controller/asset tests, and 12 real audio browser cases across all four profiles. Eight existing standings/profile cases also passed with the music control enabled. Browser checks decoded the bundled FLAC and exercised continuous lobby navigation, game entry, background interruption, volume persistence and the narrow-screen menu. Protected CI passed for the preceding feature commit `4e546ec`; the music follow-up requires its own exact-commit run.
