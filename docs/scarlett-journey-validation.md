# Scarlett: normal-motion entry and Gym journey

The entry derivative is a tradeoff. It saves 4,425,920 bytes on a cold family-hub
visit that stops there, but adds 2,844,668 bytes when that visit continues into the
Gym. **Recommend holding F17 acceptance until the owner accepts this entry-versus-
journey tradeoff.** The measurements do not justify presenting it as a general
Gym journey optimization. F4 is independent. No application or asset change was
made during this follow-up, and the 360px derivative must not replace the larger
Gym animation to hide the additional download.

## Measured transfers

The [normal-motion receipt](benchmarks/scarlett-journey-2026-10-14.json) contains
five paired profiles: Chromium at 1x and 2x, iPhone portrait at 3x, iPad at 2x,
and iPhone landscape at 3x. These first-journey body-byte counts are identical
across all five profiles:

| Stage                                  | Released entry asset | Candidate entry asset |
| -------------------------------------- | -------------------: | --------------------: |
| Cold `/family`: animation bytes        |            7,270,588 |             2,844,668 |
| Additional animation bytes on Open Gym |                    0 |             7,270,588 |
| Complete cold journey: animation bytes |        **7,270,588** |        **10,115,256** |

Thus the entry card saves **60.9%**, while the first complete normal-motion
journey costs **39.1% more**. Neither first client-navigation journey fetched a
still image. Both visibly animated in the entry card and in the Gym welcome.

The test then uses Back to Games, reopens Gym and reloads Gym once, in the same
browser context. Chromium reused animation bytes throughout those revisits,
with a zero-body 304 revalidation on reload. WebKit fetched the baseline original
again on Back to Games; the candidate reused its two cached animations. On the
first reload, both variants fetched the existing 422,689-byte still selected by
the server's initial render, then displayed the original animation after normal-
motion hydration. Counting all Scarlett bodies over this longer sequence:

| Browser profiles                     |   Baseline |  Candidate |
| ------------------------------------ | ---------: | ---------: |
| Chromium 1x / 2x                     |  7,693,277 | 10,537,945 |
| WebKit portrait / tablet / landscape | 14,963,865 | 10,537,945 |

The receipt preserves each request's phase, response status, conditional-request
flag, completion flag and actual body bytes, retaining partial responses too.
WebKit's extra baseline fetch is an observation in
this harness; its cause and reliability on physical Safari were not established.
Do not use it to erase or generalize away the cold-journey penalty.

As a limited model for initially cold hub visits with at most one Gym opening,
candidate bytes are `2,844,668 + p × 7,270,588`, versus `7,270,588` before. The
break-even Gym-opening fraction is **60.87%**. No real usage distribution was
measured, and this model excludes the longer revisits above, existing caches,
eviction and production cache policies. It is a decision boundary, not an
estimate of household savings.

## High-DPR visual evidence

These comparison sheets contain actual browser crops at their captured device
pixel resolution, without resizing the crops. Each includes two animated entry
poses and the larger welcome. Captures are independently timed, so pose
differences are expected; these are visual review aids, not pixel-diff claims.

- [Desktop Chromium, 180 CSS px entry at 2x](benchmarks/scarlett-desktop-2x.png)
- [iPhone portrait, 144 CSS px entry at 3x](benchmarks/scarlett-iphone-3x.png)
- [iPhone landscape, 180 CSS px entry at 3x](benchmarks/scarlett-landscape-3x.png)

| Profile             | Entry CSS width | Entry physical width | Candidate source width | Gym CSS width / source width |
| ------------------- | --------------: | -------------------: | ---------------------: | ---------------------------: |
| Chromium 1x         |             180 |                  180 |                    360 |                    420 / 640 |
| Chromium 2x         |             180 |                  360 |                    360 |                    420 / 640 |
| iPhone portrait 3x  |             144 |                  432 |                    360 |                  292.5 / 640 |
| iPad 2x             |             180 |                  360 |                    360 |                 357.17 / 640 |
| iPhone landscape 3x |             180 |                  540 |                    360 |                317.375 / 640 |

