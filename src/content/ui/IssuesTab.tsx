import { useEffect, useRef, useState } from 'react';
import type { IssueRow } from '../../background/reports/issues';
import type { InsightReport } from '../../background/reports/insight';
import { verdict } from '../../core/verdict';
import { ago, plural } from '../../shared/format';
import { call } from '../../shared/protocol';
import { Ext, Loading, Note, VerdictPill, Warnings } from './common';
import { useRequest } from './hooks';
import { ArrowIcon, SearchIcon } from './icons';
import { IssueInsight } from './IssueInsight';

/** The issue currently open in the GitHub tab. */
function CurrentIssue({ repo, number }: { repo: string; number: number }) {
  const result = useRequest('insight', { repo, number });
  return (
    <div className="cc-current">
      <span className="cc-eyebrow">THIS ISSUE · #{number}</span>
      {result.value && <h3>{result.value.issue.title}</h3>}
      {result.loading && !result.value && <Loading>Checking assignees, claims and linked pull requests…</Loading>}
      {result.error && <Note onRetry={() => result.reload(true)}>{result.error}</Note>}
      {result.value && (
        <IssueInsight repo={repo} report={result.value} onRefresh={() => result.reload(true)} busy={result.loading} />
      )}
    </div>
  );
}

function IssueCard({
  repo,
  item,
  report,
  checking,
  onCheck,
}: {
  repo: string;
  item: IssueRow;
  report?: InsightReport;
  checking: boolean;
  onCheck: () => void;
}) {
  const [open, setOpen] = useState(false);
  const quick =
    item.assignees.length > 0
      ? `Assigned to ${item.assignees.map((a) => `@${a}`).join(', ')}`
      : item.linkedOpen === null
        ? null
        : item.linkedOpen > 0
          ? `${item.linkedOpen} open PR linked`
          : 'No open PR linked';
  return (
    <div className="cc-issue">
      <Ext href={item.url}>
        #{item.number} {item.title}
      </Ext>
      <div className="cc-tags">
        {item.labels.slice(0, 4).map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <small>
        {plural(item.comments, 'comment')} · updated {ago(item.updatedAt)}
        {quick ? ` · ${quick}` : ''}
      </small>
      {report && !open && (
        <VerdictPill
          verdict={verdict({
            repo,
            issueState: report.issue.state,
            link: report.link,
            claim: report.claim,
            discussion: report.discussion,
            comments: report.issue.comments,
          })}
          compact
        />
      )}
      <button
        className="cc-link-button"
        disabled={checking}
        onClick={() => {
          if (!report) onCheck();
          setOpen((o) => !o);
        }}
      >
        {checking ? 'Checking…' : open && report ? 'Hide details' : report ? 'Show details' : 'Can I work on this?'}
      </button>
      {open && report && <IssueInsight repo={repo} report={report} />}
    </div>
  );
}

export function IssuesTab({
  repo,
  focusIssue,
  signedIn,
}: {
  repo: string;
  focusIssue: number | null;
  signedIn: boolean;
}) {
  const [label, setLabel] = useState('beginner');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [unassigned, setUnassigned] = useState(true);
  const [onlyFree, setOnlyFree] = useState(false);
  const [sort, setSort] = useState<'updated' | 'created'>('updated');
  const [page, setPage] = useState(1);
  const result = useRequest('issues', { repo, label, query, unassigned, sort, page });
  const [reports, setReports] = useState<Record<number, InsightReport>>({});
  const [checking, setChecking] = useState<number[]>([]);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());

  // The tab remounts when the repository changes, so only in-flight checks need cancelling.
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, [repo]);

  const check = async (n: number) => {
    setChecking((c) => [...c, n]);
    try {
      const value = await call('insight', { repo, number: n }, { signal: controller.current.signal });
      setReports((r) => ({ ...r, [n]: value }));
    } catch (e) {
      if (!controller.current.signal.aborted) setError((e as Error).message);
    } finally {
      setChecking((c) => c.filter((x) => x !== n));
    }
  };

  const rows = (result.value?.items ?? []).filter((i) => i.number !== focusIssue);
  const bulk = result.value?.linkCheck === 'bulk';
  const isFree = (i: IssueRow) => {
    const r = reports[i.number];
    if (r)
      return (
        verdict({
          repo,
          issueState: r.issue.state,
          link: r.link,
          claim: r.claim,
          discussion: r.discussion,
          comments: r.issue.comments,
        }).tone === 'good'
      );
    return bulk ? i.linkedOpen === 0 && !i.assignees.length : false;
  };
  const visible = onlyFree ? rows.filter(isFree) : rows;
  const unchecked = rows.filter((i) => !reports[i.number] && !checking.includes(i.number));

  const checkNext = async () => {
    for (const item of unchecked.slice(0, 5)) {
      if (controller.current.signal.aborted) break;
      await check(item.number);
    }
  };

  return (
    <section className="cc-section">
      {focusIssue && <CurrentIssue repo={repo} number={focusIssue} />}
      <span className="cc-eyebrow">FIND YOUR OPENING</span>
      <h2>Issues worth your time.</h2>
      <div className="cc-presets">
        <button
          aria-pressed={label === 'beginner' && onlyFree}
          onClick={() => {
            setLabel('beginner');
            setUnassigned(true);
            setOnlyFree(true);
            setPage(1);
          }}
        >
          First contribution
        </button>
        <button
          aria-pressed={label === '' && !onlyFree}
          onClick={() => {
            setLabel('');
            setUnassigned(false);
            setOnlyFree(false);
            setPage(1);
          }}
        >
          All open issues
        </button>
      </div>
      <form
        className="cc-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(text);
          setPage(1);
        }}
      >
        <SearchIcon size={15} />
        <input
          aria-label="Search issues"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search titles and discussion"
          maxLength={100}
        />
        <button aria-label="Search issues">
          <ArrowIcon size={16} />
        </button>
      </form>
      <div className="cc-filters">
        <select
          aria-label="Label"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setPage(1);
          }}
        >
          <option value="beginner">Good first issue or help wanted</option>
          <option value="">All labels</option>
          {['good first issue', 'help wanted', 'documentation', 'bug'].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select aria-label="Order" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="updated">Recently updated</option>
          <option value="created">Newest</option>
        </select>
      </div>
      <label className="cc-check">
        <input type="checkbox" checked={unassigned} onChange={(e) => setUnassigned(e.target.checked)} />
        Unassigned only
      </label>
      <label className="cc-check">
        <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
        Looks free (no claim or open PR)
      </label>
      {onlyFree && !bulk && (
        <div className="cc-callout">
          <p className="cc-caption">
            Anonymous mode checks issues one by one ({unchecked.length} unchecked). Signing in checks a whole page in
            one request.
          </p>
          <button
            className="cc-secondary"
            disabled={!unchecked.length || checking.length > 0}
            onClick={() => void checkNext()}
          >
            {checking.length ? 'Checking…' : 'Check the next five'}
          </button>
        </div>
      )}
      {result.loading && !result.value && <Loading>Finding open issues…</Loading>}
      {result.error && <Note onRetry={() => result.reload(true)}>{result.error}</Note>}
      {!result.error && error && <Note>{error}</Note>}
      {result.value?.incomplete && <Note tone="info">GitHub returned incomplete search results.</Note>}
      {visible.map((item) => (
        <IssueCard
          key={item.number}
          repo={repo}
          item={item}
          report={reports[item.number]}
          checking={checking.includes(item.number)}
          onCheck={() => void check(item.number)}
        />
      ))}
      {result.value && !visible.length && !result.loading && (
        <p className="cc-caption">
          {onlyFree
            ? bulk
              ? 'No free-looking issues on this page. Try the next page or broader labels.'
              : 'No checked issue looks free yet. Check more, or change the filters.'
            : 'No matching open issues. Try broader labels.'}
        </p>
      )}
      {result.value && (
        <div className="cc-pagination">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} · {result.value.total.toLocaleString()} matches
          </span>
          <button disabled={!result.value.hasNext} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
      {result.value && <Warnings items={result.value.warnings} />}
      <p className="cc-caption">
        Labels show project intent, not guaranteed difficulty.{' '}
        {signedIn ? '' : 'Sign in to check linked pull requests for a whole page at once.'}
      </p>
    </section>
  );
}
