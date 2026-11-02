// Tests for checkrein-check.mjs. Each test runs the script as a child process, the way an adopter does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'checkrein-check.mjs');
const PASS = join(HERE, 'fixtures', 'adopter-pass');
const FAIL = join(HERE, 'fixtures', 'adopter-fail');
const TEMPLATES = join(HERE, '..', 'templates');

function run(args, cwd = HERE) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, lines: result.stdout.split('\n').filter(Boolean) };
}

function tempCopy(source) {
  const dir = mkdtempSync(join(tmpdir(), 'checkrein-check-'));
  cpSync(source, dir, { recursive: true });
  return dir;
}

test('the passing fixture passes with an OK summary', () => {
  const { code, lines } = run([SCRIPT, '--root', PASS]);
  assert.equal(code, 0, lines.join('\n'));
  assert.deepEqual(lines, ['checkrein-check: OK (7 checks)']);
});

test('--quiet prints nothing on success', () => {
  const { code, out } = run([SCRIPT, '--root', PASS, '--quiet']);
  assert.equal(code, 0);
  assert.equal(out, '');
});

test('the script defaults its root to its own directory', () => {
  const dir = tempCopy(PASS);
  copyFileSync(SCRIPT, join(dir, 'checkrein-check.mjs'));
  const { code, lines } = run(['checkrein-check.mjs'], dir);
  assert.equal(code, 0, lines.join('\n'));
  assert.match(lines.at(-1), /^checkrein-check: OK \(\d+ checks\)$/);
});

test('a repository with no manifest fails the manifest check and stops', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkrein-check-empty-'));
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 1);
  assert.ok(lines.some((l) => l.startsWith('manifest: checkrein.json not found')), lines.join('\n'));
  assert.ok(!lines.some((l) => l.startsWith('corrections:')));
});

test('a manifest that does not parse fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkrein-check-bad-json-'));
  writeFileSync(join(dir, 'checkrein.json'), '{ "checkrein": ');
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 1);
  assert.ok(lines.some((l) => l.startsWith('manifest: checkrein.json does not parse')), lines.join('\n'));
});

test('an unknown argument fails with usage', () => {
  const { code, lines } = run([SCRIPT, '--nope']);
  assert.equal(code, 1);
  assert.ok(lines.some((l) => l.includes('unknown argument "--nope"')));
});

test('the failing fixture reports one finding per check', () => {
  const dir = tempCopy(FAIL);
  // The em dash is written at run time so the repository itself never holds one.
  writeFileSync(join(dir, 'project-documentation', 'style-notes.md'), `# Style\n\nPages are short ${String.fromCharCode(0x2014)} one screen each.\n`);
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 1, lines.join('\n'));

  const expected = [
    'manifest: unknown top-level key "extras"',
    'manifest: "paths.runbooks_dir" points to "project-documentation/runbooks/", which does not exist',
    'manifest: "review.confidence_floor" must be an integer from 0 to 100 (found 150)',
    'corrections: project-documentation/corrections-log.md:3: tag "mobile" is not in the manifest\'s domains',
    'corrections: project-documentation/corrections-log.md:13: entry is missing **Correct approach:** (the four fields must appear in order)',
    'corrections: project-documentation/corrections-log.md:19: heading does not follow',
    'working-docs: project-documentation/temp/links-plan.md: working docs are named',
    'state-doc: project-documentation/current-project-state.md: missing the heading "## Part 3: Open gaps"',
    'changelog: project-documentation/CHANGELOG.md:9: "### Removed" is not one of ### Added, ### Changed, ### Fixed',
    'changelog: WARN project-documentation/CHANGELOG.md:13: section "## Add page history" is not headed "## PR #<number>: <title>"',
    'changelog: WARN project-documentation/CHANGELOG.md:13: section "## Add page history" has no Added, Changed or Fixed subsection',
    'em-dash: project-documentation/style-notes.md:3:',
    'cross-refs: AGENTS.md:6: `docs/missing-guide.md` does not exist',
  ];
  for (const prefix of expected) {
    assert.ok(lines.some((l) => l.startsWith(prefix)), `missing finding: ${prefix}\n---\n${lines.join('\n')}`);
  }
  assert.match(lines.at(-1), /^checkrein-check: FAILED \(11 findings in 7 checks\)$/);
});

test('findings print in check order', () => {
  const dir = tempCopy(FAIL);
  const { lines } = run([SCRIPT, '--root', dir]);
  const order = ['manifest', 'corrections', 'working-docs', 'state-doc', 'changelog', 'cross-refs'];
  const seen = lines.map((l) => l.split(':')[0]).filter((name) => order.includes(name));
  const ranks = seen.map((name) => order.indexOf(name));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test('Part headings out of order are reported', () => {
  const dir = tempCopy(PASS);
  const state = [
    '# Current project state',
    '',
    'Current as of: abc1234',
    '',
    '## Part 2: Delta log',
    '## Part 1: Structural inventory',
    '## Part 3: Open gaps',
    '## Part 4: Accepted debt and settled decisions',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'project-documentation', 'current-project-state.md'), state);
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 1);
  assert.ok(lines.some((l) => l.startsWith('state-doc:') && l.includes('out of order')), lines.join('\n'));
});

