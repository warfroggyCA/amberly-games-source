# Shared animated Scarlett

The selected candidate keeps the original **640 × 640 resolution** and uses one
6,097,124-byte animation in the family entry card, Gym welcome and practice
companion. Recommend this candidate over the initial 360px entry-only proposal:
it removes the first-journey double download and reduces both cold entry and
cold entry-to-Gym bytes by **16.1% versus the released original**. Its first full
journey is **39.7% smaller than the dual-asset proposal**.

This is not a universal win over the 360px option. That smaller entry remains
cheaper for hub-only visits, and the measured WebKit return/reopen sequence also
favours the dual-asset option. The tables below preserve those tradeoffs.

## Encodings evaluated

All candidates derive directly from the approved original, without resizing.
They preserve 120 frames, every frame delay, the 5,000 ms infinite loop, and every
decoded alpha sample across all frames. Alpha quality is 100, minimum-size
animation encoding and high-quality chroma subsampling are enabled.

| Candidate          | Encoder effort |         Bytes | Reduction versus original | PSNR on page background | PSNR on visible pixels |
| ------------------ | -------------: | ------------: | ------------------------: | ----------------------: | ---------------------: |
| Original reference |              — |     7,270,588 |                         — |                       — |                      — |
| **Q82, selected**  |              6 | **6,097,124** |                 **16.1%** |                42.15 dB |               37.39 dB |
| Q86                |              4 |     6,942,154 |                      4.5% |                44.63 dB |               39.88 dB |
| Q90                |              6 |     7,346,638 |                     −1.0% |                48.09 dB |               43.34 dB |

The [encoding receipt](benchmarks/scarlett-shared-encoding-2026-10-14.json)
records settings, hashes, all frame metrics and the comparison method. This is
a candidate comparison; quality and effort both differ. No encoding-speed claim
is made. PSNR compares decoded RGB composited over `#fffcf3`; the visible-pixel
metric excludes fully transparent pixels. The selected candidate's lowest
full-canvas per-frame PSNR is 40.85 dB. RGB is lossy and is not claimed identical.

The [matched-frame detail sheet](benchmarks/scarlett-shared-detail.png) shows
original, selected Q82 and Q86 at native 640px with identical poses. Inspection
retains the face, tile lettering, silhouette and fine features, with small texture
and colour differences at native pixels. Q86 offers greater pixel agreement but
only a small payload reduction; Q90 grows the original. Q82 is the best measured
balance for the requested smaller shared animation.

## Normal-motion journeys and cache reuse

The [three-way journey receipt](benchmarks/scarlett-shared-journey-2026-10-14.json)
compares desktop Chromium at 1x/2x, iPhone portrait at 3x, iPad at 2x and iPhone
landscape at 3x. The original and dual-asset references are the corrected
measurements committed at `9ebb6bb576955fd45622dff59eb133ac99521368`; the new
shared candidate uses the same Cloud tools, browser versions, fixtures,
viewport/DPR and unchanged layout. Reference and new build IDs are recorded.
The only application changes in this follow-up are three animation URLs.

| Animation body bytes, all five profiles |  Original | Dual asset |  Shared 640px |
| --------------------------------------- | --------: | ---------: | ------------: |
| Cold family entry                       | 7,270,588 |  2,844,668 | **6,097,124** |
| Additional bytes on first Open Gym      |         0 |  7,270,588 |         **0** |
| Complete cold entry-to-Gym journey      | 7,270,588 | 10,115,256 | **6,097,124** |

The test then returns to Games, reopens Gym and reloads once. Chromium transfers
no further animation bodies. WebKit refetches the shared full-size animation on
Back to Games, just as it refetched the original; the dual-asset version reuses
its smaller cached entry image. All variants fetch the existing 422,689-byte still
on the first reload's server render before normal-motion hydration. Total
Scarlett body bytes over this longer sequence, including that still:

| Profiles                             |   Original |     Dual asset |  Shared 640px |
| ------------------------------------ | ---------: | -------------: | ------------: |
| Chromium 1x / 2x                     |  7,693,277 |     10,537,945 | **6,519,813** |
| WebKit portrait / tablet / landscape | 14,963,865 | **10,537,945** |    12,616,937 |

Requests are counted by a loopback pass-through fixture server, preserving the
application's `public, max-age=0` headers, validators and response bodies. No
browser routing disables the cache. The receipt records phases, 200/304 status,
conditional requests, completion/partial state and body bytes. These observations
do not establish production cache behavior, household savings or latency; they
exclude HTTP/TLS headers and unrelated resources. Cache policy is unchanged.

## Visual and regression evidence

- [Desktop 2x entry and 420 CSS px welcome](benchmarks/scarlett-shared-desktop-2x.png)
- [iPhone landscape 3x entry and welcome](benchmarks/scarlett-shared-landscape-3x.png)

These are actual browser crops at device-pixel resolution, without resizing.
Poses are independently timed. The shared 640px source covers the entry's
180–540 physical pixels, retaining the original source resolution for the larger
welcome. The welcome remains 420 CSS px on desktop, 292.5 on portrait iPhone,
357.17 on iPad and 317.375 in landscape. High-DPR upscaling of the welcome is the
same as the original; the 360px derivative is never used there.

The new unit assertion checks the original hash, selected hash, dimensions, all
delays, loop, size reduction and exact alpha across every frame. Browser checks
exercise visible motion at entry/welcome/reload, the single-URL cold journey,
keyboard navigation, practice companion, pause/resume and the existing saved
motion behavior. No motion preference or layout behavior changed. Physical-device
acceptance, decoded memory/energy, sustained frame rate and production networking
remain untested.

## Reproduction and preserved inputs

Run `node scripts/prepare-scarlett-animation.mjs` with the pinned installation.
It re-encodes the approved source using the selected settings, validates all
dimensions/timing and exact alpha, and only then replaces the derived file.
Maximum-effort encoding is slow; it is an offline preparation step, not runtime
work. The original remains untouched at SHA-256
`e7c75308723411072bd3f08e82fba6232c7a5cb296b17eea7fdc62a7f085e22e`.
The selected derived SHA-256 is
`08e3c095ee969a9cc69895b5a1bfd39e63fbbbe09f8d245e3b551e53e4902c76`.
The old entry derivative and its evidence remain available as comparison inputs;
current application code uses the shared URL.

Build and run `tests/browser/scarlett-journey.spec.ts`, setting
`AMBERLY_SCARLETT_JOURNEY_DIR` to retain receipts and crops. The default scenario
is `shared`; `AMBERLY_SCARLETT_VARIANT=original` or `dual` supports reproducing the
corresponding historical application asset selections. These flags change
expectations only: the application must first be built with the matching URLs.
Use the established Chromium command without a WebKit override; validate WebKit
libraries before its command-scoped override. Normal motion is explicit.

F4 application code is unchanged. Library upload preflight still fails HTTP 401
before upload, so the synthetic review images are delivered in this PR. SEC-1
remains a separate dependency-audit warning. No merge or deployment is included.
