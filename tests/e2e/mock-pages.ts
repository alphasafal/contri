/**
 * GitHub-like pages for the mock server. They mirror the structure CONTRI anchors to
 * (issue title, About sidebar) and look close enough to GitHub for honest screenshots.
 * Everything here is fictional sample content (acme/widgets).
 */

const CSS = `
:root{--bg:#fff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--subtle:#f6f8fa;--accent:#0969da;--green:#1a7f37;--chip:#ddf4ff;--chipfg:#0969da;--header:#f6f8fa}
[data-color-mode=dark]{--bg:#0d1117;--fg:#f0f6fc;--muted:#9198a1;--border:#3d444d;--subtle:#151b23;--accent:#4493f8;--green:#3fb950;--chip:#388bfd26;--chipfg:#4493f8;--header:#010409}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}
a{color:var(--accent);text-decoration:none}
.top{background:var(--header);border-bottom:1px solid var(--border);padding:14px 32px 0}
.crumb{display:flex;align-items:center;gap:10px;font-size:20px}
.site{width:32px;height:32px;border-radius:50%;background:var(--fg);opacity:.85}
.crumb b{font-weight:600}.crumb span{color:var(--muted)}
.pill{border:1px solid var(--border);border-radius:2em;padding:0 8px;font-size:12px;color:var(--muted);margin-left:4px}
.tabs{display:flex;gap:4px;margin-top:14px}.tabs a{color:var(--fg);padding:8px 12px;border-bottom:2px solid transparent;font-size:14px}
.tabs a.on{border-color:#fd8c73;font-weight:600}.tabs i{font-style:normal;background:var(--subtle);border:1px solid var(--border);border-radius:2em;padding:0 6px;font-size:12px;margin-left:6px}
.wrap{display:flex;gap:28px;padding:24px 32px;max-width:1280px}
.main{flex:1;min-width:0}.Layout-sidebar{width:296px;flex:none}
.box{border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:16px}
.box-head{background:var(--subtle);padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;color:var(--muted)}
.row{display:flex;justify-content:space-between;padding:8px 16px;border-top:1px solid var(--border);font-size:14px}.row:first-of-type{border-top:0}.row span{color:var(--muted)}
.readme{padding:24px 32px}.readme h2{font-size:24px;border-bottom:1px solid var(--border);padding-bottom:8px;margin:0 0 16px}
.BorderGrid-cell h2{font-size:16px;margin:0 0 14px}.BorderGrid-cell p{margin:0 0 14px;font-size:16px}
.topics{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}.topics a{background:var(--chip);color:var(--chipfg);border-radius:2em;padding:0 10px;font-size:12px;line-height:22px;font-weight:500}
.meta{color:var(--muted);font-size:14px;display:grid;gap:8px}
.issue-head{border-bottom:1px solid var(--border);padding-bottom:16px;margin-bottom:20px}
.issue-head h1{font-size:32px;font-weight:400;margin:0 0 8px}.issue-head h1 span{color:var(--muted);font-weight:300}
.state{display:inline-block;background:var(--green);color:#fff;border-radius:2em;padding:4px 12px;font-size:14px;font-weight:500;margin-right:8px}
.comment{display:flex;gap:16px;margin-bottom:18px}.avatar{width:40px;height:40px;border-radius:50%;flex:none;background:linear-gradient(135deg,#8fb3a8,#476263)}
.comment .box{flex:1;margin:0}.comment .box-head b{color:var(--fg)}.comment p{margin:0;padding:14px 16px}
.side h3{font-size:12px;color:var(--muted);margin:0 0 6px;font-weight:600}.side div{border-bottom:1px solid var(--border);padding:12px 0;font-size:12px;color:var(--muted)}
`;

const shell = (title: string, tabs: string, body: string) => `<!doctype html><html lang="en" data-color-mode="light">
<head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>
<header class="top"><div class="crumb"><div class="site"></div><span>acme</span><span>/</span><b>widgets</b><span class="pill">Public</span></div>
<nav class="tabs">${tabs}</nav></header>${body}</body></html>`;

const tabs = (on: 'code' | 'issues') =>
  `<a class="${on === 'code' ? 'on' : ''}" href="/acme/widgets">Code</a><a class="${on === 'issues' ? 'on' : ''}" href="/acme/widgets/issues">Issues<i>12</i></a><a href="#">Pull requests<i>4</i></a><a href="#">Actions</a><a href="#">Insights</a>`;

const FILES = [
  ['.github', 'ci: run tests on pull requests', '3 days ago'],
  ['docs', 'docs: explain theming', 'last week'],
  ['src', 'fix: guard double open (#62)', '2 days ago'],
  ['tests', 'test: cover dark tooltips', '5 days ago'],
  ['CONTRIBUTING.md', 'docs: how to run locally', '2 weeks ago'],
  ['LICENSE', 'Initial commit', '2 years ago'],
  ['README.md', 'docs: new screenshots', 'yesterday'],
  ['package.json', 'chore: bump version', '3 weeks ago'],
];

