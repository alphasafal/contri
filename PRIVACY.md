# CONTRI privacy and permissions

CONTRI has no backend and no analytics. It reads public GitHub data from your browser and keeps everything else on your device.

## What it reads

The extension runs on github.com. It reads the repository and issue number in the current page's URL to fetch public evidence from `api.github.com`. It does not keep a browsing history; cached reports (below) are filed under the repository they describe. GitHub receives ordinary request metadata (such as your IP address); requests never include your GitHub cookies.

Only public repositories are analyzed, even if your sign-in could see more. Private cross-references are filtered out.

## Signing in

- **Sign in with GitHub (device flow):** you approve a code on github.com. CONTRI receives a token with no scopes (public, read-only access) directly from GitHub. Your password never touches CONTRI.
- **Personal access token:** entered only on the extension's own Settings page.

The token is kept in exactly one place:

- **By default:** in session storage, which Chrome keeps in memory. It is forgotten when the browser closes.
- **“Stay signed in”:** in extension-local storage, encrypted with AES-GCM (256-bit). The key is a non-extractable Web Crypto key kept in the extension's own IndexedDB, so script cannot read its raw bytes. This keeps the token out of plain text, so tools that scan files for GitHub tokens do not find it. The key lives in the same browser profile, so a full copy of your profile (for example a backup) contains both, and someone with full control of your computer could still use your session. It is not a password manager.

Extension storage is restricted to trusted extension contexts, so scripts running on GitHub pages, including CONTRI's own badges, cannot read the token. It is sent only to `api.github.com` over HTTPS. If GitHub rejects it (expired or revoked), Settings tells you to reconnect. Sign out in Settings, and revoke access at https://github.com/settings/applications (OAuth) or https://github.com/settings/personal-access-tokens (tokens).

## On-device AI

“Summarize the thread” and “How do I start?” use Chrome's built-in model (Gemini Nano), which runs locally. The issue text is processed on your device and is not sent to CONTRI or to an AI service. Chrome may download the model once; that download is managed by Chrome. Nothing runs until you click.

## Stored on your device

- Cached public reports (up to 80, expiring after a few minutes to 24 hours) and maintainer rosters (7 days). Each cached report is filed under the repository (and issue number) it describes, so the cache shows which repositories you looked at recently. CONTRI keeps no other browsing history. Clear the cache in Settings.
- Your shortlist and notes (up to 50 items), and watched issues (up to 10).
- Preferences and widget position.

Uninstalling removes all of it.

## Notifications

If you watch an issue, CONTRI checks it about once an hour and shows a system notification when something useful changes. Turn notifications off in Settings, or stop watching.

## Permissions

| Permission                 | Why                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `storage`                  | preferences, cached reports, shortlist, watched issues, optional sign-in           |
| `scripting`                | show CONTRI when the toolbar button is clicked on a tab opened before installation |
| `alarms`                   | hourly checks of watched issues                                                    |
| `notifications`            | tell you when a watched issue changes                                              |
| `https://github.com/*`     | show the launcher and badges; also used for the device-flow sign-in endpoints      |
| `https://api.github.com/*` | read public repository evidence                                                    |

No all-sites access. No remote code: all JavaScript and fonts ship in the package.

## AI chat handoff

The contribution brief is assembled locally. **Copy brief** puts it on your clipboard; the ChatGPT, Claude and Gemini links open those sites without the brief. If you paste it there, that provider's terms apply.

## MCP server for AI agents (`contri-mcp`)

The optional MCP server is a separate program you run on your own computer; it is not part of the browser extension. It has no backend and no analytics, and sends requests only to GitHub: `api.github.com`, plus `github.com` for signing in. Signing in uses the same device flow and OAuth App as the extension (no scopes, public read-only access). Unless you choose a session-only sign-in, the token is saved in plain text in `~/.config/contri/mcp-credentials.json` with permissions that let only your user read it, like the GitHub CLI does; `sign_out` deletes it. A `GITHUB_TOKEN` you set in your MCP client's configuration is read from there and not stored by CONTRI. A token GitHub rejects is dropped (and a rejected saved sign-in deleted). Reports are cached in memory and are gone when the process exits. Results go to the AI agent that called the tool, so that agent's provider sees them under its own terms. Issue text is included only when the agent asks for it.

## Data handled, at a glance

| Data                                          | Where it goes                                   | Kept                                          |
| --------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| GitHub token (optional)                       | Your device; sent only to `api.github.com`      | Until browser exit, or sign-out if remembered |
| Repository and issue in the current page URL  | Used on your device to query `api.github.com`   | Only inside cached reports                    |
| Public GitHub data (activity, issues, people) | Fetched from `api.github.com`, cached on device | Minutes to 7 days                             |
| Your shortlist, notes and watched issues      | Your device only                                | Until you remove them                         |
| Issue text for on-device AI                   | Chrome's built-in model on your device          | Not stored                                    |
| Preferences and widget position               | Your device only                                | Until you uninstall                           |

CONTRI has no server of its own, so the developer never receives any of this.

## Limited Use

The use of information received through CONTRI adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/), including the Limited Use requirements. Data is used only to provide CONTRI's single purpose: helping you decide where and how to contribute to public GitHub projects. CONTRI does not sell data, transfer it to data brokers or advertising platforms, use it for advertising, or use it to determine creditworthiness or for lending. No human reads it.

## Changes

If this policy or the way CONTRI handles data changes, the change is listed in the [changelog](CHANGELOG.md) and the extension's release notes before it ships.

Questions: https://github.com/alphasafal/contri/issues (never post tokens or personal data).
