# Reddit analysis: thin endometrium + EMMA / ALICE

Quantitative harvest of Reddit fertility communities for mentions of thin
endometrium and the EMMA / ALICE endometrial microbiome tests.

## Why this lives in a subfolder

This script is unrelated to the rest of this repo — it's isolated research
tooling kept on the `claude/reddit-endometrium-analysis-9DzNp` branch.

## Why you have to run it locally

Reddit blocks the Claude Code sandbox (403 at the TLS tunnel), so even with
valid API credentials `praw` can't reach `oauth.reddit.com` from inside the
app. Run it on your own machine.

## Setup

1. Create a Reddit app at <https://www.reddit.com/prefs/apps> → "script" type.
   Redirect URI can be `http://localhost:8080`. Note the `client_id`
   (under the app name) and `secret`.
2. Install deps:
   ```bash
   pip install praw
   ```
3. Export credentials:
   ```bash
   export REDDIT_CLIENT_ID=xxxxxxxxxxxxxx
   export REDDIT_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   export REDDIT_USER_AGENT="endometrium-research by u/your_reddit_handle"
   ```

## Run

```bash
# Full run (slow — harvests comments too)
python analyze.py --out ./out

# Fast smoke test
python analyze.py --out ./out --no-comments --limit 50

# Narrow subreddit list
python analyze.py --subs infertility,IVF --out ./out
```

## Output

Inside `./out/`:

- `raw_hits.csv` — every matching submission and comment with permalink,
  score, year, matched topic tags, and a lightweight sentiment score.
- `summary.md` — aggregated view: counts by subreddit / year / topic,
  co-occurrence matrix, average sentiment per topic, and the top threads
  that mention **both** thin lining and EMMA/ALICE.

## What it tags

Each hit is tagged by regex against these topics:

| tag                  | captures                                              |
|----------------------|-------------------------------------------------------|
| `thin_lining`        | "thin endometrium", "thin lining", "<6mm", etc.       |
| `emma`               | EMMA test / EMMA biopsy / Igenomix microbiome         |
| `alice`              | ALICE test / Analysis of Infectious Chronic Endometritis |
| `chronic_endometritis` | "chronic endometritis", "CE"                        |
| `lactobacillus`      | lactobacillus-dominated microbiota                    |
| `era`                | ERA / receptivity test                                |
| `receptivadx`        | ReceptivaDx / BCL6                                    |
| `antibiotics`        | doxycycline, metronidazole, etc.                      |
| `probiotics`         | probiotic mentions                                    |
| `pregnancy_success`  | BFP, live birth, beta positive                        |
| `pregnancy_fail`     | BFN, RIF, RPL, failed transfer, miscarriage           |

## Notes on interpretation

- Sentiment is a crude lexicon (pos/neg word count) — use it as a *signal*,
  not a verdict. Read the top quotes by hand.
- The co-occurrence matrix is the most useful output for your question:
  look at `thin_lining × emma` and `thin_lining × alice` cells to count how
  many people discussing thin lining actually engaged with these tests, and
  whether those threads skew toward `pregnancy_success` or `pregnancy_fail`.
- `raw_hits.csv` is the source of truth — open it in a spreadsheet and
  filter/sort by `tags` and `score` to read the most upvoted firsthand reports.
