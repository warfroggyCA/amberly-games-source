# Word data and assisted-search dependencies

Source research below dates from September 13–14, 2026. Shared Supabase and Vercel services have since been provisioned; see README and shared-provisioning.md for current operation. No licensing messages were sent by this research task.

## Active local family word reference

On September 14, 2026, Doug directed this app to use all words from the supplied sources after reviewing their differences. The active default is a **custom family union of 176,974 words**, with legacy beta ID `family-union-20260914-2121ea84c411` and the separately versioned record-eligible ID `amberly-family-v1-2121ea84c411` introduced by the reliability milestone. It includes the 176,844-word Merriam-Webster Scrabble website snapshot and all 130 OSPD5-only entries. All 500 handwritten examples are already included. The original website snapshot and 500-word reference remain separately registered; existing game definitions are never rewritten.

The collection task recorded Doug's statement that he had publisher permission. The permission document was not independently inspected. Private source/generated assets remain excluded from Git history; the source artifact is held in the private repository’s releases and validated by checksums. The approved app has since been deployed and its browser/worker bundle includes these words. The collection notes describe the earlier local integration, not current hosting status. See [collection notes](merriam-collection.md) and [family-list integration](family-word-list.md).

The website snapshot's exact edition is unconfirmed. Neither that snapshot nor the custom union is asserted to be NWL2023 or OSPD7. OSPD5 is retained under its supplied filename and 2014 edition label, without claiming verified provenance. All omissions were checked against the cached browse pages; the collection did not lose them. The approved union deliberately retains those differences, including UNSETTLING and NOTELETS despite the website's contradictory treatment.

## Separate official NWL option: pending permitted asset

The intended word reference is the full **NWL2023**, without an additional school filter. NASPA identifies that as the currently effective official North American edition: <https://scrabbleplayers.org/w/NASPA_Word_List>.

NASPA publishes Community/Developer licensing routes and annual-renewal terms: <https://scrabbleplayers.org/w/Licensing>. Its NWL2023 page describes complete text downloads through Member Services and directs developers to contact NASPA for details: <https://scrabbleplayers.org/w/NWL2023>.

Before shipping official validation, obtain the appropriate agreement through `info@scrabbleplayers.org`, describing this private family PWA, server validation, offline browser caching, and move generation. Confirm permission for derived trie assets, attribution, backups, retaining historical editions, and renewal. Then obtain the authorized full text asset and record its edition, checksum, coverage, and permission reference. Published eligibility/pricing is not evidence this app already holds permission. A personal dictionary download alone does not establish the app's distribution terms.

The older bundled examples remain only for their original saved games. A completed solver search is best **within the exact saved reference**. The custom family list is an explicit user-approved union, not a fallback presented as an official edition. A future official NWL configuration must receive a separate immutable reference and must not relabel existing games.

## Original bounded solver

`src/domain/solver.ts` is original TypeScript code. It enumerates legal placements using a trie, existing board letters, rack multiplicities, perpendicular word checks, and separate physical blank choices. It searches immediate whole-turn score, with ties resolved by more tiles placed and a stable canonical placement key. It does not optimize future strategic equity or draw tiles.

`findMoves` searches the entire supplied `words` set even when returning only the top five. That set must be complete for the identified lexicon. Results distinguish `complete`, `incomplete`, `unavailable`, and `invalid`. Only `complete` with `totalMoves === 0` establishes no legal move. Cancellation or the node budget never creates a pass. The budget counts trie search states; word-asset ingestion is separately bounded. Full official-asset cold-start, memory, and timing measurements remain outstanding.

Quackle and Macondo are useful reference systems but are not embedded. Their GPL code licences are separate from word-data rights. In particular, Quackle explicitly disallows separate use/distribution of certain bundled dictionary files: <https://raw.githubusercontent.com/quackle/quackle/master/LICENSE>. Macondo's licence: <https://github.com/domino14/macondo/blob/master/LICENSE.md>.

## Shared-service prerequisites

Next.js documents Node 20.9 as its minimum, while Supabase's current client support requires Node 22 or newer. Use the project's pinned supported runtime and lockfile: <https://nextjs.org/docs/app/getting-started/installation>, <https://supabase.com/changelog>.

For Supabase SSR, use current `@supabase/supabase-js` and `@supabase/ssr`, publishable browser keys, request-scoped server clients, verified claims, and cookie/cache-header forwarding: <https://supabase.com/docs/guides/auth/server-side/creating-a-client>.

The shared Supabase project, membership policies, Google sign-in and Vercel deployment are configured. Hosted backup scheduling and a hosted restore demonstration remain outstanding; the new operator tool has been verified against disposable database fixtures. The local fixture app must not describe its browser storage as shared family storage or a durable infrastructure backup. No unrelated account resources were inspected for this work.
