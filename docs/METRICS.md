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
5. **Maintainer `@user` is on it** — someone on the project team said the work is theirs (“I'll fix this”, “I'm working on it”, “I have a PR for this”) within the last 21 days, and nobody on the team has handed it to contributors since.
6. **Claim went quiet** — the latest claim is older than 21 days with no later comment or open PR from that person.
7. **Maybe fixed by #n** — a merged pull request was linked as closing the issue (Development panel or a closing keyword; visible when signed in), yet the issue is still open.
8. **Partly checked** — references could not be checked completely.
9. **Looks free** — none of the above. An older maintainer statement (more than 21 days, nothing since) is mentioned in the detail: ask whether it is still planned. The detail says when only part of a long discussion was checked for claims, lists merged pull requests that only mention the issue, and lists pull requests that were closed without merging (“read why before trying again”), since repeated closed attempts usually mean the fix is harder than it looks or was misunderstood. References from other repositories are left out of these notes.

**Linked pull requests.** Signed in: GitHub's Development panel and closing keywords (`closedByPullRequestsReferences`) plus the latest 50 timeline cross-references. Anonymous: up to 300 timeline cross-references (Development-panel links are not visible anonymously; CONTRI warns when one exists). Private repositories are filtered out. A cross-reference may be unrelated.

**Claims.** A comment is a claim when it has three things: a first-person intent (“I'd like to”, “can I”, “I'll”, “happy to”), an action (“work on”, “take”, “fix”, “pick up”, “open a PR”) and a target (“this”, “it”, “the issue”, “a PR”, “#123”). “Please assign me”, `/assign`, “I'm working on a fix”, “I'm on it”, “I opened a PR” and “I have a fix” count on their own. The target is what keeps “+1” comments out: “I can confirm the fix works”, “I'm hitting this too, please fix” and “I'd love to see a fix for this” are not claims. Neither are doubts (“I don't think I can fix this”), questions about others (“is anyone working on this?”), statements about someone else (“let me know if you fix it”), workarounds (“I can fix this locally by…”), quoted replies, code blocks, HTML comments or collapsed `<details>`. Comments such as “I'm no longer working on this”, “I don't have time for this” or “feel free to take it” release a claim.

**Project team.** A maintainer's “I can take a look” or “can I help?” is triage, not taking the issue, so team comments never count as contributor claims. A team member who says the work is theirs or under way is reported separately (verdict 5). “PRs welcome”, “up for grabs”, “help wanted” or “feel free to…” from anyone on the team cancels it.

Claim detection is a heuristic over English text. The examples it is tested against are in `tests/unit/claims.test.ts`; a wrong verdict is the most useful [issue](https://github.com/alphasafal/contri/issues/new?template=wrong_verdict.yml) you can open. Always read the thread.

**Issue lists.** Signed in, every title on a repository's issue list gets its verdict from one GraphQL request for the whole page (up to 30 issues). It uses the same rules as the issue page on a smaller sample: the latest 20 comments and the latest 20 references of each issue, plus Development-panel links. A longer thread is still judged, and the detail says only the latest comments were checked; an issue with more references than were read is “Partly checked”. Anonymous lists show no badges, because one page would cost about 75 of the 60 requests an hour.

**Discussion.** Signed in: the latest 100 comments. Anonymous: all comments up to 300, or the newest 200–300 on longer threads (REST lists comments oldest first, so CONTRI reads the last pages). These give the latest human comment, the number of team comments and the claims; the caption shows how many comments were inspected.

## Website lists and badges

The “Free right now” list, the “Who answers newcomers?” ranking and the README badges use the reports above, run once a day (see [feed/README.md](../feed/README.md)).

- **Free right now** — open `good first issue`s that are unassigned, have no linked open pull request, and whose verdict is “Looks free” from the issue-list check (latest 20 comments and 20 references). Up to three per project.
- **Typical first reply** — the median from _Team responses_: outside pull requests when at least three got a team reply, otherwise outside issues, otherwise “not enough evidence”. The sample size is shown next to it. Projects without enough evidence are listed last and never ranked as slow.
- **Badge** — `first reply to contributors: ~6h`, green up to 24 hours, amber up to 72, grey beyond or without enough data.
- **Which projects** — found by search (active, at least two open good first issues, a few per language) or added by their maintainers. It is a sample, not a ranking of all of GitHub.

## Open Source Wrapped

Counts from GitHub's public search for one user and one calendar year: pull requests they opened that were merged in that year, pull requests and issues they opened, and other people's pull requests they reviewed. Projects, “projects that aren't mine” (repositories not under the user's own account) and the busiest month come from the first 100 merged pull requests of the year; when there were more, project counts are shown as “at least”. Private activity is not visible.

## Discover

Search: `good-first-issues:>=2 archived:false is:public pushed:>=<30 days ago>` plus your keyword and language. Signed in, “Match my languages” uses the two most common primary languages of your own recently pushed, non-fork repositories. Ranking score = 2 × min(human merges among the latest 50 merged PRs in 90 days, 60) + min(open good-first-issues, 30). It ranks the compared candidates, not all of GitHub.

## On-device AI

Summaries and “How do I start?” come from the browser's built-in model (desktop Chrome today) and never feed any metric. Where there is no built-in model, the panel shows the last three comments as written, with who is on the project team: no AI and no extra request. The transcript keeps the issue description and the newest comments that fit about 14,000 characters; CONTRI notes when a thread was cut.

## Freshness

| Report          | Cached for | Partial reports |
| --------------- | ---------- | --------------- |
| Repository      | 30 min     | 10 min          |
| Overview        | 30 min     | 10 min          |
| Team            | 6 h        | 2 h             |
| Issue check     | 10 min     | ~3 min          |
| Issue list      | 10 min     | ~3 min          |
| Issue search    | 10 min     | ~3 min          |
| Discover        | 6 h        | 2 h             |
| Community files | 24 h       | 8 h             |

Every report shows when it was checked and has a refresh button; a failed request offers “Try again”. Signing in or out clears cached reports.

## Missing data

A value GitHub did not return (a failed request, an empty repository, a capped sample) is shown as “—” or “unavailable”, never as zero, and never changes a tone to “inactive”. For example, if the merged-PR sample cannot be loaded, the Overview says the recent activity could not be loaded instead of “no human merges”.
