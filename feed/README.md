# CONTRI feed

The public data behind three things on the website, built once a day by `.github/workflows/feed.yml` and published as static JSON on the `feed-data` branch. There is no CONTRI server: the pages fetch the files from `raw.githubusercontent.com`.

| File                        | Used by                                                       | What it holds                                                                               |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `free-issues.json`          | [Free right now](https://contri-two.vercel.app/issues)        | Unassigned good first issues with no open pull request that the verdict calls “Looks free”  |
| `repos.json`                | [Who answers newcomers?](https://contri-two.vercel.app/repos) | Projects ranked by the team's median first reply to outside contributors, with sample sizes |
| `badge/<owner>/<repo>.json` | README badges, through shields.io                             | `first reply to contributors: ~6h`, or `not enough data`                                    |

## Which projects

- **Found by search:** for each of ten languages, active public repositories with at least two open `good first issue`s, pushed in the last 30 days, at least 500 stars, ranked like the extension's Discover tab (recent human merges first). Four per language by default.
- **Added by their maintainers:** one `owner/name` per line in [`repos.txt`](repos.txt). These are read first, every day.
- **Kept for 30 days:** search returns whichever active projects were updated most recently, so the set changes from run to run. A project that is not picked today keeps its entry and its README badge, with the date it was last read, for 30 days (300 projects at most). A project removed from `repos.txt` is dropped at once. For a badge that never lapses, add the project to `repos.txt`.

## How it is measured

Nothing here is a second implementation. `src/feed.ts` calls the extension's own reports: `team` for reply times and the maintainer roster, `issues` for open good first issues, and the one-request list check (`bulkInsight`) for the verdicts. The definitions are in [docs/METRICS.md](../docs/METRICS.md). A project with fewer than three answered items is “not enough evidence”, never “slow”, and a repository that could not be read is listed as skipped with the reason.

## Running it

```sh
npm run build:feed
GITHUB_TOKEN=<any token, no permissions needed> node feed/dist/feed.js feed-out
```

The workflow's own token works. The run sends one request at a time and, when it reaches GitHub's per-minute search limit, waits a minute and carries on: about two projects a minute, so the default takes roughly 25 minutes. After 40 minutes it stops starting new projects and publishes what it has. Set the `FEED_REPOS_PER_LANGUAGE` variable (up to 12) to list more or fewer; `FEED_TOKEN` is an optional secret if you prefer a token of your own.

## Reading the numbers

A median under 15 minutes is almost always an automated reply posted from an account GitHub does not mark as a bot. Accounts with a bot-like name are already ignored; for the rest, those projects are grouped as “within minutes” after the measured ones instead of being ranked first. A small project with three answered items and a large one with twenty get the same kind of number; the sample size is always shown next to it.

## The README badge

```md
[![first reply to contributors](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Falphasafal%2Fcontri%2Ffeed-data%2Fbadge%2F<owner>%2F<repo>.json)](https://contri-two.vercel.app/repos)
```

Owner and repository in lower case. The leaderboard page has a “Copy README badge” button for every listed project.
