# Amberly Games app icon

The icon uses Amberly’s forest green, wooden board frame, multiplier-square colors, and large A₁/G₂ letter tiles. Letters are vector paths, so rendering does not depend on fonts installed on the build host.

- Editable source: `public/icon.svg` (512 × 512).
- Browser favicon: `public/icons/amberly-board-v1-32.png` and versioned SVG URL.
- iPhone/iPad home screen: `public/icons/amberly-board-v1-180.png` through `apple-touch-icon`.
- Web manifest: 192px and 512px PNGs; a separate maskable entry uses the same opaque 512px source. Essential tile artwork stays inside the central 80%-diameter circle; the board background may be cropped by the operating system.
- App name: Amberly Games. Standalone display is declared. The manifest explicitly sets `id` and `start_url` to `/family`, with scope `/`, so shared installations launch the shared entry. The signed-in app initially shows Home even when the latest selected game belongs to another scoring device. Header wordmarks also return Home without clearing game data.

The existing Sharp dependency exports opaque PNGs from the SVG. Regenerate from the project root after an artwork change:

```sh
node --input-type=module <<'JS'
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
await mkdir('public/icons', { recursive: true });
for (const size of [32, 180, 192, 512]) {
  await sharp('public/icon.svg', { density: 288 })
    .resize(size, size)
    .removeAlpha()
    .png()
    .toFile(`public/icons/amberly-board-v1-${size}.png`);
}
JS
```

Use a new filename version and update layout/manifest references for future replacements. Already-saved home-screen icons may retain their previous artwork; confirm the new icon when saving a new shortcut. Do not clear site data to refresh an icon: that could remove local-only games.

## Verification — September 14, 2026

- Artwork inspected at 512px, 180px, and 32px.
- PNG dimensions, opaque backgrounds, HTTP content types, layout metadata, and manifest references checked against the built local server.
- TypeScript, focused ESLint, Prettier, and optimized build passed. No scoring or data-model changes; the full game suite was not repeated for this icon-only change.
- Hosted preview `dpl_6YxNr1wtGhqndFfcnmtk9Jbw547C` is READY; all four deployed PNG checksums matched the local assets.
- Physical iPhone/iPad home-screen installation and Android masking remain unverified.

References: [Apple webpage icons](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html), [maskable icon safe area](https://web.dev/articles/maskable-icon), and [manifest launch URL fallback](https://w3c.github.io/manifest/#start_url-member).

## Home launch follow-up — September 14, 2026

Preview `dpl_Htb6iGuNxY5YDn2ibHyvFCrHwUmc` and the stable preview alias serve the explicit `/family` launch URL. Fresh signed-in loading and brand navigation back from a saved result were verified in the hosted browser. Existing shortcuts may retain an older document or installation metadata; physical iPad relaunch remains unverified. Reload the updated app without clearing website data.
