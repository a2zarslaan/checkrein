// Tests for guards/stop-consulted.mjs. Run: node --test guards/stop-consulted.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withDefaults } from './manifest.mjs';
import { evaluateTranscript, parseTranscript, runStop, stopMessage, isRealUserMessage } from './stop-consulted.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stop-consulted.mjs');
const ROOT = '/home/dev/notes-app';
const LOG = 'project-documentation/corrections-log.md';

function manifest(extra = {}) {
  return withDefaults({ checkrein: { manifest_version: 2 }, ...extra });
}

const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } });
const tool = (name, input, extra = {}) => ({
  type: 'assistant',
  ...extra,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input }] },
});
const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

const editSrc = tool('Edit', { file_path: `${ROOT}/src/notes.js`, old_string: 'a', new_string: 'b' });
const readLog = tool('Read', { file_path: `${ROOT}/${LOG}` });

// evaluateTranscript

test('no edits allows', () => {
  const r = evaluateTranscript([user('hello'), say('hi')], manifest(), ROOT);
  assert.deepEqual(r, { edited: [], missing: [] });
});

test('edit outside the code globs allows', () => {
  const entries = [user('fix docs'), tool('Write', { file_path: `${ROOT}/README.md`, content: 'x' })];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT), { edited: [], missing: [] });
});

test('edit outside the repository root is ignored', () => {
  const entries = [user('x'), tool('Edit', { file_path: '/elsewhere/src/a.js' })];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).edited, []);
});

test('edit without evidence names the corrections log', () => {
  const r = evaluateTranscript([user('change notes'), editSrc, toolResult()], manifest(), ROOT);
  assert.deepEqual(r.edited, ['src/notes.js']);
  assert.deepEqual(r.missing, [LOG]);
});

test('nested src globs match', () => {
  const r = evaluateTranscript([user('x'), tool('Write', { file_path: `${ROOT}/apps/web/src/a.ts` })], manifest(), ROOT);
  assert.deepEqual(r.edited, ['apps/web/src/a.ts']);
});

test('Read evidence earlier in the transcript allows', () => {
  const entries = [user('first task'), readLog, toolResult(), say('done'), user('second task'), editSrc, toolResult()];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).missing, []);
});

test('Read evidence matches case-insensitively and with backslashes', () => {
  const entries = [user('x'), tool('Read', { file_path: 'C:\\Dev\\Notes-App\\Project-Documentation\\Corrections-Log.md' }), editSrc];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).missing, []);
});

test('Read of a file that only shares a suffix is not evidence', () => {
  const entries = [user('x'), tool('Read', { file_path: `${ROOT}/old-project-documentation/corrections-log.md` }), editSrc];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).missing, [LOG]);
});

test('Grep whose path names the file allows', () => {
  const entries = [user('x'), tool('Grep', { pattern: '^### Pattern', path: `${ROOT}/${LOG}` }), editSrc];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).missing, []);
});

test('Bash reader evidence allows', () => {
  const entries = [user('x'), tool('Bash', { command: `rg -n '^### Pattern' ${ROOT}/${LOG}` }), editSrc];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).missing, []);
});

test('Bash reader with a directory prefix allows', () => {
  const entries = [user('x'), tool('Bash', { command: `/bin/cat ${LOG} | head -40` }), editSrc];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).missing, []);
});

test('Bash naming the file without a reader is not evidence', () => {
  const entries = [user('x'), tool('Bash', { command: `ls -la ${LOG}` }), editSrc];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).missing, [LOG]);
});

test('required_reads are checked in addition to the corrections log', () => {
  const m = manifest({ consulted: { required_reads: ['./project-documentation/architecture.md', LOG] } });
  const r = evaluateTranscript([user('x'), readLog, editSrc], m, ROOT);
  assert.deepEqual(r.missing, ['project-documentation/architecture.md']);
});

