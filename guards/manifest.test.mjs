// Tests for guards/manifest.mjs. Run: node --test guards/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadManifest, withDefaults, DEFAULTS, globToRegExp, matchesGlob, isUnderTree, relativeToRoot } from './manifest.mjs';

function repoWith(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkrein-manifest-'));
  if (text !== undefined) fs.writeFileSync(path.join(dir, 'checkrein.json'), text);
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// loadManifest

test('no manifest means inactive', () => {
  const dir = repoWith(undefined);
  try {
    const r = loadManifest(dir);
    assert.equal(r.active, false);
    assert.match(r.reason, /no checkrein\.json/);
  } finally {
    cleanup(dir);
  }
});

test('a version 1 manifest is inactive', () => {
  const dir = repoWith(JSON.stringify({ checkrein: { manifest_version: 1 }, protected_trees: ['retired/'] }));
  try {
    const r = loadManifest(dir);
    assert.equal(r.active, false);
    assert.match(r.reason, /version 1/);
  } finally {
    cleanup(dir);
  }
});

test('a version 2 manifest is active and filled with defaults', () => {
  const dir = repoWith(JSON.stringify({ checkrein: { manifest_version: 2 }, protected_trees: ['retired/'] }));
  try {
    const r = loadManifest(dir);
    assert.equal(r.active, true);
    assert.deepEqual(r.manifest.protected_trees, ['retired/']);
    assert.deepEqual(r.manifest.secret_globs, DEFAULTS.secret_globs);
    assert.deepEqual(r.manifest.example_globs, DEFAULTS.example_globs);
    assert.deepEqual(r.manifest.production_markers, { hosts: [], logins: [], ports: [], database_url_patterns: [] });
    assert.equal(r.manifest.consulted.mode, 'block');
    assert.deepEqual(r.manifest.approval.ask, ['push', 'pr_create', 'pr_merge', 'dependency_change']);
    assert.equal(r.manifest.paths.corrections_log, 'project-documentation/corrections-log.md');
  } finally {
    cleanup(dir);
  }
});

test('a higher version is active and given values override defaults key by key', () => {
  const manifest = {
    checkrein: { manifest_version: 3 },
    production_markers: { hosts: ['example.internal'], ports: [55000] },
    consulted: { mode: 'warn' },
    paths: { corrections_log: 'docs/corrections.md', state_doc: 'docs/state.md' },
  };
  const dir = repoWith(JSON.stringify(manifest));
  try {
    const r = loadManifest(dir);
    assert.equal(r.active, true);
    assert.deepEqual(r.manifest.production_markers, { hosts: ['example.internal'], logins: [], ports: [55000], database_url_patterns: [] });
    assert.equal(r.manifest.consulted.mode, 'warn');
    assert.deepEqual(r.manifest.consulted.code_globs, DEFAULTS.consulted.code_globs);
    assert.equal(r.manifest.paths.corrections_log, 'docs/corrections.md');
    assert.equal(r.manifest.paths.state_doc, 'docs/state.md');
  } finally {
    cleanup(dir);
  }
});

test('a byte order mark is tolerated', () => {
  const dir = repoWith(String.fromCharCode(0xfeff) + JSON.stringify({ checkrein: { manifest_version: 2 } }));
  try {
    assert.equal(loadManifest(dir).active, true);
  } finally {
    cleanup(dir);
  }
});

test('invalid JSON throws an error naming the file and the parse error', () => {
  const dir = repoWith('{ "checkrein": { "manifest_version": 2 }, }');
  try {
    assert.throws(() => loadManifest(dir), (err) => err.message.includes(path.join(dir, 'checkrein.json')) && /not valid JSON/.test(err.message));
  } finally {
    cleanup(dir);
  }
});

test('a non-object top level throws', () => {
  const dir = repoWith('[1, 2]');
  try {
    assert.throws(() => loadManifest(dir), /JSON object/);
  } finally {
    cleanup(dir);
  }
});

test('a missing or non-integer version throws', () => {
  for (const block of [undefined, {}, { manifest_version: '2' }, { manifest_version: 0 }, { manifest_version: 1.5 }]) {
    const dir = repoWith(JSON.stringify(block === undefined ? {} : { checkrein: block }));
    try {
      assert.throws(() => loadManifest(dir), /manifest_version must be a positive integer/);
    } finally {
      cleanup(dir);
    }
  }
});

test('a version 2 key of the wrong type throws with the key named', () => {
  const bad = [
    [{ protected_trees: 'retired/' }, /protected_trees must be an array of strings/],
    [{ secret_globs: [1] }, /secret_globs must be an array of strings/],
    [{ production_markers: { ports: ['abc'] } }, /production_markers\.ports/],
    [{ production_markers: { database_url_patterns: ['('] } }, /valid regular expressions/],
    [{ production_markers: null }, /production_markers must be an object/],
    [{ consulted: { mode: 'off' } }, /consulted\.mode/],
    [{ approval: { ask: 'push' } }, /approval\.ask/],
  ];
  for (const [extra, pattern] of bad) {
    const dir = repoWith(JSON.stringify({ checkrein: { manifest_version: 2 }, ...extra }));
    try {
      assert.throws(() => loadManifest(dir), pattern);
    } finally {
      cleanup(dir);
    }
  }
});

test('a missing repository root throws', () => {
  assert.throws(() => loadManifest(''), /no repository root/);
  assert.throws(() => loadManifest(undefined), /no repository root/);
});

test('withDefaults does not share default arrays between calls', () => {
  const a = withDefaults({});
  a.secret_globs.push('extra');
  assert.deepEqual(withDefaults({}).secret_globs, ['.env', '.env.*']);
});

// globToRegExp and matchesGlob

test('* matches within one path segment', () => {
  const re = globToRegExp('*.md');
  assert.equal(re.test('notes.md'), true);
  assert.equal(re.test('docs/notes.md'), false);
});

test('** matches across segments', () => {
  assert.equal(globToRegExp('src/**').test('src/a/b/c.js'), true);
  assert.equal(globToRegExp('src/**').test('lib/a.js'), false);
  assert.equal(globToRegExp('a/**/b').test('a/b'), true);
  assert.equal(globToRegExp('a/**/b').test('a/x/y/b'), true);
});

test('a leading **/ means any depth, including none', () => {
  const re = globToRegExp('**/src/**');
  assert.equal(re.test('src/a.js'), true);
  assert.equal(re.test('packages/web/src/a.js'), true);
  assert.equal(re.test('packages/web/lib/a.js'), false);
});

test('? matches exactly one character other than a slash', () => {
  const re = globToRegExp('file?.txt');
  assert.equal(re.test('file1.txt'), true);
  assert.equal(re.test('file12.txt'), false);
  assert.equal(re.test('file/.txt'), false);
});

test('{a,b} alternatives, nested, and an unmatched brace is literal', () => {
  assert.equal(globToRegExp('*.{js,mjs}').test('a.mjs'), true);
  assert.equal(globToRegExp('*.{js,mjs}').test('a.ts'), false);
  assert.equal(globToRegExp('{a,b{c,d}}.txt').test('bd.txt'), true);
  assert.equal(globToRegExp('a{b.txt').test('a{b.txt'), true);
});

test('regular expression characters in a glob are literal', () => {
  assert.equal(globToRegExp('.env').test('xenv'), false);
  assert.equal(globToRegExp('a+b(1).txt').test('a+b(1).txt'), true);
});

test('globs match case-insensitively', () => {
  assert.equal(globToRegExp('.env').test('.ENV'), true);
});

test('a glob without a slash matches the file name at any depth', () => {
  assert.equal(matchesGlob('config/.env', ['.env']), true);
  assert.equal(matchesGlob('.env.local', ['.env', '.env.*']), true);
  assert.equal(matchesGlob('config/app.env.sample', ['*.sample']), true);
  assert.equal(matchesGlob('env.md', ['.env']), false);
});

test('a glob with a slash matches the whole path from the root', () => {
  assert.equal(matchesGlob('src/app.js', ['src/**']), true);
  assert.equal(matchesGlob('lib/src/app.js', ['src/**']), false);
  assert.equal(matchesGlob('lib/src/app.js', ['**/src/**']), true);
  assert.equal(matchesGlob('keys/a.pem', ['/keys/*.pem']), true);
  assert.equal(matchesGlob('keys/a/b.pem', ['keys/']), true);
});

test('matchesGlob normalizes backslashes and a leading ./', () => {
  assert.equal(matchesGlob('.\\config\\.env', ['.env']), true);
  assert.equal(matchesGlob('./src/a.js', ['src/**']), true);
});

test('matchesGlob rejects bad input without throwing', () => {
  assert.equal(matchesGlob(undefined, ['.env']), false);
  assert.equal(matchesGlob('.env', null), false);
  assert.equal(matchesGlob('.env', [3, '']), false);
});

// isUnderTree

test('isUnderTree matches the tree and anything below it', () => {
  assert.equal(isUnderTree('retired', ['retired/']), true);
  assert.equal(isUnderTree('retired/plans/a.md', ['retired/']), true);
  assert.equal(isUnderTree('docs/a.md', ['retired/']), false);
});

test('isUnderTree compares whole segments, never a name prefix', () => {
  assert.equal(isUnderTree('retired-notes/a.md', ['retired']), false);
  assert.equal(isUnderTree('docs/retired/a.md', ['retired']), false);
});

test('isUnderTree ignores case and trailing slashes', () => {
  assert.equal(isUnderTree('Retired/A.md', ['retired']), true);
  assert.equal(isUnderTree('retired/a.md', ['RETIRED//']), true);
  assert.equal(isUnderTree('vendor/old/x', ['vendor/old/']), true);
});

test('isUnderTree normalizes separators and dot segments', () => {
  assert.equal(isUnderTree('retired\\a.md', ['retired']), true);
  assert.equal(isUnderTree('./docs/../retired/a.md', ['./retired/']), true);
});

test('isUnderTree never treats the root or an empty entry as a tree', () => {
  assert.equal(isUnderTree('docs/a.md', ['', '.', './']), false);
  assert.equal(isUnderTree('', ['retired']), false);
  assert.equal(isUnderTree('../retired/a.md', ['retired']), false);
});

// relativeToRoot

test('relativeToRoot returns the path inside the root', () => {
  assert.equal(relativeToRoot('/work/repo/retired/a.md', '/work/repo'), 'retired/a.md');
  assert.equal(relativeToRoot('/work/repo/retired/a.md', '/work/repo/'), 'retired/a.md');
});

test('relativeToRoot returns an empty string for the root itself', () => {
  assert.equal(relativeToRoot('/work/repo/', '/work/repo'), '');
});

test('relativeToRoot returns null outside the root, including a sibling with a shared prefix', () => {
  assert.equal(relativeToRoot('/work/other/a.md', '/work/repo'), null);
  assert.equal(relativeToRoot('/work/repo-old/a.md', '/work/repo'), null);
  assert.equal(relativeToRoot('/work/repo/../other/a.md', '/work/repo'), null);
});

test('relativeToRoot compares case-insensitively and keeps the path text', () => {
  assert.equal(relativeToRoot('/WORK/Repo/Retired/A.md', '/work/repo'), 'Retired/A.md');
});

test('relativeToRoot handles Windows-style paths', () => {
  assert.equal(relativeToRoot('C:\\Work\\Repo\\retired\\a.md', 'c:\\work\\repo'), 'retired/a.md');
  assert.equal(relativeToRoot('D:\\Work\\Repo\\a.md', 'c:\\work\\repo'), null);
});

test('relativeToRoot reads a relative path as relative to the root', () => {
  assert.equal(relativeToRoot('retired/a.md', '/work/repo'), 'retired/a.md');
  assert.equal(relativeToRoot('../a.md', '/work/repo'), null);
});

test('relativeToRoot rejects bad input without throwing', () => {
  assert.equal(relativeToRoot(undefined, '/work/repo'), null);
  assert.equal(relativeToRoot('/work/repo/a', ''), null);
});
