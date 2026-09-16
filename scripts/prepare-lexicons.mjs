import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testLexicon } from "../src/lib/test-lexicon.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = {
  ospd5: {
    path: "docs/OSPD5.txt",
    label:
      "User-supplied OSPD5 download (2014 edition label; provenance unverified)",
    sha256: "3ce3d783aaeb4f8f1e430c10cfb5bfdac937d39b5903f441e7f89b1b8e3de29e",
    count: 109928,
  },
  website: {
    path: "data/lexicons/merriam-2026-09-14/words.txt",
    label: "Merriam-Webster Scrabble website word list",
    sha256: "446ea664837d752bba96d451b526d2fafc7050b63775e5ad17f6eaebdcce2c5b",
    count: 176844,
  },
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function readSource(source, definitions) {
  let bytes;
  try {
    bytes = readFileSync(resolve(root, source.path));
  } catch {
    throw new Error(
      `Required private word asset is missing: ${source.path}. Restore the original asset; no replacement dictionary will be substituted.`,
    );
  }
  if (hash(bytes) !== source.sha256)
    throw new Error(
      `Word asset checksum changed: ${source.path}. Review it as a new version; do not replace a historical dictionary.`,
    );
  const lines = bytes
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const words = lines.map((line, index) => {
    const token = definitions ? line.trim().split(/\s+/)[0] : line.trim();
    // ASCII validation precedes case normalization: Unicode expansions are not tiles.
    if (!/^[A-Za-z]{2,15}$/.test(token))
      throw new Error(`Malformed word in ${source.path}:${index + 1}`);
    return token.toUpperCase();
  });
  const set = new Set(words);
  if (set.size !== words.length || set.size !== source.count)
    throw new Error(`Unexpected count or duplicate word in ${source.path}`);
  if (
    !definitions &&
    words.some((word, index) => index > 0 && word <= words[index - 1])
  )
    throw new Error(`Website asset is not strictly sorted: ${source.path}`);
  return {
    words: set,
    definitions: definitions
      ? Object.fromEntries(
          lines.map((line, index) => {
            const definition = line.trim().slice(words[index].length).trim();
            if (!definition || definition.length > 1000)
              throw new Error(
                `Malformed definition in ${source.path}:${index + 1}`,
              );
            return [words[index], definition];
          }),
        )
      : null,
  };
}
function save(path, text) {
  const target = resolve(root, path);
  if (existsSync(target) && readFileSync(target, "utf8") === text) return;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, { encoding: "utf8", mode: 0o600 });
}

const oldSource = readSource(sources.ospd5, true);
const old = oldSource.words;
const website = readSource(sources.website, false).words;
// Definitions remain server-only. A word-details request receives one entry;
// the complete private source never joins the scoring client bundle.
save(
  "src/lib/generated/ospd5-definitions.json",
  `${JSON.stringify(oldSource.definitions)}\n`,
);
const coverage = JSON.parse(
  readFileSync(
    resolve(root, "data/lexicons/merriam-2026-09-14/report.json"),
    "utf8",
  ),
);
if (
  coverage.sha256 !== sources.website.sha256 ||
  coverage.unique_word_count !== website.size ||
  coverage.expected_pages !== 601 ||
  coverage.validated_pages !== 601 ||
  !Array.isArray(coverage.failed_pages) ||
  coverage.failed_pages.length
)
  throw new Error(
    "Website collection coverage report does not match the pinned asset.",
  );

const groups = {
  shared: [...old].filter((word) => website.has(word)).sort(),
  "website-only": [...website].filter((word) => !old.has(word)).sort(),
  "ospd5-only": [...old].filter((word) => !website.has(word)).sort(),
};
const comparison = "data/lexicons/comparisons/ospd5-merriam-2026-09-14";
const outputs = {};
for (const [name, words] of Object.entries(groups)) {
  const text = `${words.join("\n")}\n`;
  save(`${comparison}/${name}.txt`, text);
  outputs[name] = {
    count: words.length,
    path: `${name}.txt`,
    sha256: hash(text),
  };
}
save(
  `${comparison}/report.json`,
  `${JSON.stringify(
    {
      version: 1,
      sources,
      normalization:
        "Trim lines; parse first token for OSPD5 definitions; require ASCII A-Z/a-z and length2-15 before uppercasing; reject duplicates. No stemming, inflection expansion or union.",
      websiteEdition: "Unconfirmed; do not identify as OSPD7 or NWL2023",
      websiteCollectedAt: coverage.completed_at,
      outputs,
      investigation: "../../merriam-2026-09-14/comparison-investigation.json",
    },
    null,
    2,
  )}\n`,
);
// A generated, Git-ignored copy lets the local app and worker use identical bytes.
// It is rebuilt from the pinned private original and is not a new source of truth.
save(
  "src/lib/generated/merriam-2026-09-14.json",
  `${JSON.stringify([...website])}\n`,
);
const legacyWords = [...testLexicon.words].sort();
if (
  hash(`${legacyWords.join("\n")}\n`) !==
  "05ad9e8df1225d6bb0cb1d1976d9e42691be838c6bfd99d6e9979f84d3930c58"
)
  throw new Error(
    "The historical 500-word lexicon changed. Preserve that version before preparing a new one.",
  );
const familyWords = [...new Set([...website, ...old, ...legacyWords])].sort();
const familyText = `${familyWords.join("\n")}\n`;
const familyHash =
  "2121ea84c411851c7f3239c27b0832a50c69ad483de83bca386beb973eeaee58";
if (familyWords.length !== 176974 || hash(familyText) !== familyHash)
  throw new Error(
    "The approved family union changed. Review and version it before use.",
  );
save(
  "src/lib/generated/family-additions-2026-09-14.json",
  `${JSON.stringify(familyWords.filter((word) => !website.has(word)))}\n`,
);
save("data/lexicons/family-2026-09-14/words.txt", familyText);
save(
  "data/lexicons/family-2026-09-14/manifest.json",
  `${JSON.stringify(
    {
      label: "Family word list: Merriam-Webster website + OSPD5",
      policy:
        "Doug explicitly requested: Include all words from all lists (2026-09-14).",
      edition: "Family union 2026-09-14 (website + OSPD5)",
      officialEdition: false,
      count: familyWords.length,
      sha256: familyHash,
      sources,
      legacyExamples: {
        id: testLexicon.id,
        edition: testLexicon.edition,
        count: legacyWords.length,
        additionalWords: legacyWords.filter(
          (word) => !website.has(word) && !old.has(word),
        ),
      },
      addedToWebsite: {
        ...outputs["ospd5-only"],
        path: "../comparisons/ospd5-merriam-2026-09-14/ospd5-only.txt",
      },
      comparison: "../comparisons/ospd5-merriam-2026-09-14/report.json",
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Prepared ${website.size.toLocaleString("en-US")} website words; comparison: ${groups.shared.length} shared, ${groups["website-only"].length} website-only, ${groups["ospd5-only"].length} OSPD5-only. Originals unchanged.`,
);
console.log(
  `Approved family list: ${familyWords.length.toLocaleString("en-US")} words; all 500 legacy examples included.`,
);
