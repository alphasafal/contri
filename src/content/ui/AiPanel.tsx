import { useEffect, useState } from 'react';
import { latestComments } from '../../core/digest';
import { plural } from '../../shared/format';
import { aiAvailability, firstSteps, summarizeThread, type Availability } from '../ai';
import { Note } from './common';
import { SparkleIcon } from './icons';

type Kind = 'digest' | 'steps';

/**
 * Without an on-device model (most browsers today) the panel still answers "what is the
 * latest here?": the last few comments, who wrote them and whether they are on the team.
 * No AI, no extra request: it reads the transcript the issue check already loaded.
 */
function ThreadGlancePanel({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const glance = latestComments(text);
  const note = (
    <p className="cc-caption">
      AI summaries need a browser with a built-in on-device model (desktop Chrome today). The contribution brief below
      works with any AI chat.
    </p>
  );
  if (!glance.comments.length) return note;
  return (
    <div className="cc-ai">
      <div className="cc-ai-head">
        <b>Latest in the thread</b>
        <span className="cc-caption">no AI · straight from the comments</span>
      </div>
      <div className="cc-presets">
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide' : `Show the last ${plural(glance.comments.length, 'comment')}`}
        </button>
      </div>
      {open && (
        <>
          {glance.earlier > 0 && <p className="cc-caption">{plural(glance.earlier, 'earlier comment')} not shown.</p>}
          {glance.comments.map((c) => (
            <div className="cc-ai-output" key={`${c.who}${c.date}${c.text.slice(0, 24)}`}>
              <span className="cc-eyebrow">
                {c.who}
                {c.team ? ' · PROJECT TEAM' : ''} · {c.date}
              </span>
              <p>{c.text}</p>
            </div>
          ))}
        </>
      )}
      {note}
    </div>
  );
}

/**
 * On-device help for one issue. Runs Chrome's local model only after a click; the
 * thread never leaves the browser. Output is plain text and may be wrong — the UI says so.
 */
export function AiPanel({
  text,
  truncated,
  onDigest,
}: {
  text: string;
  truncated: boolean;
  onDigest?: (digest: string) => void;
}) {
  const [available, setAvailable] = useState<{ summary: Availability; prompt: Availability } | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [output, setOutput] = useState<Partial<Record<Kind, string>>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    void aiAvailability().then(setAvailable);
  }, []);

  if (!available) return null;
  if (available.summary === 'unavailable' && available.prompt === 'unavailable')
    return <ThreadGlancePanel text={text} />;

  const run = async (kind: Kind) => {
    setBusy(kind);
    setError('');
    setProgress(null);
    try {
      const result = kind === 'digest' ? await summarizeThread(text, setProgress) : await firstSteps(text, setProgress);
      setOutput((o) => ({ ...o, [kind]: result }));
      if (kind === 'digest') onDigest?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The on-device model could not run.');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const needsDownload = (a: Availability) => a === 'downloadable' || a === 'downloading';

  return (
    <div className="cc-ai">
      <div className="cc-ai-head">
        <SparkleIcon size={14} />
        <b>On-device AI</b>
        <span className="cc-caption">runs locally · nothing is uploaded</span>
      </div>
      <div className="cc-presets">
        {available.summary !== 'unavailable' && (
          <button onClick={() => void run('digest')} disabled={busy !== null}>
            {busy === 'digest' ? 'Summarizing…' : 'Summarize the thread'}
          </button>
        )}
        {available.prompt !== 'unavailable' && (
          <button onClick={() => void run('steps')} disabled={busy !== null}>
            {busy === 'steps' ? 'Thinking…' : 'How do I start?'}
          </button>
        )}
      </div>
      {available.prompt === 'unavailable' && available.summary !== 'unavailable' && (
        <p className="cc-caption">“How do I start?” needs Chrome 148 or later (the Prompt API on web pages).</p>
      )}
      {(needsDownload(available.summary) || needsDownload(available.prompt)) &&
        !busy &&
        !output.digest &&
        !output.steps && <p className="cc-caption">The first run downloads Chrome&apos;s on-device model once.</p>}
      {progress !== null && <p className="cc-caption">Downloading model… {Math.round(progress * 100)}%</p>}
      {error && <Note>{error}</Note>}
      {output.digest && (
        <div className="cc-ai-output">
          <span className="cc-eyebrow">THREAD DIGEST</span>
          <p>{output.digest}</p>
        </div>
      )}
      {output.steps && (
        <div className="cc-ai-output">
          <span className="cc-eyebrow">HOW TO START</span>
          <p>{output.steps}</p>
        </div>
      )}
      {(output.digest || output.steps) && (
        <p className="cc-caption">
          AI output can be wrong{truncated ? ' and only covered part of a long thread' : ''}. Check it against the
          thread.
        </p>
      )}
    </div>
  );
}
