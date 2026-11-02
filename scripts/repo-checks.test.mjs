// Tests for the helpers in repo-checks.mjs. Each test works in a small temp directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFrontmatter,
  scanEmDash,
  parseTermList,
  scanTerms,
  parseReadmeTables,
  findSkillsTable,
  walkFiles,
  scanSkillCrossRefs,
  runChecks,
  checkHooks,
  checkGuards,
  guardTestFor,
  checkVersions,
} from './repo-checks.mjs';

const EM_DASH = String.fromCharCode(0x2014);

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'checkrein-repo-checks-'));
}

// ---------- frontmatter ----------

test('frontmatter: plain keys parse', () => {
  const { data, errors, found } = parseFrontmatter('---\nname: notes-search\ndescription: Search notes by title.\n---\n\n# Body\n');
  assert.equal(found, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(data, { name: 'notes-search', description: 'Search notes by title.' });
});

test('frontmatter: quoted values may hold ": " and " #"', () => {
  const text = '---\nname: wiki\ndescription: "Use it when: the page is stale. See issue #4."\nlicense: \'MIT\'\n---\n';
  const { data, errors } = parseFrontmatter(text);
  assert.deepEqual(errors, []);
  assert.equal(data.description, 'Use it when: the page is stale. See issue #4.');
  assert.equal(data.license, 'MIT');
});

test('frontmatter: an unquoted ": " or " #" is reported', () => {
  const colon = parseFrontmatter('---\nname: wiki\ndescription: Use it when: the page is stale.\n---\n');
  assert.ok(colon.errors.some((e) => e.includes('": "')), colon.errors.join('\n'));
  const hash = parseFrontmatter('---\nname: wiki\ndescription: See issue #4 for context.\n---\n');
  assert.ok(hash.errors.some((e) => e.includes('" #"')), hash.errors.join('\n'));
});

test('frontmatter: folded and literal block scalars', () => {
  const folded = parseFrontmatter('---\nname: wiki\ndescription: >\n  First line\n  second line.\n---\n');
  assert.deepEqual(folded.errors, []);
  assert.equal(folded.data.description, 'First line second line.');
  const literal = parseFrontmatter('---\nname: wiki\ndescription: |\n  First line\n  second line.\n---\n');
  assert.equal(literal.data.description, 'First line\nsecond line.');
});

test('frontmatter: a nested mapping and a list', () => {
  const text = '---\nname: wiki\ndescription: A wiki skill.\nmetadata:\n  author: someone\n  version: "1.0"\nallowed-tools:\n  - Read\n  - Edit\n---\n';
  const { data, errors } = parseFrontmatter(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(data.metadata, { author: 'someone', version: '1.0' });
  assert.deepEqual(data['allowed-tools'], ['Read', 'Edit']);
});

test('frontmatter: a multi-line plain scalar joins with spaces', () => {
  const { data, errors } = parseFrontmatter('---\nname: wiki\ndescription: First part\n  and second part.\n---\n');
  assert.deepEqual(errors, []);
  assert.equal(data.description, 'First part and second part.');
});

test('frontmatter: missing or unclosed frontmatter, and duplicate keys', () => {
  assert.equal(parseFrontmatter('# No frontmatter\n').found, false);
  assert.equal(parseFrontmatter('---\nname: wiki\n').found, false);
  const dup = parseFrontmatter('---\nname: a\nname: b\n---\n');
  assert.ok(dup.errors.some((e) => e.includes('duplicate key "name"')));
});

// ---------- em-dash ----------

test('em-dash: every occurrence is reported with line and column', () => {
  const dir = tempDir();
  const file = join(dir, 'notes.md');
  writeFileSync(file, `clean line\nshort ${EM_DASH} then ${EM_DASH} again\n`);
  assert.deepEqual(scanEmDash(file), [
    { line: 2, col: 7 },
    { line: 2, col: 14 },
  ]);
});

test('em-dash: a clean file, a binary file and a missing file report nothing', () => {
  const dir = tempDir();
  const clean = join(dir, 'clean.md');
  writeFileSync(clean, `A hyphen-word and an en dash ${String.fromCharCode(0x2013)} are fine.\n`);
  assert.deepEqual(scanEmDash(clean), []);
  const binary = join(dir, 'image.bin');
  writeFileSync(binary, Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(EM_DASH)]));
  assert.deepEqual(scanEmDash(binary), []);
  assert.deepEqual(scanEmDash(join(dir, 'absent.md')), []);
});

test('walkFiles skips the named directories', () => {
  const dir = tempDir();
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), '');
  writeFileSync(join(dir, 'src', 'main.js'), '');
  const files = walkFiles(dir).map((f) => f.slice(dir.length + 1));
  assert.deepEqual(files, [join('src', 'main.js')]);
});

