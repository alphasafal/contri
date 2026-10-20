# How CONTRI's numbers work

Every figure is public GitHub evidence with a link back to its source. Unavailable data is shown as “—”, never as zero. When a sample is capped, CONTRI says so and marks lower bounds with ≥.

Signed-in reports use GitHub's GraphQL API; anonymous reports use the REST API. Both are normalized into the same shapes before any calculation (`src/core/`), so the definitions below apply to both.

## Overview (90-day window)

- **PRs merged · 90d** — exact count from GitHub search: `is:pr is:merged merged:>=<date>`, excluding the common automation accounts Dependabot, Renovate, GitHub Actions and pre-commit.ci.
- **Human PR authors** — distinct, case-insensitive logins among human merges in the most recently updated 100 merged PRs. Bots are excluded by account type and the `[bot]` suffix.
- **Weekly chart** — human merges per week (12 seven-day periods plus the final partial week) from the same sample. “Latest 100 merges” means the sample did not reach back 90 days.
- **Commits · 90d** — signed in: total commits on the default branch since the window start. Anonymous: up to 100 recent commits (≥ when capped).
- **Human merges in the last four weeks** — a quick health line from the weekly chart.
- **Median time to merge** — creation to merge for human PRs merged in the window; needs at least three.
- **Open issues / PRs** — GitHub search totals.

## Team responses

**Sample.** Outside contributors' PRs (not drafts) and issues created in the last 90 days, newest first: 10 of each anonymously, 20 signed in. Outside means GitHub's association is NONE, FIRST_TIMER, FIRST_TIME_CONTRIBUTOR or CONTRIBUTOR **and** the author is not on the maintainer roster.

**Maintainer roster.** GitHub hides private organization membership, so `author_association` alone misses many maintainers. A person counts as project team when any of these is observed:

| Basis                    | Evidence                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub team badge        | OWNER, MEMBER or COLLABORATOR association on a comment or review                                                                                                                          |
| Labels or assigns issues | `labeled`, `assigned`, `milestoned`, `locked`, `pinned`, `transferred`, `marked_as_duplicate` events (last 100 repository events). Labels applied by issue forms at creation are ignored. |
| Merges pull requests     | `merged` events, and `mergedBy` on recent merged PRs (signed in)                                                                                                                          |
| CODEOWNERS               | individual `@user` entries in `.github/CODEOWNERS` (signed in also checks `CODEOWNERS`, `docs/CODEOWNERS`)                                                                                |
| Repository owner         | the owner of a user-owned repository                                                                                                                                                      |

**First team reply.** The earliest comment or review by a human roster member who is not the author, at or after creation. Signed-in histories load the first 30 comments and reviews per item; anonymous histories load up to 100 of each.

**Timings.** Median and average use answered items only. Items without a team reply are listed with how long they have been waiting. If a history was capped before any team reply appeared, the item is marked “timing unknown” and excluded. Fewer than three answered items → “not enough evidence”. PR and issue figures stay separate.

## Can I work on this issue?

The verdict picks the first that applies:

1. **Closed** — the issue is closed.
2. **Open PR #n** — an open pull request references the issue.
3. **Assigned** — the issue has assignees.
4. **Claimed by `@user`** — a non-team commenter offered to work on it within the last 21 days, or has an open PR.
5. **Claim went quiet** — the latest claim is older than 21 days with no later comment or open PR from that person.
6. **Maybe fixed by #n** — a merged pull request was linked as closing the issue (Development panel or a closing keyword; visible when signed in), yet the issue is still open.
7. **Partly checked** — references could not be checked completely.
8. **Looks free** — none of the above. The detail says when only part of a long discussion was checked for claims, lists merged pull requests that only mention the issue, and lists pull requests that were closed without merging (“read why before trying again”), since repeated closed attempts usually mean the fix is harder than it looks or was misunderstood. References from other repositories are left out of these notes.

**Linked pull requests.** Signed in: GitHub's Development panel and closing keywords (`closedByPullRequestsReferences`) plus the latest 50 timeline cross-references. Anonymous: up to 300 timeline cross-references (Development-panel links are not visible anonymously; CONTRI warns when one exists). Private repositories are filtered out. A cross-reference may be unrelated.

**Claims.** Comments such as “I'd like to work on this”, “can I take this?”, “please assign me”, “/assign”, “I'm working on a fix”. Quoted replies and code blocks are ignored, questions like “is anyone working on this?” are not claims, and comments such as “I'm no longer working on this” or “feel free to take it” release a claim. Team members' comments are never treated as claims. This is a heuristic — always read the thread.

**Discussion.** Signed in: the latest 100 comments. Anonymous: all comments up to 300, or the newest 200–300 on longer threads (REST lists comments oldest first, so CONTRI reads the last pages). These give the latest human comment, the number of team comments and the claims; the caption shows how many comments were inspected.

## Discover

Search: `good-first-issues:>=2 archived:false is:public pushed:>=<30 days ago>` plus your keyword and language. Signed in, “Match my languages” uses the two most common primary languages of your own recently pushed, non-fork repositories. Ranking score = 2 × min(human merges among the latest 50 merged PRs in 90 days, 60) + min(open good-first-issues, 30). It ranks the compared candidates, not all of GitHub.

## On-device AI

Summaries and “How do I start?” come from Chrome's built-in model and never feed any metric. The transcript keeps the issue description and the newest comments that fit about 14,000 characters; CONTRI notes when a thread was cut.

## Freshness

| Report          | Cached for | Partial reports |
| --------------- | ---------- | --------------- |
| Repository      | 30 min     | 10 min          |
| Overview        | 30 min     | 10 min          |
| Team            | 6 h        | 2 h             |
| Issue check     | 10 min     | ~3 min          |
| Issue search    | 10 min     | ~3 min          |
| Discover        | 6 h        | 2 h             |
| Community files | 24 h       | 8 h             |

Every report shows when it was checked and has a refresh button; a failed request offers “Try again”. Signing in or out clears cached reports.

## Missing data

A value GitHub did not return (a failed request, an empty repository, a capped sample) is shown as “—” or “unavailable”, never as zero, and never changes a tone to “inactive”. For example, if the merged-PR sample cannot be loaded, the Overview says the recent activity could not be loaded instead of “no human merges”.