test('custom corrections log path is used', () => {
  const m = manifest({ paths: { corrections_log: 'docs/lessons.md' } });
  const r = evaluateTranscript([user('x'), readLog, editSrc], m, ROOT);
  assert.deepEqual(r.missing, ['docs/lessons.md']);
});

test('only edits after the last real user message count', () => {
  const entries = [user('earlier'), editSrc, toolResult(), say('done'), user('now just answer'), say('answer')];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT), { edited: [], missing: [] });
});

test('tool_result user entries do not end the segment', () => {
  const entries = [user('task'), editSrc, toolResult(), say('more'), toolResult()];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).edited, ['src/notes.js']);
});

test('MultiEdit and NotebookEdit count as edits', () => {
  const entries = [
    user('x'),
    tool('MultiEdit', { file_path: `${ROOT}/src/a.js`, edits: [] }),
    tool('NotebookEdit', { notebook_path: `${ROOT}/src/b.ipynb`, new_source: '' }),
    tool('Edit', { file_path: `${ROOT}/src/a.js` }),
  ];
  assert.deepEqual(evaluateTranscript(entries, manifest(), ROOT).edited, ['src/a.js', 'src/b.ipynb']);
});

test('sidechain lines are ignored for edits, evidence and the user boundary', () => {
  const side = { isSidechain: true };
  const sideEdit = tool('Edit', { file_path: `${ROOT}/src/side.js` }, side);
  const sideRead = tool('Read', { file_path: `${ROOT}/${LOG}` }, side);
  const sideUser = { ...user('subagent prompt'), isSidechain: true };
  assert.deepEqual(evaluateTranscript([user('x'), sideEdit, sideRead], manifest(), ROOT), { edited: [], missing: [] });
  const r = evaluateTranscript([user('x'), editSrc, sideUser, sideRead], manifest(), ROOT);
  assert.deepEqual(r.edited, ['src/notes.js']);
  assert.deepEqual(r.missing, [LOG]);
});

test('isRealUserMessage distinguishes prompts from tool results', () => {
  assert.equal(isRealUserMessage(user('hi')), true);
  assert.equal(isRealUserMessage({ type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }), true);
  assert.equal(isRealUserMessage(toolResult()), false);
  assert.equal(isRealUserMessage(say('hi')), false);
});

test('isRealUserMessage rejects meta and non-human origin entries', () => {
  assert.equal(isRealUserMessage({ ...user('skill body'), isMeta: true }), false);
  assert.equal(isRealUserMessage({ ...user('<task-notification>done</task-notification>'), origin: { kind: 'task-notification' } }), false);
  assert.equal(isRealUserMessage({ ...user('hi'), origin: { kind: 'human' } }), true);
});

test('a meta or task-notification entry mid-turn does not end the segment', () => {
  const meta = { type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'skill body' }] } };
  const note = { ...user('<task-notification>x</task-notification>'), origin: { kind: 'task-notification' } };
  for (const injected of [meta, note]) {
    const r = evaluateTranscript([user('task'), editSrc, toolResult(), injected, say('done')], manifest(), ROOT);
    assert.deepEqual(r.edited, ['src/notes.js']);
    assert.deepEqual(r.missing, [LOG]);
  }
});

test('parseTranscript skips blank and unparseable lines', () => {
  const text = [JSON.stringify(user('x')), '', '{not json', 'null', '[1]', JSON.stringify(editSrc)].join('\n');
  assert.equal(parseTranscript(text).length, 2);
});

test('stopMessage block and warn shapes', () => {
  const r = { edited: ['src/a.js'], missing: [LOG] };
  const block = stopMessage(r, 'block');
  assert.equal(block.decision, 'block');
  assert.match(block.reason, /corrections-log\.md/);
  assert.match(block.reason, /re-check the work/);
  assert.match(block.reason, /against it,/);
  const warn = stopMessage(r, 'warn');
  assert.deepEqual(Object.keys(warn), ['systemMessage']);
  assert.match(warn.systemMessage, /corrections-log\.md/);
  assert.match(warn.systemMessage, /Read it and re-check the work against it\./);
  const two = stopMessage({ edited: ['src/a.js'], missing: [LOG, 'docs/b.md'] }, 'block');
  assert.match(two.reason, /against them,/);
});

