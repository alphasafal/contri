# CONTRI launch website

Buildless HTML, CSS, and JavaScript in `dist`. Vercel deploys it automatically from `main` using the root `vercel.json` (output directory `website/dist`, no build step). Run `python3 -m http.server 4174 --directory dist` from this directory to preview. All fonts and images are local. Demo statistics on the home page are explicitly fictional. No analytics and no tokens anywhere.

Three more pages read public data, from the visitor's browser:

- `issues.html` (“Free right now”) and `repos.html` (“Who answers newcomers?”) fetch static JSON that the Feed workflow publishes on the `feed-data` branch (`feed.js`; source in `../feed/`).
- `wrapped.html` (Open Source Wrapped) looks a username up on GitHub's public API and draws a card on a canvas (`wrapped.js`, arithmetic in `wrapped-core.js`). Nothing is stored or sent to CONTRI.

Data from GitHub is always inserted as text, and only plain `https://github.com` URLs become links. `tests/e2e/website.spec.ts` drives all three pages in a browser against fixtures; `tests/unit/website.test.ts` covers the arithmetic.

Visual direction inspired by the public Wafer homepage: atmospheric hero, thin journey line, glass card, editorial product sections. Copy, layout adaptation, and generated atmosphere belong to this project. Wafer assets, endorsements, and customer logos are not reused.
