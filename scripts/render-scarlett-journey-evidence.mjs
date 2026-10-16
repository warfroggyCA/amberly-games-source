import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

// Input: private measurement directory containing baseline-build.json,
// candidate-build.json and final/{before,after} Playwright receipts/crops.
// Output: synthetic review evidence only; never changes application assets.
const root = process.argv[2];
if (!root)
  throw new Error("Provide the Scarlett journey measurement directory");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const profiles = [
  ["desktop-chromium", 1],
  ["desktop-chromium", 2],
  ["iphone-webkit", 3],
  ["ipad-webkit", 2],
  ["iphone-landscape", 3],
];
const samples = [];
for (const [profile, dpr] of profiles) {
  const pair = {};
  for (const variant of ["before", "after"])
    pair[variant] = await json(
      join(root, `final/${variant}`, `${variant}-${profile}-${dpr}x.json`),
    );
  if (
    pair.before.coldJourneyAnimationBytes !== 7270588 ||
    pair.after.coldJourneyAnimationBytes !== 10115256
  )
    throw new Error(
      `This receipt is scoped to the reviewed F17 assets: ${profile}`,
    );
  if (
    JSON.stringify(pair.before.viewport) !== JSON.stringify(pair.after.viewport)
  )
    throw new Error(`Viewport mismatch: ${profile}`);
  for (const key of [
    "cssWidth",
    "cssHeight",
    "physicalWidth",
    "devicePixelRatio",
  ])
    for (const geometry of ["entryGeometry", "welcomeGeometry"])
      if (pair.before[geometry][key] !== pair.after[geometry][key])
        throw new Error(`Geometry mismatch: ${profile} ${geometry} ${key}`);
  samples.push(pair);
}

