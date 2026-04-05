#!/usr/bin/env python3
"""
Reddit quantitative analysis: thin endometrium + EMMA/ALICE testing.

Searches fertility-related subreddits for mentions of thin endometrium and
the EMMA/ALICE endometrial microbiome tests, then produces:
  - raw CSV with every matching submission and comment
  - aggregated counts per subreddit / per year
  - co-occurrence matrix (thin lining vs EMMA/ALICE)
  - simple sentiment score for threads mentioning the tests
  - top-upvoted representative quotes

Runs LOCALLY (the Claude Code sandbox blocks reddit.com). To run:

    pip install praw pandas
    export REDDIT_CLIENT_ID=...           # from https://www.reddit.com/prefs/apps
    export REDDIT_CLIENT_SECRET=...
    export REDDIT_USER_AGENT="endometrium-research by u/your_username"
    python analyze.py --out ./out

Optional: --limit 500 --subs infertility,IVF,TryingForABaby
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

try:
    import praw
except ImportError:
    sys.exit("praw not installed. Run: pip install praw pandas")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_SUBS = [
    "infertility",
    "IVF",
    "TryingForABaby",
    "TFABLinePorn",
    "waiting_to_try",
    "stilltrying",
    "TTC30",
    "InfertilityBabies",
    "Miscarriage",
    "RecurrentMiscarriage",
]

# Query strings passed to Reddit search.
QUERIES = [
    '"thin endometrium"',
    '"thin lining"',
    '"EMMA test"',
    '"ALICE test"',
    "EMMA ALICE",
    "endometritis",
    "Igenomix endometrium",
    "endometrial microbiome",
    "lactobacillus uterus",
    "EndomeTRIO",
]

# Regex buckets used for tagging each matching text.
PATTERNS = {
    "thin_lining": re.compile(
        r"\b(thin (endometrium|lining|uterine lining)|lining (was|is) thin|<\s*[5-7]\s*mm)\b",
        re.I,
    ),
    "emma": re.compile(r"\bemma\b.*\b(test|biopsy|igenomix|microbiome)\b|\bemma test\b", re.I),
    "alice": re.compile(r"\balice\b.*\b(test|biopsy|igenomix|endometritis)\b|\balice test\b", re.I),
    "chronic_endometritis": re.compile(r"chronic endometrit|\bCE\b", re.I),
    "lactobacillus": re.compile(r"lactobacill", re.I),
    "era": re.compile(r"\bERA\b.*\b(test|biopsy|receptivity)\b|\bERA test\b", re.I),
    "receptivadx": re.compile(r"receptiva\s*dx|BCL6", re.I),
    "antibiotics": re.compile(r"\b(doxycycline|metronidazole|ciprofloxacin|amoxicillin|antibiotic)s?\b", re.I),
    "probiotics": re.compile(r"probiotic|lactobacillus supplement", re.I),
    "pregnancy_success": re.compile(r"\b(BFP|beta (positive|[0-9])|pregnant|live birth|healthy baby)\b", re.I),
    "pregnancy_fail": re.compile(r"\b(BFN|chemical|miscarriage|failed transfer|implantation failure|RIF|RPL)\b", re.I),
}

# Very lightweight sentiment lexicon — good enough for aggregate signal.
POS_WORDS = {
    "worked", "worth", "helped", "success", "successful", "recommend", "glad",
    "positive", "pregnant", "bfp", "live birth", "healthy", "finally", "grateful",
    "game changer", "changed everything", "best decision",
}
NEG_WORDS = {
    "waste", "scam", "useless", "expensive", "not worth", "regret", "failed",
    "didn't help", "didnt help", "no difference", "placebo", "overpriced",
    "bfn", "miscarriage", "heartbreaking", "disappointed",
}

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Hit:
    kind: str            # "submission" or "comment"
    subreddit: str
    id: str
    parent_id: str
    permalink: str
    author: str
    created_utc: float
    year: int
    score: int
    title: str
    body: str
    tags: str            # comma-separated matched patterns
    sentiment: int       # -n..+n


def classify(text: str) -> list[str]:
    return [name for name, rx in PATTERNS.items() if rx.search(text or "")]


def sentiment_score(text: str) -> int:
    if not text:
        return 0
    low = text.lower()
    pos = sum(1 for w in POS_WORDS if w in low)
    neg = sum(1 for w in NEG_WORDS if w in low)
    return pos - neg


# ---------------------------------------------------------------------------
# Reddit fetch
# ---------------------------------------------------------------------------

def get_reddit() -> praw.Reddit:
    cid = os.environ.get("REDDIT_CLIENT_ID")
    sec = os.environ.get("REDDIT_CLIENT_SECRET")
    ua = os.environ.get("REDDIT_USER_AGENT", "endometrium-research/0.1")
    if not cid or not sec:
        sys.exit("Missing REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET env vars.")
    return praw.Reddit(client_id=cid, client_secret=sec, user_agent=ua, check_for_async=False)


def harvest(reddit: praw.Reddit, subs: list[str], queries: list[str],
            limit: int, include_comments: bool) -> list[Hit]:
    seen: set[str] = set()
    hits: list[Hit] = []

    for sub_name in subs:
        sub = reddit.subreddit(sub_name)
        for q in queries:
            print(f"[search] r/{sub_name}  q={q}", file=sys.stderr)
            try:
                results = list(sub.search(q, sort="relevance", time_filter="all", limit=limit))
            except Exception as e:
                print(f"  ! error: {e}", file=sys.stderr)
                continue

            for sm in results:
                if sm.id in seen:
                    continue
                seen.add(sm.id)

                body = (sm.selftext or "")
                text_all = f"{sm.title}\n{body}"
                tags = classify(text_all)
                if not tags:
                    continue

                created = sm.created_utc or 0
                hits.append(Hit(
                    kind="submission",
                    subreddit=sub_name,
                    id=sm.id,
                    parent_id="",
                    permalink=f"https://www.reddit.com{sm.permalink}",
                    author=str(sm.author) if sm.author else "[deleted]",
                    created_utc=created,
                    year=datetime.fromtimestamp(created, tz=timezone.utc).year if created else 0,
                    score=sm.score or 0,
                    title=sm.title or "",
                    body=body,
                    tags=",".join(sorted(tags)),
                    sentiment=sentiment_score(text_all),
                ))

                if include_comments:
                    try:
                        sm.comments.replace_more(limit=0)
                        for c in sm.comments.list():
                            ctext = c.body or ""
                            ctags = classify(ctext)
                            if not ctags:
                                continue
                            cc = c.created_utc or 0
                            hits.append(Hit(
                                kind="comment",
                                subreddit=sub_name,
                                id=c.id,
                                parent_id=sm.id,
                                permalink=f"https://www.reddit.com{c.permalink}",
                                author=str(c.author) if c.author else "[deleted]",
                                created_utc=cc,
                                year=datetime.fromtimestamp(cc, tz=timezone.utc).year if cc else 0,
                                score=c.score or 0,
                                title="",
                                body=ctext,
                                tags=",".join(sorted(ctags)),
                                sentiment=sentiment_score(ctext),
                            ))
                    except Exception as e:
                        print(f"  ! comments error on {sm.id}: {e}", file=sys.stderr)

                time.sleep(0.2)  # be nice to the API
    return hits


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------

def aggregate(hits: list[Hit], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Raw CSV
    raw_path = out_dir / "raw_hits.csv"
    with raw_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(asdict(hits[0]).keys()) if hits else [
            "kind", "subreddit", "id", "parent_id", "permalink", "author",
            "created_utc", "year", "score", "title", "body", "tags", "sentiment",
        ])
        w.writeheader()
        for h in hits:
            w.writerow(asdict(h))
    print(f"[write] {raw_path}  ({len(hits)} rows)")

    if not hits:
        return

    # 2. Counts by subreddit / year / tag
    by_sub: Counter = Counter(h.subreddit for h in hits)
    by_year: Counter = Counter(h.year for h in hits if h.year)
    by_tag: Counter = Counter()
    for h in hits:
        for t in h.tags.split(","):
            if t:
                by_tag[t] += 1

    # 3. Co-occurrence matrix
    tags_list = sorted({t for h in hits for t in h.tags.split(",") if t})
    cooc: dict[tuple[str, str], int] = defaultdict(int)
    for h in hits:
        ts = [t for t in h.tags.split(",") if t]
        for a in ts:
            for b in ts:
                if a < b:
                    cooc[(a, b)] += 1

    # 4. Sentiment per tag bucket (only items tagged with that bucket)
    sent_by_tag: dict[str, list[int]] = defaultdict(list)
    for h in hits:
        for t in h.tags.split(","):
            if t:
                sent_by_tag[t].append(h.sentiment)

    # 5. Top representative quotes (highest score mentioning both thin_lining & emma/alice)
    key_hits = [
        h for h in hits
        if "thin_lining" in h.tags and ("emma" in h.tags or "alice" in h.tags)
    ]
    key_hits.sort(key=lambda h: h.score, reverse=True)

    # ---- Write summary markdown --------------------------------------------
    summary_path = out_dir / "summary.md"
    with summary_path.open("w", encoding="utf-8") as f:
        f.write("# Reddit analysis: thin endometrium + EMMA/ALICE\n\n")
        f.write(f"Total matching items: **{len(hits)}** "
                f"(submissions: {sum(1 for h in hits if h.kind == 'submission')}, "
                f"comments: {sum(1 for h in hits if h.kind == 'comment')})\n\n")

        f.write("## By subreddit\n\n")
        for s, n in by_sub.most_common():
            f.write(f"- r/{s}: {n}\n")

        f.write("\n## By year\n\n")
        for y in sorted(by_year):
            f.write(f"- {y}: {by_year[y]}\n")

        f.write("\n## By topic tag\n\n")
        for t, n in by_tag.most_common():
            sents = sent_by_tag[t]
            avg = sum(sents) / len(sents) if sents else 0
            f.write(f"- **{t}**: {n} hits  |  avg sentiment {avg:+.2f}\n")

        f.write("\n## Co-occurrence (top 20)\n\n")
        top_co = sorted(cooc.items(), key=lambda kv: kv[1], reverse=True)[:20]
        for (a, b), n in top_co:
            f.write(f"- {a} × {b}: {n}\n")

        f.write(f"\n## Threads mentioning BOTH thin lining AND EMMA/ALICE: {len(key_hits)}\n\n")
        for h in key_hits[:25]:
            title = (h.title or h.body[:120]).replace("\n", " ").strip()
            f.write(f"- [{title}]({h.permalink}) — r/{h.subreddit}, "
                    f"score {h.score}, sentiment {h.sentiment:+d}\n")

    print(f"[write] {summary_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./out", type=Path)
    ap.add_argument("--limit", type=int, default=250,
                    help="max submissions per (sub, query) pair")
    ap.add_argument("--subs", default=",".join(DEFAULT_SUBS),
                    help="comma-separated subreddit list")
    ap.add_argument("--no-comments", action="store_true",
                    help="skip comment harvesting (much faster)")
    args = ap.parse_args()

    reddit = get_reddit()
    reddit.read_only = True

    subs = [s.strip() for s in args.subs.split(",") if s.strip()]
    hits = harvest(reddit, subs, QUERIES, limit=args.limit,
                   include_comments=not args.no_comments)
    print(f"[done] collected {len(hits)} tagged items")
    aggregate(hits, args.out)


if __name__ == "__main__":
    main()
