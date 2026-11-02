// Runs every row of guards/cases.json through decide, then a sample through the real entry
// point as a child process (stdin JSON in, stdout JSON out, exit code 0).
// Run: node --test guards/*.test.mjs
// Fixtures use invented names only: example.internal, deploy-user@, port 55000, retired/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, run, hookOutput, RULES, ERROR_PREFIX, ERROR_ALTERNATIVE } from './pretooluse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'pretooluse.mjs');
const CASES = JSON.parse(fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8'));
const ROOT = '/work/repo';
const EM_DASH = String.fromCharCode(0x2014);

// "default": the version 2 template with the invented production markers and trees.
const DEFAULT = Object.freeze({
  checkrein: { manifest_version: 2 },
  protected_trees: ['retired/'],
  secret_globs: ['.env', '.env.*'],
  example_globs: ['.env.example'],
  production_markers: {
    hosts: ['example.internal'],
    logins: ['deploy-user@'],
    ports: [55000],
    database_url_patterns: ['postgres(ql)?://[^ ]*prod'],
  },
  approval: { ask: ['push', 'pr_create', 'pr_merge', 'dependency_change'], dependency_commands: [] },
  consulted: { mode: 'block', code_globs: ['src/**', '**/src/**'], required_reads: [] },
});

const V1 = Object.freeze({
  checkrein: { manifest_version: 1 },
  protected_trees: ['retired/'],
  secret_globs: ['.env', '.env.*'],
});

function manifestFor(c) {
  if (c.manifest === 'none') return null;
  if (c.manifest === 'v1') return structuredClone(V1);
  if (c.manifest !== 'default') throw new Error(`case ${c.id}: unknown manifest ${c.manifest}`);
  const m = structuredClone(DEFAULT);
  for (const [key, value] of Object.entries(c.overrides || {})) {
    m[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...m[key], ...value } : value;
  }
  return m;
}

function hookInput(tool, toolInput, cwd) {
  return {
    session_id: 'test-session',
    transcript_path: '/tmp/checkrein-test/transcript.jsonl',
    cwd,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: toolInput,
    tool_use_id: 'toolu_test',
  };
}

function tempDir(manifestText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkrein-guards-'));
  if (manifestText !== null) fs.writeFileSync(path.join(dir, 'checkrein.json'), manifestText);
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runEntry(stdin, projectDir) {
  const env = { ...process.env };
  if (projectDir === undefined) delete env.CLAUDE_PROJECT_DIR;
  else env.CLAUDE_PROJECT_DIR = projectDir;
  return spawnSync(process.execPath, [ENTRY], { input: stdin, env, encoding: 'utf8', timeout: 10000 });
}

// The case file itself

test('the case file has at least 100 well-formed cases with unique ids', () => {
  assert.ok(Array.isArray(CASES));
  assert.ok(CASES.length >= 100, `only ${CASES.length} cases`);
  const ids = new Set();
  for (const c of CASES) {
    assert.equal(typeof c.id, 'string', JSON.stringify(c));
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.equal(typeof c.tool, 'string', c.id);
    assert.ok(c.input && typeof c.input === 'object', c.id);
    assert.ok(['default', 'none', 'v1', 'corrupt'].includes(c.manifest), c.id);
    assert.ok(['allow', 'deny', 'ask'].includes(c.expect), c.id);
    assert.equal(typeof c.why, 'string', c.id);
  }
});

test('the case file covers every rule on both sides', () => {
  for (const rule of ['production', 'protected-trees', 'secrets']) {
    assert.ok(CASES.some((c) => c.rule === rule && c.expect === 'deny'), `${rule} has no deny case`);
  }
  assert.ok(CASES.some((c) => c.rule === 'approval' && c.expect === 'ask'), 'approval has no ask case');
  assert.ok(CASES.filter((c) => c.expect === 'allow' && c.manifest === 'default').length >= 30, 'too few allow cases');
  assert.ok(CASES.some((c) => c.manifest === 'none') && CASES.some((c) => c.manifest === 'v1'));
  assert.ok(CASES.some((c) => c.manifest === 'corrupt'));
});

test('no case text holds an em dash', () => {
  assert.ok(!fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8').includes(EM_DASH));
});

// Every case through decide

for (const c of CASES.filter((x) => x.manifest !== 'corrupt')) {
  test(`case ${c.id}: ${c.expect}`, () => {
    const cwd = c.cwd || c.root || ROOT;
    const d = decide(hookInput(c.tool, c.input, cwd), manifestFor(c), c.root || ROOT);
    assert.equal(d.decision, c.expect, `${c.id} (${c.why}): got ${d.decision} from ${d.rule}: ${d.reason}`);
    if (c.rule) assert.equal(d.rule, c.rule, `${c.id}: rule`);
    if (d.decision !== 'allow') {
      assert.ok(d.reason.startsWith('checkrein: '), `${c.id}: reason prefix`);
      assert.ok(!d.reason.includes(EM_DASH), `${c.id}: em dash in reason`);
      assert.ok(d.reason.length < 1000, `${c.id}: reason too long`);
    }
  });
}

for (const c of CASES.filter((x) => x.manifest === 'corrupt')) {
  test(`case ${c.id}: a corrupt manifest asks`, () => {
    const dir = tempDir('{ "checkrein": { "manifest_version": 2 }, ');
    try {
      const out = run(JSON.stringify(hookInput(c.tool, c.input, dir)), { CLAUDE_PROJECT_DIR: dir });
      assert.equal(out.hookSpecificOutput.permissionDecision, c.expect);
      assert.ok(out.hookSpecificOutput.permissionDecisionReason.startsWith(ERROR_PREFIX));
      assert.match(out.hookSpecificOutput.permissionDecisionReason, /not valid JSON/);
    } finally {
      cleanup(dir);
    }
  });
}

// Reason wording

test('a dependency-change reason names the manager and the subcommand, not an option', () => {
  const rows = [
    ['pnpm --filter web add left-pad', 'pnpm add'],
    ['pnpm -r add left-pad', 'pnpm add'],
    ['python3 -m pip install --upgrade pip', 'pip install'],
    ['poetry --directory app add requests', 'poetry add'],
  ];
  for (const [command, named] of rows) {
    const d = decide(hookInput('Bash', { command }, ROOT), structuredClone(DEFAULT), ROOT);
    assert.equal(d.decision, 'ask', command);
    assert.ok(d.reason.includes(`the dependency change ${named} waits`), `${command}: ${d.reason}`);
  }
});

test('a fail-closed reason names the alternatives', () => {
  const dir = tempDir('not json at all');
  try {
    const out = run(JSON.stringify(hookInput('Bash', { command: 'ls' }, dir)), { CLAUDE_PROJECT_DIR: dir });
    assert.ok(out.hookSpecificOutput.permissionDecisionReason.endsWith(ERROR_ALTERNATIVE), out.hookSpecificOutput.permissionDecisionReason);
  } finally {
    cleanup(dir);
  }
});

// Paths reached through a symbolic link: the root and the path may each be given in either form.
test('a protected path matches whether the root or the path is given in its real form', (t) => {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'checkrein-real-'));
  const real = fs.realpathSync.native(made);
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'checkrein-link-')), 'repo');
  try {
    fs.symlinkSync(real, link);
  } catch {
    cleanup(made);
    t.skip('symbolic links are not available here');
    return;
  }
  try {
    fs.mkdirSync(path.join(real, 'retired'));
    const pairs = [[link, path.join(real, 'retired', 'notes.md')], [real, path.join(link, 'retired', 'notes.md')]];
    for (const [root, file] of pairs) {
      const d = decide(hookInput('Read', { file_path: file }, root), structuredClone(DEFAULT), root);
      assert.equal(d.decision, 'deny', `root ${root}, file ${file}`);
    }
  } finally {
    cleanup(made);
    cleanup(path.dirname(link));
  }
});

