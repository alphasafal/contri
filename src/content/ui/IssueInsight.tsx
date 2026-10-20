import { useState } from 'react';
import type { InsightReport } from '../../background/reports/insight';
import { verdict } from '../../core/verdict';
import { plural, time } from '../../shared/format';
import { AiPanel } from './AiPanel';
import { BriefPanel } from './BriefPanel';
import { Checked, Ext, Observed, VerdictPill, Warnings } from './common';
import { SaveButton, WatchButton } from './SaveButton';

const prLabel = (p: InsightReport['link']['prs'][number]) =>
  p.state === 'merged' ? 'Merged' : p.state === 'open' ? (p.draft ? 'Draft' : 'Open') : 'Closed';

/** Everything a contributor needs to decide "can I take this issue?" */
export function IssueInsight({
  repo,
  report,
  onRefresh,
  busy,
}: {
  repo: string;
  report: InsightReport;
  onRefresh?: () => void;
  busy?: boolean;
}) {
  const [digest, setDigest] = useState('');
  const v = verdict({
    repo,
    issueState: report.issue.state,
    link: report.link,
    claim: report.claim,
    discussion: report.discussion,
    comments: report.issue.comments,
  });
  const { issue, link, claim, discussion } = report;
  return (
    <div className="cc-insight">
      <VerdictPill verdict={v} />
      {claim.claim && (
        <div className="cc-claim">
          <span className="cc-caption">Latest claim</span>
          <Ext href={claim.claim.url}>
            @{claim.claim.login} · {time(claim.claim.at)}
          </Ext>
          <q>{claim.claim.text}</q>
        </div>
      )}
      {link.prs.length > 0 && (
        <div className="cc-references">
          <span className="cc-caption">Pull requests referencing this issue</span>
          {link.prs.map((p) => (
            <div className={`cc-reference cc-pr-${p.state}`} key={p.url}>
              <Ext href={p.url}>
                {prLabel(p)} #{p.number}: {p.title}
              </Ext>
              <small>
                {p.author ? `@${p.author}` : 'unknown author'}
                {p.closing ? ' · linked as a fix' : ' · mentioned'}
                {p.repo !== repo ? ` · ${p.repo}` : ''}
              </small>
            </div>
          ))}
        </div>
      )}
      <p className="cc-caption">{link.note}</p>
      <Observed event={discussion.latest} label="Latest human comment" />
      <p className="cc-caption">
        {plural(discussion.teamComments, 'team comment')} · {plural(issue.comments, 'comment')} in total
        {discussion.complete ? '' : ` (latest ${discussion.inspected} inspected)`}
      </p>
      <AiPanel text={report.thread.text} truncated={report.thread.truncated} onDigest={setDigest} />
      <div className="cc-actions cc-actions-inline">
        <WatchButton repo={repo} number={issue.number} title={issue.title} />
        <SaveButton item={{ repo, url: issue.url, title: issue.title, note: '' }} />
      </div>
      <BriefPanel
        item={{ repo, title: issue.title, number: issue.number, url: issue.url }}
        evidence={{
          linkState: link.state,
          linkedPrs: link.prs.map((p) => ({
            state: p.state,
            draft: p.draft,
            merged: p.state === 'merged',
            url: p.url,
          })),
          claim,
          checkedAt: report.checkedAt,
          digest,
        }}
      />
      <Checked at={report.checkedAt} onRefresh={onRefresh} busy={busy} />
      <Warnings items={report.warnings} />
    </div>
  );
}
