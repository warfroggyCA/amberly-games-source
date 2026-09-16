# Family word-list integration

September 14, 2026. Local implementation only; no deployment or public redistribution.

## Approved dictionary policy

Doug reviewed the 130 OSPD5 words absent from the collected website list and explicitly selected **"Include all words from all lists."** New games therefore use a named, versioned family union, not an asserted official publisher edition.

| Source | Unique words | Treatment |
| --- | ---: | --- |
| Merriam-Webster Scrabble website, collected September 14, 2026 | 176,844 | Every entry retained; exact edition unconfirmed |
| User-supplied OSPD5 download | 109,928 | Every entry retained; 109,798 overlap with the website and 130 add to it |
| Original development examples | 500 | Every entry already appears in the combined set |
| **Combined family list** | **176,974** | Default for new games |

There are 67,046 website-only entries relative to OSPD5. Comparison uses trimmed ASCII spelling tokens, uppercase normalization, explicit inflections already present in each file, duplicate rejection and pinned input checksums. It does not invent inflections, remove words based on meaning, or reinterpret the publisher's edition.

## Preserved evidence

- OSPD5: `docs/OSPD5.txt`, SHA-256 `3ce3d783aaeb4f8f1e430c10cfb5bfdac937d39b5903f441e7f89b1b8e3de29e`.
- Website: `data/lexicons/merriam-2026-09-14/words.txt`, SHA-256 `446ea664837d752bba96d451b526d2fafc7050b63775e5ad17f6eaebdcce2c5b`.
- Collector indexes, all 627 cached responses, and coverage report remain beside the website file. An independent extraction of all 601 word pages matched the source exactly.
- Complete shared, website-only and OSPD5-only files and counts/checksums: `data/lexicons/comparisons/ospd5-merriam-2026-09-14/`.
- Omission investigation: `data/lexicons/merriam-2026-09-14/comparison-investigation.json`.
- Combined words and policy/source manifest: `data/lexicons/family-2026-09-14/`.

UNSETTLING and NOTELETS are retained as approved family additions even though the website rejects them while also listing them as grammatical forms. CAPRI and EDUCABLES have different grammatical treatment on the website. The precise editorial reason for every other difference remains unconfirmed; those differences are intentionally retained under the approved union policy.

The collection task recorded the owner's statement that publisher permission had been received. The permission document was not independently inspected. Source and generated word assets are excluded from Git. Generated word data is included in the locally served browser and worker bundles. This integration does not authorize or perform publication.

## Versioning and history

The family list has ID `family-union-20260914-2121ea84c411`, edition `Family union 2026-09-14 (website + OSPD5)`, and SHA-256 `2121ea84c411851c7f3239c27b0832a50c69ad483de83bca386beb973eeaee58` for sorted uppercase words, one per line with a final newline.

The registry also retains the separate exact website snapshot and the original `development-examples` edition `1`. Metadata must match ID, edition and status exactly. Existing game definitions, original events, scores and drafts are not migrated. Missing or altered references stop restoration/writes while preserving the stored copy. Ordinary scoring, live word feedback, ending review, worker suggestions and assisted-pass verification all resolve the game's own reference and its recorded verified additions. The base asset, ID, edition and original turns remain unchanged when additions are appended; a global catalog does not retroactively rewrite earlier scores.

The registry's existing `test` status is retained for these local-preview dictionaries so installing a larger asset does not promote local games into competitive records. UI text identifies the actual family reference and size; it does not present the combined list as 500 examples. A later shared production milestone must explicitly establish records eligibility and any approved production references.

## Explicit official-site lookup and verified additions

The local app has a separate official-site lookup box. It calls `GET /api/official-word?word=ONYX`; the server accepts only 2–15 ASCII letters and constructs a URL under `https://scrabble.merriam.com/finder/`. It never accepts a caller-provided URL, follows redirects, sends cookies, or renders returned HTML. The upstream request has an 8-second timeout and a streamed 512 KB response limit. The client supports cancellation and a 12-second timeout. Responses are not cached.

The adapter requires the exact requested canonical URL and the dedicated `play_area` verdict for that same word. A definition, grammatical inflection, or playable anagram is insufficient. Live verification on September 14 confirmed ONYX as playable and NOTELETS as not playable; NOTELETS remains in the approved family union under Doug's separate union policy. An official-site negative does not silently delete an approved family word. Network errors, changed page structure, mismatches, oversized responses and unclear verdicts return an error rather than approval or rejection of the spelling.

Only an explicit positive lookup may enter the verified-additions workflow. The saved evidence contains `word`, `source: 'merriam-webster'`, the fixed-origin `sourceUrl`, and `verifiedAt`. The result's `playable` flag is removed before persisting the strict evidence object. Accepted additions are retained in the local catalog for future games and appended as audited commands to the active game before use. The catalog is bounded to 10,000 entries and each game command to 32 confirmations. There is no history-delete operation or silent replacement of the base dictionary. Storage/revision failures must preserve entry for retry instead of claiming the word was saved.

Scoring, word outlines, worker suggestions and assisted-pass verification use the effective base-plus-additions reference. The worker receives both the pinned base metadata and the game's verified entries, validates the entries, and includes them in enumerable search. A malformed confirmation or unavailable base fails explicitly. Repeated expansion of an unchanged frozen base/addition set reuses the prepared reference for replay performance.

This evidence is local provenance, not a cryptographically authenticated publisher response or server-secured journal. Local storage, profile photos/biographies and game history remain on the current device/origin; there is no authenticated family synchronization, self-edit authorization or deployed shared service. A future shared backend must verify authority rather than trusting editable local evidence.

## Preparation and runtime

Run `npm run lexicon:prepare` with the project's Node24 runtime. It validates source and legacy hashes, coverage metadata and expected counts; writes reproducible comparison outputs; and prepares ignored JSON assets. npm also runs this before dev, build, tests and type checking. A missing or changed source fails explicitly instead of silently substituting a list. Preserve every issued reference when introducing later versions.

Ordinary membership uses in-memory sets, with no API request per word or keystroke. Network access occurs only through the explicit official-site lookup workflow. The app provides an exact-word check and the list of family additions without rendering 176,974 entries into the page. Move search runs in a cancellable worker using the game's explicit dictionary metadata. Immutable validated tries are reused within a runtime, and search prunes starts that cannot connect to the board with the available rack.

The dedicated worker is bounded by 2 million search nodes and a 30-second timeout; cancellation terminates the worker. An incomplete search is not reported as the highest-scoring result and does not record an automatic move or pass. Assisted-pass validation stops as soon as it finds a legal witness; reporting no legal move still requires a completed search. Representative Mac search timings with the approved full union were 164/33 ms fresh/cached for opening READING and 110/39 ms for midgame RETAINS. Two-blank AEIRS?? completed in 2.32 seconds opening (440,216 nodes) and 1.20 seconds midgame (1,187,359 nodes). Existence verification found legal witnesses in 56–398 nodes, rounded 0–1 ms cached, while retaining its 250,000-node bound for unknown outcomes. See [implementation status](implementation-status.md) for the precise verification checkpoint and limitations. These are desktop search measurements, not a guarantee every rack completes or physical iPhone/iPad acceptance.
