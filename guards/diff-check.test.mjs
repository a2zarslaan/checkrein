// Tests for diff-check.mjs. Invented names only: example.internal, deploy-user@, retired/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkDiff,
  parseNameStatus,
  parsePatch,
  normalizeManifest,
  globToRegExp as inlineGlobToRegExp,
  matchesGlob as inlineMatchesGlob,
  isUnderTree as inlineIsUnderTree,
} from './diff-check.mjs';
import { globToRegExp, matchesGlob, isUnderTree } from './manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'diff-check.mjs');

const manifest = normalizeManifest({
  checkrein: { manifest_version: 2 },
  protected_trees: ['retired/'],
  secret_globs: ['.env', '.env.*', '*.pem'],
  example_globs: ['.env.example', '*.example', '*.sample'],
  production_markers: {
    hosts: ['example.internal'],
    logins: ['deploy-user@'],
    ports: [55000],
    database_url_patterns: ['postgres://[^\\s]*prod'],
  },
});

const row = (status, p, addedLines = [], extra = {}) => ({ status, path: p, addedLines, ...extra });

test('a secret file added fails', () => {
  const r = checkDiff([row('A', '.env', ['TOKEN=x'])], manifest);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].rule, 'secret');
  assert.match(r.failures[0].message, /^FAIL \.env: secret file added/);
});

test('a secret file modified fails, nested and case-insensitive', () => {
  const r = checkDiff([row('M', 'config/.ENV.local'), row('A', 'keys/server.pem')], manifest);
  assert.deepEqual(r.failures.map((f) => f.path), ['config/.ENV.local', 'keys/server.pem']);
  assert.match(r.failures[0].message, /modified/);
});

test('a secret file deleted passes', () => {
  assert.equal(checkDiff([row('D', '.env')], manifest).failures.length, 0);
});

test('an example file is allowed', () => {
  const r = checkDiff([row('A', '.env.example', ['TOKEN=']), row('M', 'config/.env.sample')], manifest);
  assert.equal(r.failures.length, 0);
});

test('a renamed or copied record into a secret name fails', () => {
  const r = checkDiff([row('R100', '.env.prod', [], { oldPath: 'notes.txt' })], manifest);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].rule, 'secret');
});

test('an ordinary file passes with no findings', () => {
  assert.deepEqual(checkDiff([row('A', 'src/app.js', ['const a = 1;'])], manifest), { failures: [], warnings: [] });
});

test('a file inside a protected tree modified fails', () => {
  const r = checkDiff([row('M', 'retired/old.md', ['edit'])], manifest);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].rule, 'protected');
  assert.match(r.failures[0].message, /modified/);
});

test('a file added into a protected tree passes (retirement)', () => {
  assert.equal(checkDiff([row('A', 'retired/plan - notes.md', ['# Plan'])], manifest).failures.length, 0);
});

test('a deletion inside a protected tree fails', () => {
  const r = checkDiff([row('D', 'retired/sub/file.txt')], manifest);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0].message, /deleted/);
});

test('protected-tree matching ignores case and does not match a sibling prefix', () => {
  assert.equal(checkDiff([row('M', 'Retired/x.md')], manifest).failures.length, 1);
  assert.equal(checkDiff([row('M', 'retired-notes/x.md')], manifest).failures.length, 0);
});

test('a rename out of a protected tree fails, a rename into one passes', () => {
  assert.equal(checkDiff([row('R', 'docs/x.md', [], { oldPath: 'retired/x.md' })], manifest).failures.length, 1);
  assert.equal(checkDiff([row('R', 'retired/x.md', [], { oldPath: 'docs/x.md' })], manifest).failures.length, 0);
});

test('a production host in an added line warns, never fails', () => {
  const r = checkDiff([row('A', 'docs/runbook.md', [{ line: 7, text: 'Connect to example.internal.' }])], manifest);
  assert.equal(r.failures.length, 0);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].message, /^WARN docs\/runbook\.md:7: added line names production host example\.internal/);
});

test('host matching is whole-token and case-insensitive', () => {
  const hit = (text) => checkDiff([row('M', 'a.txt', [text])], manifest).warnings.length;
  assert.equal(hit('url https://EXAMPLE.INTERNAL/path'), 1);
  assert.equal(hit('myexample.internal is another host'), 0);
  assert.equal(hit('my-example.internal is another host'), 0);
  assert.equal(hit('example.internal2 is another host'), 0);
  assert.equal(hit('see example.internal.docs for more'), 0);
});

test('a subdomain of a production host warns, as in the production guard', () => {
  const hit = (text) => checkDiff([row('M', 'a.txt', [text])], manifest).warnings.length;
  assert.equal(hit('db.example.internal is a replica'), 1);
  assert.equal(hit('https://API.Db.Example.Internal:8443/'), 1);
});