test('stopMessage caps long lists', () => {
  const edited = Array.from({ length: 12 }, (_, i) => `src/f${i}.js`);
  const msg = stopMessage({ edited, missing: [LOG] }, 'block');
  assert.match(msg.reason, /and 7 more/);
});

// runStop and the entry point, with temp repositories and JSONL files

function makeRepo(manifestValue) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkrein-stop-'));
  if (manifestValue !== undefined) {
    const text = typeof manifestValue === 'string' ? manifestValue : JSON.stringify(manifestValue);
    fs.writeFileSync(path.join(dir, 'checkrein.json'), text);
  }
  return dir;
}

function writeTranscript(dir, entries, extraText = '') {
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + extraText);
  return file;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const V2 = { checkrein: { manifest_version: 2 } };
const editIn = (dir) => tool('Edit', { file_path: path.join(dir, 'src', 'notes.js') });
const readIn = (dir) => tool('Read', { file_path: path.join(dir, LOG) });

test('runStop blocks a JSONL transcript without evidence', () => {
  const dir = makeRepo(V2);
  try {
    const t = writeTranscript(dir, [user('x'), editIn(dir)], '\n{partial');
    const out = runStop({ hook_event_name: 'Stop', transcript_path: t, cwd: dir, stop_hook_active: false }, dir);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /corrections-log\.md/);
  } finally {
    cleanup(dir);
  }
});

test('runStop allows a JSONL transcript with evidence', () => {
  const dir = makeRepo(V2);
  try {
    const t = writeTranscript(dir, [user('x'), readIn(dir), editIn(dir)]);
    assert.equal(runStop({ transcript_path: t, cwd: dir }, dir), null);
  } finally {
    cleanup(dir);
  }
});

test('runStop warn mode prints a systemMessage', () => {
  const dir = makeRepo({ ...V2, consulted: { mode: 'warn' } });
  try {
    const t = writeTranscript(dir, [user('x'), editIn(dir)]);
    const out = runStop({ transcript_path: t, cwd: dir }, dir);
    assert.equal(out.decision, undefined);
    assert.match(out.systemMessage, /corrections-log\.md/);
  } finally {
    cleanup(dir);
  }
});

test('runStop allows when stop_hook_active is true', () => {
  const dir = makeRepo(V2);
  try {
    const t = writeTranscript(dir, [user('x'), editIn(dir)]);
    assert.equal(runStop({ transcript_path: t, cwd: dir, stop_hook_active: true }, dir), null);
  } finally {
    cleanup(dir);
  }
});

test('runStop allows an empty, missing or unreadable transcript', () => {
  const dir = makeRepo(V2);
  try {
    const empty = path.join(dir, 'empty.jsonl');
    fs.writeFileSync(empty, '');
    const junk = path.join(dir, 'junk.jsonl');
    fs.writeFileSync(junk, 'not json\n');
    assert.equal(runStop({ transcript_path: empty, cwd: dir }, dir), null);
    assert.equal(runStop({ transcript_path: junk, cwd: dir }, dir), null);
    assert.equal(runStop({ transcript_path: path.join(dir, 'absent.jsonl'), cwd: dir }, dir), null);
    assert.equal(runStop({ transcript_path: dir, cwd: dir }, dir), null);
    assert.equal(runStop({ cwd: dir }, dir), null);
  } finally {
    cleanup(dir);
  }
});

test('runStop is silent with no manifest or a version 1 manifest', () => {
  for (const value of [undefined, { checkrein: { manifest_version: 1 } }]) {
    const dir = makeRepo(value);
    try {
      const t = writeTranscript(dir, [user('x'), editIn(dir)]);
      assert.equal(runStop({ transcript_path: t, cwd: dir }, dir), null);
    } finally {
      cleanup(dir);
    }
  }
});