// ---------- term list ----------

test('term list: comments and blank lines are skipped; case is ignored by default', () => {
  const { terms, errors } = parseTermList('# a comment\n\n\\bwidget\\b\n  # indented comment\n');
  assert.deepEqual(errors, []);
  assert.equal(terms.length, 1);
  assert.equal(terms[0].caseSensitive, false);
  assert.ok(terms[0].regex.test('The WIDGET shop'));
  assert.ok(!terms[0].regex.test('widgets'));
});

test('term list: a (?-i) line is case-sensitive and the prefix is removed', () => {
  const { terms } = parseTermList('(?-i)\\bACME\\b\n');
  assert.equal(terms.length, 1);
  assert.equal(terms[0].caseSensitive, true);
  assert.equal(terms[0].source, '\\bACME\\b');
  assert.ok(terms[0].regex.test('made by ACME'));
  assert.ok(!terms[0].regex.test('the acme of style'));
});

test('term list: an invalid pattern is reported with its line', () => {
  const { terms, errors } = parseTermList('good\n(unclosed\n');
  assert.equal(terms.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
});

test('term list: scanTerms reports line and term', () => {
  const dir = tempDir();
  const file = join(dir, 'readme.md');
  writeFileSync(file, 'line one\nbuilt for Example Corp\n');
  const { terms } = parseTermList('example corp\n(?-i)example corp\n');
  assert.deepEqual(scanTerms(file, terms), [{ line: 2, term: 'example corp' }]);
});

// ---------- readme table ----------

const README = [
  '# Kit',
  '',
  '| Command | Purpose |',
  '|---|---|',
  '| `node --test` | run tests |',
  '',
  '| Skill | When it runs |',
  '| :--- | --- |',
  '| `notes` | before notes work |',
  '| `wiki`, `search` | before wiki work |',
  '| plain text | no backticks |',
  '',
].join('\n');

test('readme: every table is found with the backticked names of its first column', () => {
  const tables = parseReadmeTables(README);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0], { line: 3, names: ['node --test'] });
  assert.deepEqual(tables[1], { line: 7, names: ['notes', 'wiki', 'search'] });
});

test('readme: the skills table is the one naming the most skill folders', () => {
  const table = findSkillsTable(README, ['notes', 'wiki', 'search', 'tags']);
  assert.equal(table.line, 7);
  assert.ok(!table.names.includes('tags'));
  assert.equal(findSkillsTable(README, ['absent']), null);
});

// ---------- skill cross-refs ----------

test('skill-refs: a dead backticked path in a SKILL.md is reported; a live one is not', () => {
  const root = tempDir();
  mkdirSync(join(root, 'skills', 'notes-search', 'references'), { recursive: true });
  mkdirSync(join(root, 'templates'));
  writeFileSync(join(root, 'templates', 'AGENTS.md'), '# Hub\n');
  writeFileSync(join(root, 'skills', 'notes-search', 'references', 'guide.md'), '# Guide\n');
  const skill = [
    '---',
    'name: notes-search',
    'description: Search notes by title.',
    '---',
    '',
    '# Notes search',
    '',
    'Read `AGENTS.md` and `references/guide.md` first.',
    'Then open `docs/missing-guide.md`.',
    '',
  ].join('\n');
  writeFileSync(join(root, 'skills', 'notes-search', 'SKILL.md'), skill);

  const dead = scanSkillCrossRefs(root).map((hit) => ({ ...hit, file: hit.file.slice(root.length + 1) }));
  assert.deepEqual(dead, [{ file: join('skills', 'notes-search', 'SKILL.md'), line: 9, path: 'docs/missing-guide.md' }]);

  const { findings } = runChecks(root);
  const refs = findings.filter((f) => f.startsWith('skill-refs:'));
  assert.deepEqual(refs, ['skill-refs: skills/notes-search/SKILL.md:9: `docs/missing-guide.md` does not exist']);
});

// ---------- hooks, guards, versions ----------

const HOOK_ARG = '${CLAUDE_PLUGIN_ROOT}/guards/run.mjs';

function writeJson(root, rel, value) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), typeof value === 'string' ? value : JSON.stringify(value));
}

function hooksConfig(arg = HOOK_ARG, timeout = 10) {
  return { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: [arg], timeout }] }] } };
}

test('hooks: a valid file whose args resolve passes', () => {
  const root = tempDir();
  writeJson(root, 'guards/run.mjs', '');
  writeJson(root, 'hooks/hooks.json', hooksConfig());
  assert.deepEqual(checkHooks(root), []);
});