const sheets = [
  ["desktop-chromium", 2, "Desktop Chromium at 2x", "scarlett-desktop-2x.png"],
  ["iphone-webkit", 3, "iPhone portrait at 3x", "scarlett-iphone-3x.png"],
  [
    "iphone-landscape",
    3,
    "iPhone landscape at 3x",
    "scarlett-landscape-3x.png",
  ],
];
const visualEvidence = [];
for (const [profile, dpr, title, filename] of sheets) {
  const { after } = samples.find(
    (pair) =>
      pair.after.project === profile && pair.after.devicePixelRatio === dpr,
  );
  const layers = [],
    crops = [];
  let y = 195;
  let text = `<text x="28" y="45" font-size="32" font-weight="bold">Scarlett — ${title}</text><text x="28" y="83" font-size="21">Normal motion. Native device-pixel crops; independently timed poses. Original Gym animation unchanged.</text><text x="28" y="125" font-size="23" font-weight="bold">Released entry (640px source)</text><text x="1078" y="125" font-size="23" font-weight="bold">Candidate entry (360px source)</text><text x="28" y="158" font-size="20">Cold journey: 7,270,588 animation bytes</text><text x="1078" y="158" font-size="20">Cold journey: 10,115,256 animation bytes (+39.1%)</text>`;
  for (const [row, phase] of [
    "family-cold-a",
    "family-cold-b",
    "gym-first-a",
  ].entries()) {
    const buffers = await Promise.all(
      ["before", "after"].map((variant) =>
        readFile(
          join(
            root,
            `final/${variant}`,
            `${variant}-${profile}-${dpr}x-${phase}.png`,
          ),
        ),
      ),
    );
    const metadata = await Promise.all(
      buffers.map((buffer) => sharp(buffer).metadata()),
    );
    for (const [index, variant] of ["before", "after"].entries()) {
      const name = `${variant}-${profile}-${dpr}x-${phase}.png`;
      const pair = samples.find(
        (value) =>
          value.after.project === profile &&
          value.after.devicePixelRatio === dpr,
      );
      if (
        pair[variant].images.find((image) => image.name === name)?.sha256 !==
        sha(buffers[index])
      )
        throw new Error(
          `Screenshot does not match its measurement receipt: ${name}`,
        );
    }
    const label =
      row < 2
        ? `Entry pose ${row + 1}: ${after.entryGeometry.cssWidth} CSS px × ${dpr} DPR = ${after.entryGeometry.physicalWidth} physical px`
        : `Gym welcome: ${after.welcomeGeometry.cssWidth} CSS px; original 640px source in both`;
    text += `<text x="28" y="${y + 22}" font-size="21">${label}</text>`;
    y += 40;
    for (let column = 0; column < 2; column++) {
      layers.push({ input: buffers[column], left: 28 + column * 1050, top: y });
      crops.push({
        variant: column ? "after" : "before",
        phase,
        width: metadata[column].width,
        height: metadata[column].height,
      });
    }
    y += Math.max(...metadata.map((value) => value.height)) + 35;
  }
  const width = 2100,
    height = y + 45;
  text += `<text x="28" y="${height - 20}" font-size="18">Synthetic fixture; no private family data. Open at 100% for source-pixel inspection. Physical-device acceptance remains open.</text>`;
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g font-family="DejaVu Sans, sans-serif" fill="#173b2d">${text}</g></svg>`,
  );
  const bytes = await sharp({
    create: { width, height, channels: 3, background: "#f7f5ec" },
  })
    .composite([...layers, { input: svg, left: 0, top: 0 }])
    .png()
    .toBuffer();
  const path = join("docs/benchmarks", filename);
  await writeFile(path, bytes);
  visualEvidence.push({
    path,
    bytes: bytes.length,
    sha256: sha(bytes),
    width,
    height,
    crops,
  });
}

const sourceAssets = [];
for (const name of [
  "scarlett-lift.webp",
  "scarlett-entry.webp",
  "scarlett-lift-still.png",
]) {
  const path = join("public/gym", name),
    bytes = await readFile(path);
  sourceAssets.push({ path, bytes: bytes.length, sha256: sha(bytes) });
}
const receipt = {
  scope:
    "Normal-motion cold /family -> Open Gym, then Back to Games -> Open Gym -> one Gym reload; response body bytes for all Scarlett assets.",
  baseline: await json(join(root, "baseline-build.json")),
  candidate: await json(join(root, "candidate-build.json")),
  versions: {
    node: process.version,
    next: (await json("node_modules/next/package.json")).version,
    playwright: (await json("node_modules/@playwright/test/package.json"))
      .version,
  },
  method: {
    browserRouting: false,
    fixtures:
      "Synthetic APIs handled by loopback pass-through server; no API reaches application or production; asset headers/body preserved.",
    context:
      "Fresh nonpersistent context for each variant/profile; no throttling.",
    byteCounter:
      "Proxy counts Scarlett response body chunks, retaining partial responses with completed=false and zero-body 304 responses; memory/cache reuse yields no server request.",
    motion:
      "no-preference explicitly; no stored motion preference; different screenshot bytes 700ms apart asserted in entry, welcome and reload.",
    cacheControl: "public, max-age=0",
    limits: [
      "No production/CDN cache verification",
      "No physical-device acceptance",
      "No network latency, decode, memory, energy or frame-rate claim",
      "No HTTP/TLS header bytes or unrelated page resources included",
    ],
  },
  sourceAssets,
  summary: {
    coldEntryBefore: 7270588,
    coldEntryAfter: 2844668,
    coldJourneyBefore: 7270588,
    coldJourneyAfter: 10115256,
    coldJourneyIncreasePercent: (100 * 2844668) / 7270588,
    entryReductionPercent: 100 * (1 - 2844668 / 7270588),
    firstReloadStillBoth: 422689,
    coldVisitGymOpenBreakEvenFraction: 1 - 2844668 / 7270588,
    recommendation:
      "Hold F17 acceptance pending explicit acceptance of the entry-versus-journey tradeoff; do not replace the larger Gym animation with the 360px derivative.",
  },
  samples,
  visualEvidence,
};
await writeFile(
  "docs/benchmarks/scarlett-journey-2026-10-14.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(
  `Wrote ${samples.length} paired receipts and ${visualEvidence.length} native-pixel comparison sheets.`,
);