The derivative covers desktop/tablet 2x entry pixels, but is enlarged 1.2x in
iPhone portrait and 1.5x in landscape. The original animation remains exactly
the approved 640px source in the Gym; even at DPR 1, a 360px source would upscale
at the 420 CSS px desktop welcome. Physical-device visual acceptance remains open.
The source and derivative retain their previously recorded hashes, 120 frames,
identical frame delays, five-second loop and transparency.

Inspection of the sheets found the same framing and recognizable poses, with
softer fine fur and tile-edge detail in the derivative, most apparent at 3x
landscape. The original Gym rendering retains the same source in both variants.
This inspection does not substitute for owner acceptance on a physical device.

## Method and reproduction

Both builds use the saved Cloud executor, pinned Node/Next/lockfile, identical
synthetic family fixtures, viewport, browser version and normal-motion setting.
Each measured case starts in a new nonpersistent context. No Playwright routes
are installed: [routing disables HTTP caching](https://playwright.dev/docs/api/class-browsercontext#browser-context-route).
A loopback fixture server handles every API request locally and passes pages and
assets through to the isolated production Next server. It neither rewrites asset
headers nor supplies its own cache. Observed asset cache control is
`public, max-age=0`. Server body counters distinguish real transfers, 304 responses
and browser reuse. Resource timing is supplementary, because browser reporting
differs. Counts exclude HTTP/TLS headers and unrelated page resources.

The baseline is a controlled F17 comparison: the candidate application built
with the exact `GymEntryCard.tsx` from released commit
`ef8a0d6cfaad42985e0df047b9d8f64340dc3dba`. `GymLab.tsx`, `useGymMotion.ts`,
`gym-lab.css` and `family-hub.css` are byte-identical between that release and the
candidate. Only the entry image URL differs. The receipt records those hashes
and each build ID; it does not claim a complete released-application rebuild.

To reproduce, activate the Cloud tools and prepare the approved lexicon and
sounds. Save the current entry component, temporarily replace it with that
released file, run `npm run build`, and restore the saved component. Run the
journey spec against that baseline build with `AMBERLY_SCARLETT_BASELINE=1` and
`AMBERLY_SCARLETT_JOURNEY_DIR` pointing to a private receipt directory. Then build
the restored candidate and repeat without the baseline flag:

```sh
env -u PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS CI=1 \
  npm run test:browser -- tests/browser/scarlett-journey.spec.ts \
  --project=desktop-chromium --workers=1
python /workspace/amberly-tools/link-webkit-libraries.py
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 CI=1 \
  npm run test:browser -- tests/browser/scarlett-journey.spec.ts \
  --project=iphone-webkit --project=ipad-webkit --project=iphone-landscape --workers=1
```

The tests assert normal motion, both animated images, expected cold-journey
bytes, keyboard Open Gym, unchanged source selection after return/reload and the
640px welcome. They record revisit behavior without assuming every browser must
retain every body. The earlier entry-only spec now explicitly requests normal
motion and checks that Gym selects the original animation.

`node scripts/render-scarlett-journey-evidence.mjs <measurement-directory>`
rebuilds the combined receipt and native-pixel comparison sheets from the
`baseline-build.json`, `candidate-build.json` and `final/before` / `final/after`
receipt/crop directories. It does not modify any application asset.

Initial harness failures exposed missing synthetic usage/word API responses and
an incorrect assumption that all revisits transfer zero animation bytes. The
fixtures were completed and the actual WebKit refetch was retained in evidence.
No application change was made to force those results. Library delivery again
failed with HTTP 401 before upload; the synthetic comparison sheets are included
in this PR. No production cache, physical device, household network, decoded
memory, energy or sustained frame-rate measurement is claimed. SEC-1 remains a
separate dependency-audit warning. No merge or deployment is authorized here.