// decide and run contracts

test('the rules run in precedence order', () => {
  assert.deepEqual(RULES.map((r) => r.RULE), ['production', 'protected-trees', 'secrets', 'approval']);
});

test('decide accepts a loadManifest result as well as a manifest', () => {
  const input = hookInput('Bash', { command: 'git push' }, ROOT);
  assert.equal(decide(input, { active: true, manifest: structuredClone(DEFAULT) }, ROOT).decision, 'ask');
  assert.equal(decide(input, { active: false, reason: 'none' }, ROOT).decision, 'allow');
});

test('decide resolves the root from the input cwd when none is given', () => {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  try {
    const d = decide(hookInput('Read', { file_path: '/work/repo/retired/notes.md' }, ROOT), structuredClone(DEFAULT));
    assert.equal(d.decision, 'deny');
  } finally {
    if (saved !== undefined) process.env.CLAUDE_PROJECT_DIR = saved;
  }
});

test('a Bash input with no command string fails closed through run', () => {
  const dir = tempDir(JSON.stringify(DEFAULT));
  try {
    const out = run(JSON.stringify(hookInput('Bash', {}, dir)), { CLAUDE_PROJECT_DIR: dir });
    assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
    assert.ok(out.hookSpecificOutput.permissionDecisionReason.startsWith(ERROR_PREFIX));
  } finally {
    cleanup(dir);
  }
});

