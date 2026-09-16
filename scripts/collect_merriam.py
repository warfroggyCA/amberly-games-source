"""Collect the public browse index after obtaining the publisher's permission.

Python standard library only. Output must remain private; data/lexicons is ignored.
Re-running with the same output directory resumes its cached snapshot.
"""
import argparse
import collections
import hashlib
import json
import re
import string
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

BASE = "https://scrabble.merriam.com"


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


class BrowseParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.entries_depth = None
        self.anchor = None
        self.links = []
        self.words = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div":
            self.depth += 1
            if "entries" in attrs.get("class", "").split():
                self.entries_depth = self.depth
        if tag == "a":
            self.anchor = [attrs.get("href", ""), "", self.entries_depth is not None]

    def handle_data(self, data):
        if self.anchor is not None:
            self.anchor[1] += data

    def handle_endtag(self, tag):
        if tag == "a" and self.anchor is not None:
            href, label, in_entries = self.anchor
            label = label.strip()
            url = urlsplit(urljoin(BASE, href))
            if url.netloc == "scrabble.merriam.com":
                self.links.append((url.path, label))
                if in_entries and url.path.startswith("/finder/"):
                    if not re.fullmatch(r"[a-z]{2,15}", label):
                        raise ValueError(f"Unexpected word: {label!r}")
                    if url.path != "/finder/" + label:
                        raise ValueError(f"Word/link mismatch: {label!r}")
                    self.words.append(label)
            self.anchor = None
        if tag == "div":
            if self.entries_depth == self.depth:
                self.entries_depth = None
            self.depth -= 1


def parse(html):
    parser = BrowseParser()
    parser.feed(html)
    return parser


class Collector:
    def __init__(self, output, delay):
        self.output = output
        self.delay = delay
        self.last_request = 0
        (output / "pages").mkdir(parents=True, exist_ok=True)

    def fetch(self, path):
        cache = self.output / "pages" / (path.strip("/").replace("/", "-") + ".json")
        if cache.exists():
            result = json.loads(cache.read_text())
            if result["url"] != BASE + path or hashlib.sha256(result["html"].encode()).hexdigest() != result["sha256"]:
                raise ValueError(f"Corrupt cache: {cache}")
            return result
        for attempt in range(5):
            time.sleep(max(0, self.delay - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            request = urllib.request.Request(BASE + path, headers={"User-Agent": "FamilyScrabbleScorer/0.1 (permitted personal word-list collection)"})
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    if response.geturl() != BASE + path or "text/html" not in response.headers.get("Content-Type", ""):
                        raise ValueError(f"Unexpected response for {path}")
                    html = response.read().decode("utf-8")
                result = {"url": BASE + path, "retrieved_at": now(), "sha256": hashlib.sha256(html.encode()).hexdigest(), "html": html}
                write_json(cache, result)
                return result
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                    raise
                retry = error.headers.get("Retry-After", "")
                pause = max(2 ** (attempt + 1), int(retry) if retry.isdigit() else 10)
            except (urllib.error.URLError, TimeoutError) as error:
                if attempt == 4:
                    raise
                pause = 2 ** (attempt + 1)
            print(f"Retrying {path} in {pause}s", flush=True)
            time.sleep(pause)

    def run(self):
        manifest = []
        for letter in string.ascii_lowercase:
            index = self.fetch(f"/browse/{letter}")
            links = parse(index["html"]).links
            pages = {}
            for path, label in links:
                match = re.fullmatch(rf"/browse/{letter}/([1-9][0-9]*)", path)
                if match:
                    bounds = re.fullmatch(r"([a-z]+)\s+\.\.\.\s+([a-z]+)", label)
                    if bounds:
                        pages[int(match[1])] = (path, bounds.groups())
            if not pages or sorted(pages) != list(range(1, max(pages) + 1)):
                raise ValueError(f"Missing or malformed index pages for {letter}")
            for number, (path, bounds) in sorted(pages.items()):
                manifest.append({"letter": letter, "page": number, "path": path, "expected_first": bounds[0], "expected_last": bounds[1]})
        write_json(self.output / "manifest.json", manifest)
        print(f"Discovered {len(manifest)} word pages across 26 indexes", flush=True)
        all_words = []
        reports = []
        for i, item in enumerate(manifest, 1):
            result = self.fetch(item["path"])
            words = parse(result["html"]).words
            if not words or words != sorted(set(words)):
                raise ValueError(f"Empty, unsorted, or duplicate entries: {item['path']}")
            if words[0] != item["expected_first"] or words[-1] != item["expected_last"]:
                raise ValueError(f"Index/page range mismatch: {item['path']}")
            if any(not word.startswith(item["letter"]) for word in words):
                raise ValueError(f"Wrong initial letter: {item['path']}")
            if all_words and all_words[-1] >= words[0]:
                raise ValueError(f"Overlapping pages: {item['path']}")
            all_words.extend(words)
            reports.append({**item, "count": len(words), "retrieved_at": result["retrieved_at"], "sha256": result["sha256"]})
            if i % 20 == 0 or i == len(manifest):
                print(f"Validated {i}/{len(manifest)} pages; {len(all_words)} words; {item['path']}", flush=True)
        data = ("\n".join(word.upper() for word in all_words) + "\n").encode("ascii")
        target = self.output / "words.txt"
        temporary = target.with_suffix(".tmp")
        temporary.write_bytes(data)
        temporary.replace(target)
        report = {
            "label": "Merriam-Webster Scrabble website word list",
            "edition": "Unconfirmed; not asserted to be OSPD7 or NWL2023",
            "permission": "User reported publisher permission in this task before collection; permission document not independently inspected",
            "completed_at": now(), "coverage": "All numbered pages linked by the 26 cached letter indexes",
            "expected_pages": len(manifest), "validated_pages": len(reports), "failed_pages": [],
            "word_count": len(all_words), "unique_word_count": len(set(all_words)),
            "sha256": hashlib.sha256(data).hexdigest(),
            "counts_by_initial": dict(sorted(collections.Counter(w[0].upper() for w in all_words).items())),
            "counts_by_length": dict(sorted(collections.Counter(map(len, all_words)).items())),
            "pages": reports,
        }
        write_json(self.output / "report.json", report)
        print(f"COMPLETE: {target}; SHA256 {report['sha256']}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()
    if args.delay < 0.25:
        parser.error("Minimum request interval is 0.25 seconds")
    Collector(args.output, args.delay).run()