test('database URL patterns match ignoring case, as in the production guard', () => {
  const r = checkDiff([row('A', 'notes.txt', ['POSTGRES://u@db/APP_PROD'])], manifest);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].message, /database URL pattern/);
});

test('a database URL pattern written in upper case matches a lower-case URL', () => {
  const upper = normalizeManifest({ checkrein: { manifest_version: 2 }, production_markers: { database_url_patterns: ['POSTGRES(QL)?://[^ ]*PROD'] } });
  const hit = (text) => checkDiff([row('A', 'notes.txt', [text])], upper).warnings.length;
  assert.equal(hit('postgresql://u:p@localhost/app_prod'), 1);
  assert.equal(hit('postgresql://u:p@localhost/app_dev'), 0);
});

test('the manifest at the root is not scanned for production markers', () => {
  const text = '"hosts": ["example.internal"], "logins": ["deploy-user@"]';
  assert.equal(checkDiff([row('A', 'checkrein.json', [text]), row('M', './checkrein.json', [text])], manifest).warnings.length, 0);
  assert.equal(checkDiff([row('A', 'sub/checkrein.json', [text])], manifest).warnings.length, 2);
});

test('a production login and a database URL pattern warn', () => {
  const r = checkDiff([row('A', 'notes.txt', ['ssh deploy-user@host', 'postgres://u:p@db/app_prod'])], manifest);
  assert.deepEqual(r.warnings.map((w) => w.message.match(/production (\w+(?: \w+ \w+)?)/)[1]), ['login', 'database URL pattern']);
  assert.match(r.warnings[0].message, /added line 1/);
});

test('ports alone do not warn in added lines', () => {
  assert.equal(checkDiff([row('A', 'a.txt', ['listen :55000'])], manifest).warnings.length, 0);
});

test('binary rows and lines holding a NUL byte are ignored', () => {
  const nul = String.fromCharCode(0);
  const r = checkDiff(
    [row('A', 'image.png', ['example.internal'], { binary: true }), row('A', 'blob.dat', [`x${nul}example.internal`])],
    manifest,
  );
  assert.equal(r.warnings.length, 0);
});

test('no production markers means no warnings', () => {
  const bare = normalizeManifest({ checkrein: { manifest_version: 2 } });
  assert.equal(checkDiff([row('A', 'a.txt', ['example.internal'])], bare).warnings.length, 0);
  assert.equal(checkDiff([row('A', '.env')], bare).failures.length, 1);
});

test('normalizeManifest rejects wrong types and bad patterns', () => {
  assert.throws(() => normalizeManifest({ secret_globs: '.env' }), /secret_globs must be an array of strings/);
  assert.throws(() => normalizeManifest({ production_markers: { database_url_patterns: ['('] } }), /valid regular expressions/);
});

test('parseNameStatus reads -z output including names with spaces and rename records', () => {
  const nul = String.fromCharCode(0);
  const out = ['A', 'my file.txt', 'D', 'retired/x.md', 'R100', 'a.txt', 'b.txt', ''].join(nul);
  assert.deepEqual(parseNameStatus(out), [
    { status: 'A', path: 'my file.txt', addedLines: [] },
    { status: 'D', path: 'retired/x.md', addedLines: [] },
    { status: 'R', oldPath: 'a.txt', path: 'b.txt', addedLines: [] },
  ]);
});

test('parsePatch tracks new line numbers, keeps hunk content apart from headers, and marks binaries', () => {
  const out = [
    'diff --git a/a.txt b/a.txt',
    'index 1..2 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -3,0 +4,2 @@ ctx',
    '+first',
    '+++ looks like a header',
    '@@ -10 +12 @@',
    '-old',
    '+new',
    'diff --git a/my file.txt b/my file.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/my file.txt\t',
    '@@ -0,0 +1 @@',
    '+hello',
    'diff --git a/img.png b/img.png',
    'Binary files /dev/null and b/img.png differ',
    'diff --git a/gone.txt b/gone.txt',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    '',
  ].join('\n');
  const files = parsePatch(out);
  assert.deepEqual(files.get('a.txt').addedLines, [
    { line: 4, text: 'first' },
    { line: 5, text: '++ looks like a header' },
    { line: 12, text: 'new' },
  ]);
  assert.deepEqual(files.get('my file.txt').addedLines, [{ line: 1, text: 'hello' }]);
  assert.equal(files.get('img.png').binary, true);
  assert.equal(files.has('gone.txt'), false);
});

