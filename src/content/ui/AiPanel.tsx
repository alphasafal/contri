import { useEffect, useState } from 'react';
import { aiAvailability, firstSteps, summarizeThread, type Availability } from '../ai';
import { Note } from './common';
import { SparkleIcon } from './icons';

type Kind = 'digest' | 'steps';

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
    return (
      <p className="cc-caption">
        On-device AI summaries need Chrome with built-in AI (Gemini Nano). Use the contribution brief below with any AI
        chat instead.
      </p>
    );

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