test('run prints nothing for an allow, and the hook shape for a deny', () => {
  const dir = tempDir(JSON.stringify(DEFAULT));
  try {
    assert.equal(run(JSON.stringify(hookInput('Bash', { command: 'npm test' }, dir)), { CLAUDE_PROJECT_DIR: dir }), null);
    const out = run(JSON.stringify(hookInput('Bash', { command: 'ssh tunnel-host' }, dir)), { CLAUDE_PROJECT_DIR: dir });
    assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    cleanup(dir);
  }
});

// The real entry point through a child process

const ENTRY_CASES = ['prod-ssh-plain', 'tree-bash-cat', 'secret-bash-cat', 'approve-push', 'approve-api-glued-field', 'tree-bash-allow-ls', 'approve-allow-npm-ci', 'secret-bash-allow-example'];

for (const id of ENTRY_CASES) {
  test(`entry point: ${id}`, () => {
    const c = CASES.find((x) => x.id === id);
    assert.ok(c, `missing case ${id}`);
    const dir = tempDir(JSON.stringify(DEFAULT));
    try {
      const res = runEntry(JSON.stringify(hookInput(c.tool, c.input, dir)), dir);
      assert.equal(res.status, 0, res.stderr);
      if (c.expect === 'allow') {
        assert.equal(res.stdout, '');
        return;
      }
      const out = JSON.parse(res.stdout);
      const expected = decide(hookInput(c.tool, c.input, dir), structuredClone(DEFAULT), dir);
      assert.deepEqual(out, hookOutput(c.expect, expected.reason));
    } finally {
      cleanup(dir);
    }
  });
}

test('entry point: no manifest prints nothing', () => {
  const dir = tempDir(null);
  try {
    const res = runEntry(JSON.stringify(hookInput('Bash', { command: 'ssh tunnel-host' }, dir)), dir);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally {
    cleanup(dir);
  }
});

test('entry point: a version 1 manifest prints nothing', () => {
  const dir = tempDir(JSON.stringify(V1));
  try {
    const res = runEntry(JSON.stringify(hookInput('Bash', { command: 'cat retired/notes.md' }, dir)), dir);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally {
    cleanup(dir);
  }
});

test('entry point: a corrupt manifest asks with the error text', () => {
  const dir = tempDir('not json at all');
  try {
    const res = runEntry(JSON.stringify(hookInput('Bash', { command: 'ls' }, dir)), dir);
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
    assert.ok(out.hookSpecificOutput.permissionDecisionReason.startsWith(ERROR_PREFIX));
  } finally {
    cleanup(dir);
  }
});

test('entry point: unparseable stdin asks when enforcement is on', () => {
  const dir = tempDir(JSON.stringify(DEFAULT));
  try {
    const res = runEntry('{ broken', dir);
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /not valid JSON/);
  } finally {
    cleanup(dir);
  }
});

test('entry point: unparseable stdin stays silent when enforcement is off', () => {
  const dir = tempDir(null);
  try {
    const res = runEntry('{ broken', dir);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally {
    cleanup(dir);
  }
});

test('entry point: the root falls back to the input cwd', () => {
  const dir = tempDir(JSON.stringify(DEFAULT));
  try {
    const res = runEntry(JSON.stringify(hookInput('Bash', { command: 'git push' }, dir)), undefined);
    assert.equal(res.status, 0);
    assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, 'ask');
  } finally {
    cleanup(dir);
  }
});