test('the inlined path helpers agree with guards/manifest.mjs', () => {
  const globs = ['*', '**', '*.pem', '.env.*', 'src/**', '**/src/**', 'a/{b,c}/*.js', 'x?.txt', 'retired/'];
  const paths = ['.env', 'config/.env.local', 'src/a/b.js', 'pkg/src/x.ts', 'a/b/z.js', 'a/d/z.js', 'xy.txt', 'retired/x.md', 'README.md'];
  for (const g of globs) assert.equal(String(inlineGlobToRegExp(g)), String(globToRegExp(g)), g);
  for (const p of paths) {
    for (const g of globs) assert.equal(inlineMatchesGlob(p, [g]), matchesGlob(p, [g]), `${p} ${g}`);
    assert.equal(inlineIsUnderTree(p, ['retired/', 'Src']), isUnderTree(p, ['retired/', 'Src']), p);
  }
});

test('the file imports nothing outside the Node standard library', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const specifiers = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.ok(specifiers.length > 0);
  for (const s of specifiers) assert.match(s, /^node:/);
});

// ---------------------------------------------------------------------------------------------
// Integration: a real repository, the real CLI.

function makeRepo(manifestData) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkrein-diff-'));
  const g = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  g('init', '-q');
  if (manifestData !== undefined) fs.writeFileSync(path.join(dir, 'checkrein.json'), typeof manifestData === 'string' ? manifestData : JSON.stringify(manifestData, null, 2));
  return { dir, g };
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

const repoManifest = {
  checkrein: { manifest_version: 2 },
  protected_trees: ['retired/'],
  secret_globs: ['*.pem'],
  production_markers: { hosts: ['example.internal'] },
};

test('integration: a staged secret file makes the CLI exit 1', () => {
  const { dir, g } = makeRepo(repoManifest);
  fs.writeFileSync(path.join(dir, 'server.pem'), 'not a real key\n');
  g('add', 'server.pem');
  const r = runCli(['--staged'], dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^diff-check: FAIL server\.pem: secret file added/m);
  assert.equal(r.stderr, '');
});

test('integration: a clean staged change exits 0, with a warning for a production host', () => {
  const { dir, g } = makeRepo(repoManifest);
  fs.writeFileSync(path.join(dir, 'runbook.md'), '# Runbook\n\nThe host is example.internal.\n');
  g('add', 'runbook.md', 'checkrein.json');
  const r = runCli(['--staged', '--root', dir], os.tmpdir());
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^diff-check: WARN runbook\.md:3: /m);
  assert.match(r.stdout, /^diff-check: OK$/m);
  assert.doesNotMatch(r.stdout, /WARN checkrein\.json/);
});

test('integration: warnings survive diff.mnemonicPrefix and diff.noprefix', () => {
  for (const key of ['diff.mnemonicPrefix', 'diff.noprefix']) {
    const { dir, g } = makeRepo(repoManifest);
    g('config', key, 'true');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'r.md'), '# R\n\nThe host is example.internal.\n');
    g('add', '-A');
    const r = runCli(['--staged'], dir);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^diff-check: WARN src\/r\.md:3: /m, key);
  }
});

test('integration: --range catches a protected-tree edit and passes a retirement', () => {
  const { dir, g } = makeRepo(repoManifest);
  fs.mkdirSync(path.join(dir, 'retired'));
  fs.writeFileSync(path.join(dir, 'retired', 'old.md'), 'old\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(dir, 'retired', 'new.md'), 'retired plan\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'retire');
  assert.equal(runCli(['--range', 'HEAD~1..HEAD'], dir).status, 0);
  fs.writeFileSync(path.join(dir, 'retired', 'old.md'), 'changed\n');
  g('commit', '-q', '-am', 'edit');
  const r = runCli(['--range', 'HEAD~1..HEAD'], dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL retired\/old\.md: file inside a protected tree modified/);
});

test('integration: no manifest or a version 1 manifest turns the check off', () => {
  const none = makeRepo(undefined);
  fs.writeFileSync(path.join(none.dir, 'server.pem'), 'x\n');
  none.g('add', 'server.pem');
  const r1 = runCli(['--staged'], none.dir);
  assert.equal(r1.status, 0);
  assert.match(r1.stdout, /^diff-check: OK \(enforcement off: no checkrein\.json/);

  const v1 = makeRepo({ checkrein: { manifest_version: 1 }, secret_globs: ['*.pem'] });
  fs.writeFileSync(path.join(v1.dir, 'server.pem'), 'x\n');
  v1.g('add', 'server.pem');
  const r2 = runCli(['--staged'], v1.dir);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /enforcement off: manifest version 1/);
});

test('integration: a corrupt manifest, a bad range or a bad argument fails closed', () => {
  const bad = makeRepo('{ not json');
  const r1 = runCli(['--staged'], bad.dir);
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /^diff-check: FAIL the manifest cannot be used/);

  const ok = makeRepo(repoManifest);
  const r2 = runCli(['--range', 'nope..HEAD'], ok.dir);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /^diff-check: FAIL git diff did not run/);

  const r3 = runCli([], ok.dir);
  assert.equal(r3.status, 1);
  assert.match(r3.stdout, /^diff-check: FAIL give --staged or --range/);
});