test('runStop falls back to cwd when no project dir is given', () => {
  const dir = makeRepo(V2);
  try {
    const t = writeTranscript(dir, [user('x'), editIn(dir)]);
    assert.equal(runStop({ transcript_path: t, cwd: dir }, undefined).decision, 'block');
  } finally {
    cleanup(dir);
  }
});

test('runStop fails closed on a corrupt manifest', () => {
  const dir = makeRepo('{ not json');
  try {
    const t = writeTranscript(dir, [user('x')]);
    const out = runStop({ transcript_path: t, cwd: dir }, dir);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /not valid JSON/);
    assert.doesNotMatch(out.reason, /checkrein: .*checkrein: /);
  } finally {
    cleanup(dir);
  }
});

test('runStop allows when the transcript lags behind last_assistant_message', () => {
  const dir = makeRepo(V2);
  try {
    const t = writeTranscript(dir, [user('x'), editIn(dir), toolResult(), say('previous turn done')]);
    const lagging = { transcript_path: t, cwd: dir, last_assistant_message: 'this turn answer' };
    assert.equal(runStop(lagging, dir), null);
    const current = { transcript_path: t, cwd: dir, last_assistant_message: 'previous turn done' };
    assert.equal(runStop(current, dir).decision, 'block');
  } finally {
    cleanup(dir);
  }
});

test('runStop is silent for a non-object input when inactive and blocks when active', () => {
  const bare = makeRepo(undefined);
  const dir = makeRepo(V2);
  try {
    assert.equal(runStop(null, bare), null);
    assert.equal(runStop('x', bare), null);
    assert.equal(runStop(null, dir).decision, 'block');
  } finally {
    cleanup(bare);
    cleanup(dir);
  }
});

function runEntry(input, dir) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  return spawnSync(process.execPath, [SCRIPT], { input: stdin, env, encoding: 'utf8' });
}

test('entry point blocks through stdin and stdout', () => {
  const dir = makeRepo(V2);
  try {
    const t = writeTranscript(dir, [user('x'), editIn(dir), toolResult()]);
    const r = runEntry({ session_id: 's', transcript_path: t, cwd: dir, hook_event_name: 'Stop', stop_hook_active: false }, dir);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /corrections-log\.md/);
  } finally {
    cleanup(dir);
  }
});

test('entry point prints nothing when evidence exists, when stop_hook_active, and when inactive', () => {
  const dir = makeRepo(V2);
  const bare = makeRepo(undefined);
  try {
    const good = writeTranscript(dir, [user('x'), readIn(dir), editIn(dir)]);
    const r1 = runEntry({ transcript_path: good, cwd: dir, hook_event_name: 'Stop' }, dir);
    assert.equal(r1.status, 0);
    assert.equal(r1.stdout, '');
    const bad = writeTranscript(dir, [user('x'), editIn(dir)]);
    const r2 = runEntry({ transcript_path: bad, cwd: dir, hook_event_name: 'Stop', stop_hook_active: true }, dir);
    assert.equal(r2.status, 0);
    assert.equal(r2.stdout, '');
    const t3 = writeTranscript(bare, [user('x'), editIn(bare)]);
    const r3 = runEntry({ transcript_path: t3, cwd: bare, hook_event_name: 'Stop' }, bare);
    assert.equal(r3.status, 0);
    assert.equal(r3.stdout, '');
  } finally {
    cleanup(dir);
    cleanup(bare);
  }
});

test('entry point blocks with the error on invalid stdin', () => {
  const dir = makeRepo(V2);
  try {
    const r = runEntry('{oops', dir);
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).decision, 'block');
  } finally {
    cleanup(dir);
  }
});

test('entry point prints nothing on invalid or empty stdin with no manifest', () => {
  const bare = makeRepo(undefined);
  try {
    for (const stdin of ['', '{oops']) {
      const r = runEntry(stdin, bare);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
    }
  } finally {
    cleanup(bare);
  }
});