test('a state document without its currency marker fails', () => {
  const dir = tempCopy(PASS);
  const state = [
    '# Current project state',
    '',
    '## Part 1: Structural inventory',
    '## Part 2: Delta log',
    '## Part 3: Open gaps',
    '## Part 4: Accepted debt and settled decisions',
    '',
    'Current as of: too late, after the first Part heading',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'project-documentation', 'current-project-state.md'), state);
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 1);
  assert.ok(lines.some((l) => l.startsWith('state-doc:') && l.includes('Current as of')), lines.join('\n'));
});

test('a manifest without "process" in domains fails', () => {
  const dir = tempCopy(PASS);
  const manifestPath = join(dir, 'checkrein.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.domains = ['backend'];
  manifest.workspaces = [{ name: 'app', root: 'missing-folder' }];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 1);
  assert.ok(lines.includes('manifest: "domains" must include "process"'), lines.join('\n'));
  assert.ok(lines.includes('manifest: workspaces[0].root "missing-folder" is not a directory'), lines.join('\n'));
});

test('a currency marker placed after the first Part heading fails', () => {
  const dir = tempCopy(PASS);
  const state = [
    '# Current project state',
    '',
    '## Part 1: Structural inventory',
    '',
    'Current as of: a1b2c3d (PR #12). Part 1 verified at: never.',
    '',
    '## Part 2: Delta log',
    '## Part 3: Open gaps',
    '## Part 4: Accepted debt and settled decisions',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'project-documentation', 'current-project-state.md'), state);
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 1, lines.join('\n'));
  assert.ok(
    lines.includes('state-doc: project-documentation/current-project-state.md:1: the first line after the title must be "Current as of: <merge commit sha or description>"'),
    lines.join('\n'),
  );
});

test('working docs: only direct children of the folder are checked', () => {
  const dir = tempCopy(PASS);
  const temp = join(dir, 'project-documentation', 'temp');
  mkdirSync(join(temp, 'skill-staging'));
  writeFileSync(join(temp, 'skill-staging', 'notes.md'), '# Staged copy\n');
  const nested = run([SCRIPT, '--root', dir]);
  assert.equal(nested.code, 0, nested.lines.join('\n'));
  assert.ok(!nested.lines.some((l) => l.startsWith('working-docs:')), nested.lines.join('\n'));

  writeFileSync(join(temp, 'notes.md'), '# A working doc with the wrong name\n');
  const direct = run([SCRIPT, '--root', dir]);
  assert.equal(direct.code, 1, direct.lines.join('\n'));
  const hits = direct.lines.filter((l) => l.startsWith('working-docs:'));
  assert.deepEqual(hits, [
    'working-docs: project-documentation/temp/notes.md: working docs are named "plan - <descriptor>.md" or "audit - <descriptor>.md"',
  ]);
});

test('a misleveled rule heading is not treated as a rule heading', () => {
  const dir = tempCopy(PASS);
  const log = [
    '# Corrections log',
    '',
    '#### Pattern [process]: A heading one level too deep is missed by the heading index.',
    '',
    '- **What went wrong:** The heading sat at level 4.',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'project-documentation', 'corrections-log.md'), log);
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 1, lines.join('\n'));
  const hits = lines.filter((l) => l.startsWith('corrections:'));
  assert.equal(hits.length, 1, hits.join('\n'));
  assert.match(hits[0], /^corrections: project-documentation\/corrections-log\.md:3: rule headings are level 3/);
  assert.ok(!hits[0].includes('is missing'), hits[0]);
});

test('an unknown top-level manifest key fails', () => {
  const dir = tempCopy(PASS);
  const manifestPath = join(dir, 'checkrein.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.deploy = { host: 'example.com' };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 1, lines.join('\n'));
  assert.ok(lines.includes('manifest: unknown top-level key "deploy"'), lines.join('\n'));
  assert.equal(lines.at(-1), 'checkrein-check: FAILED (1 finding in 7 checks)');
});

test('a protected_trees entry missing on disk is a warning, not a failure', () => {
  const dir = tempCopy(PASS);
  const manifestPath = join(dir, 'checkrein.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.protected_trees = ['retired/'];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 0, lines.join('\n'));
  assert.deepEqual(lines, [
    'manifest: WARN protected_trees entry "retired/" does not exist',
    'checkrein-check: OK (7 checks, 1 warning)',
  ]);
});

test('a changelog section not headed "## PR #<number>: <title>" is a warning, not a failure', () => {
  const dir = tempCopy(PASS);
  const changelog = ['# Changelog', '', '## Release 2', '', '### Added', '', '- Tags on notes.', ''].join('\n');
  writeFileSync(join(dir, 'project-documentation', 'CHANGELOG.md'), changelog);
  const { code, lines } = run([SCRIPT, '--root', dir]);
  assert.equal(code, 0, lines.join('\n'));
  assert.deepEqual(lines, [
    'changelog: WARN project-documentation/CHANGELOG.md:3: section "## Release 2" is not headed "## PR #<number>: <title>"',
    'checkrein-check: OK (7 checks, 1 warning)',
  ]);
});

test('the templates tree passes the adopter check with its own manifest', () => {
  const { code, lines } = run([SCRIPT, '--root', TEMPLATES]);
  assert.equal(code, 0, lines.join('\n'));
  assert.match(lines.at(-1), /^checkrein-check: OK \(7 checks/);
});
