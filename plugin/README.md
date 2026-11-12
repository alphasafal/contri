# CONTRI for Claude

Before Claude starts on a GitHub issue, it checks what [CONTRI](https://github.com/alphasafal/contri) shows people in the browser: is someone already working on this issue, is the project alive, and will a maintainer reply? AI agents increasingly open pull requests on issues someone already claimed. This plugin gives Claude the evidence to avoid that, and to find issues that are still free.

It is read-only and uses public GitHub data only. It never comments, claims an issue or opens a pull request.

## What you get

- **`contri` tools** from the [`contri-mcp`](https://www.npmjs.com/package/contri-mcp) server: `check_issue`, `check_issues`, `repo_health`, `team_responsiveness`, `find_issues`, `discover_projects` and `contribution_brief`, plus `sign_in` and `sign_out`. The verdicts are the same as the browser extension's: Looks free, Claimed by @user, Claim went quiet, Open PR #n, Assigned.
- **`/contri:can-i-take-this`**: checks one issue and says whether to start, ask in the thread first, or pick another issue, with evidence links.
- **`/contri:find-first-issue`**: finds an active project where maintainers reply and an issue nobody is working on yet, for a language or topic.

Claude also uses both skills by itself when the conversation calls for them, for example when you paste an issue link and ask whether you can take it.

## Install

In Claude Code:

```sh
claude plugin marketplace add alphasafal/contri
claude plugin install contri@alphasafal
```

Or inside a session, on Claude Code 2.1.275 or later:

```
/plugin install contri --marketplace alphasafal/contri
```

The tools need Node.js 20.3 or later, with npm, on your computer. They load in Claude Code and in Cowork sessions that run on your computer. In chat on claude.ai the two skills still load, and Claude does the same check by hand from what it can see of the issue.

To use the server without the plugin, or in Cursor, Claude Desktop and other MCP clients, see the [server's README](https://github.com/alphasafal/contri/tree/main/mcp#readme).

## Try it

- “Can I take https://github.com/owner/repo/issues/123?”
- “Find me a good first issue in an active TypeScript project where maintainers reply within a few days.”
- “Before you start on this issue, check nobody else is working on it.”

## Sign in with GitHub (optional)

Without signing in, GitHub allows 60 requests an hour, which an agent uses up quickly. Signing in raises it to 5,000. There is no token to copy: Claude shows a short code and a link to `github.com/login/device`, and you approve **CONTRI** there. The sign-in has no scopes, so it gives public, read-only access. Ask Claude to sign out to forget it, or revoke it at [github.com/settings/applications](https://github.com/settings/applications).

## What the plugin runs and sends

- **Runs:** one local program. When the plugin is enabled, Claude starts the `contri-mcp` server from npm, pinned to an exact version in `.mcp.json`, with `npx`. Its source is in [`mcp/`](https://github.com/alphasafal/contri/tree/main/mcp) and the npm package is published from that repository with provenance. The plugin has no hooks, no scripts and no other executables.
- **Sends:** requests to GitHub only: `api.github.com` for public repository data, and `github.com` for the sign-in. The requests carry the repository and issue you ask about. Nothing is sent to the CONTRI project or to anyone else.
- **Fetches:** the `contri-mcp` package and its dependencies (the MCP SDK and zod) from the npm registry, when `npx` first runs it.
- **Reads:** a saved sign-in, if you signed in before. If a `GITHUB_TOKEN` or `GH_TOKEN` variable is set in the environment the server starts in, the server uses it for its GitHub requests in place of the sign-in; it is sent only to `api.github.com` and is never stored.

## Privacy Policy

- **Data collection:** none by the CONTRI project. There is no backend, no account, no analytics and no telemetry.
- **Usage and storage:** reports are kept in memory while the server runs and are gone when it exits. The only file written is the saved sign-in, `~/.config/contri/mcp-credentials.json`, readable only by your user, and only if you sign in and do not choose a session-only sign-in. Signing out deletes it.
- **Third-party sharing:** your requests go to GitHub under [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Results go to Claude, the agent that asked for them, under Anthropic's terms. Issue text is included only when the agent asks for it.
- **Data retention:** nothing is retained by the CONTRI project. The saved sign-in stays on your computer until you sign out or delete the file.
- **Contact:** questions at [github.com/alphasafal/contri/issues](https://github.com/alphasafal/contri/issues) (never post tokens or personal data); security reports through [GitHub security advisories](https://github.com/alphasafal/contri/security/advisories/new).

The full policy for the extension, the server and the website is in [PRIVACY.md](https://github.com/alphasafal/contri/blob/main/PRIVACY.md).

## License

MIT