test('hooks: missing file, bad JSON and a missing wrapper are reported', () => {
  const root = tempDir();
  assert.deepEqual(checkHooks(root), ['hooks/hooks.json is missing']);
  writeJson(root, 'hooks/hooks.json', '{ nope');
  assert.ok(checkHooks(root)[0].includes('does not parse'));
  writeJson(root, 'hooks/hooks.json', { Stop: [] });
  assert.deepEqual(checkHooks(root), ['hooks/hooks.json has no "hooks" wrapper object']);
});

test('hooks: a dead args path and a non-numeric timeout are reported', () => {
  const root = tempDir();
  writeJson(root, 'hooks/hooks.json', hooksConfig(HOOK_ARG, '10'));
  const problems = checkHooks(root);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes('timeout must be a number')));
  assert.ok(problems.some((p) => p.includes('`guards/run.mjs`, which does not exist')));
});

function caseList(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `case-${i}`,
    tool: 'Bash',
    input: { command: 'ls' },
    manifest: 'default',
    expect: 'allow',
    rule: 'none',
    why: 'plain listing',
    ...overrides,
  }));
}

test('guards: 100 complete cases and tested modules pass', () => {
  const root = tempDir();
  writeJson(root, 'guards/cases.json', caseList(100));
  writeJson(root, 'guards/evaluator.mjs', '');
  writeJson(root, 'guards/evaluator.test.mjs', '');
  writeJson(root, 'guards/manifest.mjs', '');
  writeJson(root, 'guards/manifest.test.mjs', '');
  writeJson(root, 'guards/rules/production.mjs', '');
  assert.deepEqual(checkGuards(root), []);
});

test('guards: pretooluse.mjs is tested by cases.test.mjs, and manifest.mjs needs its own test', () => {
  assert.equal(guardTestFor('pretooluse.mjs'), 'cases.test.mjs');
  assert.equal(guardTestFor('evaluator.mjs'), 'evaluator.test.mjs');
  const root = tempDir();
  writeJson(root, 'guards/cases.json', caseList(100));
  writeJson(root, 'guards/pretooluse.mjs', '');
  writeJson(root, 'guards/cases.test.mjs', '');
  writeJson(root, 'guards/manifest.mjs', '');
  assert.deepEqual(checkGuards(root), ['guards/manifest.mjs has no matching guards/manifest.test.mjs']);
  writeJson(root, 'guards/manifest.test.mjs', '');
  assert.deepEqual(checkGuards(root), []);
});

test('guards: pretooluse.mjs without cases.test.mjs is reported', () => {
  const root = tempDir();
  writeJson(root, 'guards/cases.json', caseList(100));
  writeJson(root, 'guards/pretooluse.mjs', '');
  writeJson(root, 'guards/pretooluse.test.mjs', '');
  assert.deepEqual(checkGuards(root), ['guards/pretooluse.mjs has no matching guards/cases.test.mjs']);
});

test('guards: too few cases, a case missing fields, and a module without a test are reported', () => {
  const root = tempDir();
  const cases = caseList(5);
  delete cases[2].why;
  writeJson(root, 'guards/cases.json', cases);
  writeJson(root, 'guards/stop.mjs', '');
  const problems = checkGuards(root);
  assert.ok(problems.some((p) => p.includes('holds 5 cases')));
  assert.ok(problems.some((p) => p.includes('case 2 (case-2) lacks why')));
  assert.ok(problems.some((p) => p.includes('guards/stop.mjs has no matching guards/stop.test.mjs')));
});

test('guards: a missing or unparsable case file is reported', () => {
  const root = tempDir();
  assert.deepEqual(checkGuards(root), ['guards/cases.json is missing']);
  writeJson(root, 'guards/cases.json', '[');
  assert.ok(checkGuards(root)[0].includes('does not parse'));
});

test('versions: matching versions with a changelog section pass', () => {
  const root = tempDir();
  writeJson(root, '.claude-plugin/plugin.json', { version: '1.2.3' });
  writeJson(root, 'package.json', { version: '1.2.3' });
  writeJson(root, 'CHANGELOG.md', '# Changelog\n\n## 1.2.3\n\n- first\n');
  assert.deepEqual(checkVersions(root), []);
});

test('versions: a mismatch and a missing changelog section are reported', () => {
  const root = tempDir();
  writeJson(root, '.claude-plugin/plugin.json', { version: '1.2.3' });
  writeJson(root, 'package.json', { version: '1.2.4' });
  assert.equal(checkVersions(root).length, 2);
  writeJson(root, 'CHANGELOG.md', '# Changelog\n\n## 1.2.40\n');
  const problems = checkVersions(root);
  assert.ok(problems.some((p) => p.includes('differs from package.json')));
  assert.ok(problems.some((p) => p.includes('no "## 1.2.4" section')));
});