export const repoPage = () =>
  shell(
    'acme/widgets',
    tabs('code'),
    `<div class="wrap"><div class="main">
      <div class="box"><div class="box-head"><b>ana</b> fix: guard double open (#62) · 2 days ago · 412 commits</div>
      ${FILES.map(([f, m, t]) => `<div class="row"><a href="#">${f}</a><span>${m}</span><span>${t}</span></div>`).join('')}</div>
      <div class="box"><div class="readme"><h2>widgets</h2><p>Accessible, themeable UI widgets for the web. Fast, tiny and framework-agnostic.</p>
      <p><a id="go-issue" href="/acme/widgets/issues/7">Good first issues</a> are a great place to start.</p></div></div>
    </div>
    <aside class="Layout-sidebar"><div class="BorderGrid-cell"><h2>About</h2><p>Widgets for everyone</p>
      <div class="topics"><a>widgets</a><a>accessibility</a><a>typescript</a><a>ui</a></div>
      <div class="meta"><span>MIT license</span><span>1.2k stars</span><span>34 watching</span><span>56 forks</span></div></div></aside></div>`,
  );

export const issuePage = (n: number) =>
  shell(
    `Fix the widget crash · Issue #${n}`,
    tabs('issues'),
    `<div class="wrap"><div class="main">
      <div class="issue-head" data-testid="issue-header"><h1><bdi data-testid="issue-title">Fix the widget crash</bdi> <span>#${n}</span></h1>
      <span class="state">Open</span><span style="color:var(--muted)"><b>reporter</b> opened this issue 3 months ago · 2 comments</span></div>
      <div class="comment"><div class="avatar"></div><div class="box"><div class="box-head"><b>reporter</b> commented 3 months ago</div><p>The widget crashes when it is opened twice in a row. Steps: open the menu, close it, open it again.</p></div></div>
      <div class="comment"><div class="avatar"></div><div class="box"><div class="box-head"><b>sam</b> commented 45 days ago</div><p>Hi! I'd like to work on this.</p></div></div>
      <div class="comment"><div class="avatar"></div><div class="box"><div class="box-head"><b>quietmaint</b> commented 44 days ago</div><p>Sure, go ahead.</p></div></div>
    </div>
    <aside class="Layout-sidebar side"><div><h3>Assignees</h3>No one assigned</div><div><h3>Labels</h3><span class="topics"><a>good first issue</a></span></div><div><h3>Development</h3>No branches or pull requests</div></aside></div>`,
  );

const LIST = [
  [7, 'Fix the widget crash', 'reporter', '3 months ago'],
  [8, 'Tooltip is cut off on small screens', 'mia', '2 weeks ago'],
  [9, 'Document the theming API', 'raj', '5 days ago'],
] as const;

/**
 * The issue list in the three shapes CONTRI's list badges handle: GitHub's current list
 * (`data-testid="issue-pr-title-link"`), the older one (`id="issue_7_link"`), and a layout
 * with neither marker, where only the link target identifies a title.
 */
export const issuesListPage = (layout: 'current' | 'legacy' | 'plain' = 'current') => {
  const title = (n: number, text: string) =>
    layout === 'current'
      ? `<h3 style="margin:0;font-size:16px"><a data-testid="issue-pr-title-link" href="/acme/widgets/issues/${n}">${text}</a></h3>`
      : layout === 'legacy'
        ? `<a id="issue_${n}_link" class="js-navigation-open" data-hovercard-type="issue" href="/acme/widgets/issues/${n}" style="font-size:16px;font-weight:600">${text}</a>`
        : `<strong><a href="/acme/widgets/issues/${n}">${text}</a></strong>`;
  return shell(
    'Issues · acme/widgets',
    tabs('issues'),
    `<div class="wrap"><main class="main"><div class="box"><div class="box-head">3 Open · 9 Closed</div>
      ${LIST.map(
        ([n, text, author, when]) =>
          `<div class="row" data-issue="${n}" style="display:block">${title(n, text)}<span>#${n} · ${author} opened ${when}</span>
          <a href="/acme/widgets/issues/${n}" aria-label="2 comments" style="float:right">2</a></div>`,
      ).join('')}
      <div class="row" style="display:block"><a href="/acme/widgets/pull/12">Fix crash</a><span> pull request</span></div>
    </div></main></div>`,
  );
};

export const blankPage = () => shell('GitHub', tabs('code'), '<div class="wrap"><h1>Explore</h1></div>');
