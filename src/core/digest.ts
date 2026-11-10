/**
 * The last few comments of a thread transcript (see `threadText` in reports/insight.ts),
 * for browsers without an on-device model: no summary, just what was said most recently
 * and by whom. Pure text handling; nothing here calls a model or the network.
 */

export type GlanceComment = { who: string; team: boolean; date: string; text: string };
export type ThreadGlance = { comments: GlanceComment[]; earlier: number };

const HEADER = /^--- (@[^\s,(]+)( \(project team\))?, (\d{4}-\d{2}-\d{2})\n?/;

/** Comment bodies cannot start a line with `---` (the transcript neutralizes it), so headers are unambiguous. */
export function latestComments(transcript: string, keep = 3, maxLength = 280): ThreadGlance {
  const blocks = transcript.split(/\n(?=--- @)/).slice(1);
  const comments: GlanceComment[] = [];
  for (const block of blocks.slice(-keep)) {
    const header = HEADER.exec(block);
    if (!header) continue;
    const text = block.slice(header[0].length).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    comments.push({
      who: header[1],
      team: Boolean(header[2]),
      date: header[3],
      text: text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text,
    });
  }
  return { comments, earlier: Math.max(0, blocks.length - comments.length) };
}
