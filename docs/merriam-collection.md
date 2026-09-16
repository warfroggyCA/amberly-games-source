# Merriam-Webster browse collection

The owner reported receiving publisher permission in the task and authorized collection on September 14, 2026. The permission document has not been independently inspected. This collection does not establish additional redistribution rights or identify an official dictionary edition.

Run from the repository root with Python 3 (standard library only):

```sh
python3 scripts/collect_merriam.py --output data/lexicons/merriam-2026-09-14
```

The output directory is covered by the existing `data/lexicons/` Git ignore rule. Keep the word data and page cache private. Do not add them to public assets or source control.

The collector discovers numbered page links and word-range labels from all 26 alphabetical indexes. It reads spellings from each page's `entries` container without requesting individual definitions. Requests are sequential with a default minimum interval of 0.5 seconds. Transient network errors and HTTP 429/500/502/503/504 responses get bounded retries; other HTTP failures stop the run. A stopped run resumes from cached pages when the same command is run again.

Outputs:

- `pages/`: timestamped HTML responses with SHA-256 checksums, including the letter indexes.
- `manifest.json`: expected page URLs and first/last words from the indexes.
- `words.txt`: sorted uppercase spellings, one word per line; written only after all pages pass validation.
- `report.json`: page coverage, per-page counts and retrieval times, counts by initial and length, and the word file's SHA-256 checksum; written only after all pages pass validation.

Checks reject malformed spellings, mismatched word links, missing page numbers, empty pages, duplicate or unsorted entries, overlapping page ranges, and disagreement with index range labels. Completeness means coverage of the site's indexed browse pages, not independent equivalence to OSPD7 or NWL2023. Inflections are preserved as individual listed words.

Reusing a directory resumes its original cached snapshot, rather than refreshing it. Use a new dated directory for a later collection. The collector does not change the app's vocabulary or enable official validation. Integration and exact edition identification remain separate work.

## September 14, 2026 collection result

Completed all 601 numbered pages from 26 letter indexes with no failed pages. The output contains 176,844 unique words, 2–15 letters long, and occupies 1,723,365 bytes. All 627 index/page responses are cached. An independent extraction of the cached word links matched `words.txt` exactly; sorting, uniqueness, page totals, and the final checksum were also checked.

Word-file SHA-256: `446ea664837d752bba96d451b526d2fafc7050b63775e5ad17f6eaebdcce2c5b`.
