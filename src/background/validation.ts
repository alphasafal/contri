import { normalizeSaved } from '../core/brief';
import { BULK_LIMIT } from './reports/insight';
import { LABELS } from './reports/issues';
import { parseRepo } from '../shared/repo';
import { CACHED_OPS, TRUSTED_OPS, type Message, type Operation } from '../shared/protocol';

const ALL_OPS: Operation[] = [
  ...CACHED_OPS,
  'saved',
  'save',
  'removeSaved',
  'watchList',
  'watchAdd',
  'watchRemove',
  'prefs',
  'setPrefs',
  'connection',
  'settings',
  'refresh',
  ...TRUSTED_OPS,
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function fail(message: string): never {
  throw new Error(message);
}

function requireRepo(input: Record<string, unknown>) {
  if (typeof input.repo !== 'string' || parseRepo(input.repo) !== input.repo) fail('Invalid repository');
}

function requireNumber(value: unknown, max = 1e9) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) fail('Invalid number');
}

/**
 * Every message from a content script is untrusted: GitHub pages are third-party
 * content. Only an allow-list of operations and shapes reaches the worker.
 */
export function validateMessage(value: unknown, trusted: boolean): Message {
  if (!isObject(value)) fail('Invalid request');
  const { op, input, force, cacheOnly } = value as {
    op: Operation;
    input: unknown;
    force?: unknown;
    cacheOnly?: unknown;
  };
  if (!isObject(input)) fail('Invalid input');
  if (!ALL_OPS.includes(op)) fail('Operation not allowed');
  if ((TRUSTED_OPS as readonly string[]).includes(op) && !trusted) fail('Operation not allowed');
  if (force !== undefined && typeof force !== 'boolean') fail('Invalid request');
  if (cacheOnly !== undefined && typeof cacheOnly !== 'boolean') fail('Invalid request');

  switch (op) {
    case 'repo':
    case 'overview':
    case 'team':
    case 'documents':
      requireRepo(input);
      break;
    case 'insight':
      requireRepo(input);
      requireNumber(input.number);
      break;
    case 'insights': {
      requireRepo(input);
      const numbers = input.numbers;
      if (!Array.isArray(numbers) || numbers.length < 1 || numbers.length > BULK_LIMIT) fail('Invalid issue list');
      for (const n of numbers) requireNumber(n);
      if (new Set(numbers).size !== numbers.length) fail('Invalid issue list');
      break;
    }
    case 'issues':
      requireRepo(input);
      if (!LABELS.includes(String(input.label))) fail('Invalid issue filters');
      if (!['updated', 'created'].includes(String(input.sort))) fail('Invalid issue filters');
      if (typeof input.query !== 'string' || input.query.length > 100) fail('Invalid issue filters');
      if (typeof input.unassigned !== 'boolean') fail('Invalid issue filters');
      requireNumber(input.page, 10);
      break;
    case 'discover':
      if (typeof input.query !== 'string' || input.query.length > 80) fail('Invalid search');
      if (typeof input.language !== 'string' || input.language.length > 30) fail('Invalid search');
      if (typeof input.personalize !== 'boolean') fail('Invalid search');
      break;
    case 'save':
      if (input.updateNote !== undefined && typeof input.updateNote !== 'boolean') fail('Invalid note update');
      normalizeSaved(input.item as Parameters<typeof normalizeSaved>[0]);
      break;
    case 'removeSaved':
    case 'watchRemove':
      if (typeof input.url !== 'string' || input.url.length > 500) fail('Invalid item');
      break;
    case 'watchAdd':
      requireRepo(input);
      requireNumber(input.number);
      if (typeof input.title !== 'string' || input.title.length > 300) fail('Invalid item');
      break;
    case 'setPrefs': {
      const allowed = trusted ? ['widget', 'badges', 'notifications', 'position'] : ['widget', 'position'];
      for (const key of Object.keys(input)) if (!allowed.includes(key)) fail('Preference not allowed');
      if (input.widget !== undefined && !['launcher', 'issues', 'open'].includes(String(input.widget)))
        fail('Invalid preference');
      if (input.badges !== undefined && !['smart', 'always', 'click', 'off'].includes(String(input.badges)))
        fail('Invalid preference');
      if (input.notifications !== undefined && typeof input.notifications !== 'boolean') fail('Invalid preference');
      if (input.position !== undefined && input.position !== null) {
        if (!isObject(input.position)) fail('Invalid position');
        for (const k of ['x', 'y'])
          if (
            typeof input.position[k] !== 'number' ||
            !Number.isFinite(input.position[k]) ||
            Math.abs(input.position[k] as number) > 100_000
          )
            fail('Invalid position');
      }
      break;
    }
    case 'connect':
      if (typeof input.token !== 'string' || typeof input.remember !== 'boolean') fail('Invalid connection request');
      break;
    case 'devicePoll':
      if (typeof input.remember !== 'boolean') fail('Invalid connection request');
      break;
  }
  return { op, input, force: force === true, cacheOnly: cacheOnly === true } as Message;
}
