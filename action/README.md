# CONTRI action

Tells a pull request when the issue it closes is **already taken by someone else**, and asks about claims that went quiet. It uses the same checks as the [CONTRI extension](../README.md) and [`contri-mcp`](../mcp/README.md): assignees, “I'd like to work on this” comments, maintainers who said the work is theirs, and linked pull requests.

Duplicate pull requests cost a maintainer a review and a contributor (or their coding agent) an evening. One early comment saves both.

## What it does

**On a pull request** it looks at the issues the pull request closes (“Fixes #12”, or the Development panel) and posts **one** comment if, for any of them:

| It finds                                                        | The comment says                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| another open pull request for the issue, by someone else        | `#12 already has an open pull request: #40 by @sam.`        |
| an assignee who is not the author                               | `#12 is assigned to @kim.`                                  |
| someone else's “I'd like to work on this” from the last 21 days | `@lena offered to work on #12 2 days ago.` (linked)         |
| a maintainer's recent “I'll fix this” / “I'm working on it”     | `@ana from the project team said they are working on #12 …` |

It never closes, blocks or fails anything. The comment is updated in place if the situation changes, and nothing is posted when the author is the assignee or claimant, is on the project team, or is a bot. A claim that already went quiet is not a reason to stop anyone, so it is not mentioned.

**On a schedule** (optional) it finds unassigned `good first issue` / `help wanted` issues where someone offered to work on it, then went quiet: no pull request and no word for `stale-days`. It asks them once, politely, whether they are still on it. One nudge per person per issue, ever, and at most `max-nudges` per run.

## Use it

```yaml
# .github/workflows/contri.yml
name: CONTRI
on:
  pull_request_target:
    types: [opened, reopened, ready_for_review, edited]
  schedule:
    - cron: '17 6 * * 1' # Mondays: ask about quiet claims (remove to turn this off)

permissions: {}

jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: write
    steps:
      - uses: alphasafal/contri/action@main # pin a release tag or a commit SHA
```

`pull_request_target` is what lets the job comment on pull requests from forks. It is safe here because the action never checks out or runs the pull request's code: it reads the pull request and its issues through the API, as data. Do not add a checkout of the pull request's head to this job.

## Inputs

| Input           | Default               | What it does                                                                                     |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| `github-token`  | `${{ github.token }}` | Reads the repository and posts the comments.                                                     |
| `skip-team`     | `true`                | Do not check pull requests from the owner, members or collaborators.                             |
| `label`         | none                  | A label to add to a pull request whose issue looks taken, for example `possible duplicate`.      |
| `stale-days`    | `30`                  | Schedule: ask about a claim after this many quiet days (never fewer than 22).                    |
| `max-nudges`    | `5`                   | Schedule: the most questions to post in one run. `0` turns them off.                             |
| `dry-run`       | `false`               | Log what would be posted instead of posting it. Good for a first run with `workflow_dispatch`.   |
| `fail-on-error` | `false`               | Fail the job if the check itself cannot run. Off, so a GitHub hiccup never puts a red X on a PR. |

Outputs: `findings` (issues that look taken, on a pull request) and `nudged` (questions posted, on a schedule).

## What it costs and what it reads

A pull request run is about four API requests with the workflow's own token; a scheduled run is one search plus one request per candidate issue (30 at most). Public repositories on github.com only. Nothing leaves GitHub: there is no CONTRI server, and the token is sent to the GitHub API and nowhere else.

## Limits

- Claim detection is English regular expressions and can be wrong in both directions; the comment says so, and [wrong verdicts](https://github.com/alphasafal/contri/issues/new?template=wrong_verdict.yml) become test cases. How a claim is recognized is in [docs/METRICS.md](../docs/METRICS.md#can-i-work-on-this-issue).
- Only issues linked with a closing keyword or the Development panel are checked. A pull request that just mentions `#12` is not.
- Work nobody mentioned in public is invisible to it.

## Developing

The source is in `action/src/` (`findings.ts` decides, `run.ts` reads and posts). GitHub runs actions straight from the repository, so the bundle `action/dist/index.js` is committed: after changing the action or anything it imports from `src/`, run `npm run build:action` and commit the result. CI fails when it is out of date, and `npm run smoke:action` runs the bundle against a fake GitHub API.
