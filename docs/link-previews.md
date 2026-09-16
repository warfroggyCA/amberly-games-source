# Shared-link previews

Status: Published and verified at the usual Amberly Games preview domain on 2026-09-15.

Amberly provides static Open Graph and large-image Twitter card metadata in the initial HTML head. The root and /family title is **Amberly Games**. The /watch title is **Watch the game live · Amberly Games**, with copy describing the board, scores and no-sign-in viewing.

The share artwork is public brand artwork, not a snapshot of a private game. Existing /watch#token links are unchanged: no preview endpoint reads a token, session, player list or score. No canonical/og:url override is added to alter a shared destination. Existing noindex/nofollow metadata and app icons remain. SCRABBLE_APP_ORIGIN supplies the image's absolute origin; localhost remains the fallback for local-only setup.

## Artwork

- Deployed asset: public/social/amberly-games-v1.jpg
- 1200 × 630 JPEG, 125,158 bytes, optimized with the existing Sharp dependency.
- Created with the built-in image-generation tool; no external image-generation CLI/API was used.
- Source: /path/to/local/.codex/generated_images/01a09d72-eaef-7bd1-a690-a8eb904bf456/exec-75c76bef-81b3-4060-b4fe-5d07c2de80d7.png
- Reference: previously approved near-overhead Amberly concept. No user screenshot or private game data is in this card.

### Initial prompt

Use case: ads-marketing
Asset type: finished website Open Graph link-preview artwork for Amberly Games, wide 1200 by 630 composition (1.905:1).
Input image: approved Amberly game concept, a reference for the existing forest green brand typography, A and G Scrabble tile wordmark, mitered honey brown board, ivory tiles, soft near-overhead camera and subtle golden magic. Do not reproduce the screenshot UI or any private player names/scores.
Primary request: a beautifully polished, immediately readable branded preview image for a shared link in iMessage. Create a new editorial composition, not a phone mockup or browser screenshot.
Composition: warm pale ivory tabletop filling the image. Left half has large elegant forest green serif wordmark on two lines: "Amberly" then "Games", with only the initial A and initial G each on an authentic glossy ivory Scrabble tile (small A1 and G2 points), completing the words naturally with the other letters in the serif type. A smaller clean forest-green "Scrabble" beneath the logo. Right half shows a tightly cropped but recognizable near-overhead wooden Scrabble board with the existing teal/coral/ivory squares, beautiful beveled honey wood frame, and a short readable row of actual ivory letter tiles spelling "PLAY" with P3 L1 A1 Y4. A tasteful gold sparkling arc follows those tiles. Leave clean margins around all lettering. The board can intentionally continue beyond the right/lower edge. Keep composition readable as a small thumbnail.
Style: premium realistic tabletop game materials, warm daylight, dimensional shadows, closely match reference's material character. Tiny glints only; do not clutter.
Text verbatim: "Amberly" "Games" "Scrabble" "PLAY". No other title, numbers, player names, invented logos, buttons, browser chrome, fake scoreboard, coffee, books, people, or family photograph. This is static brand artwork, not a real live game snapshot.

### Final refinement prompt

Use case: precise-object-edit. This is the final Amberly Games link-preview card. Remove ONLY the green leaves in the upper-left corner and the two loose blank tiles (top center and lower center), replacing those areas seamlessly with the same softly lit ivory tabletop. Keep EVERYTHING else exactly unchanged: same wide dimensions, exact Amberly Games tile wordmark, Scrabble subtitle, board crop, word PLAY with P3 L1 A1 Y4, golden sparkle arc, bag bottom-left, lighting, camera, proportions and margins. No new objects, text or logos. The owner prefers a clean table with no greenery. Return only the finished artwork.

## Verification

- Targeted ESLint and Prettier checks passed.
- Optimized Next build and TypeScript passed; /, /family and /watch remain prerendered.
- Parsed all three generated HTML heads without JavaScript: distinct titles, absolute matching OG/Twitter image URLs, correct image dimensions/type and retained noindex/nofollow.
- Browser checked /watch without a token: expected incomplete-link message, complete metadata, no console errors. The JPEG was publicly readable and visually inspected in the browser at its actual 1200 × 630 dimensions.
- Game logic, saved history, permissions and shared-link creation/revocation are unchanged. No hosted games or accounts were modified to verify this visual metadata change.
- Actual iMessage presentation is not verified on a physical device. Apple controls the card layout. Previously sent messages may retain their prior preview; judge a freshly shared link after publication.

## References

Apple documents using og:title and og:image to provide rich previews in Messages: https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages/
Next API guidance was read from the installed package: node_modules/next/dist/docs/01-app/01-getting-started/14-metadata-and-og-images.md and the opengraph-image and generate-metadata API references.



## Publication — 2026-09-15

Published after explicit approval as READY Vercel preview dpl_FCYLUv3xYuZ4cwwDxMJmggRAtY2D (https://amberly-games-bwa8myjo6-dougs-projects-e9ca299b.vercel.app). The usual amberly-games-preview.vercel.app alias was assigned, then independently inspected: matching ID, target preview, Ready status. Hosted install/build/TypeScript passed. Browser verification on the stable domain confirmed the new /watch and /family titles, absolute HTTPS Open Graph image URL, large-image Twitter card, retained noindex/nofollow, signed-out Google sign-in entry, and accessible 1200 × 630 JPEG. The actual hosted artwork was visually checked. No shared game, authentication configuration or history was changed. Physical iMessage card presentation remains unverified.
