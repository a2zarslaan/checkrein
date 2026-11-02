#!/usr/bin/env node
// diff-check.mjs: the git hook and CI fallback for checkrein enforcement.
//
// Usage (from the repository root, or with --root <dir>):
//   node checkrein-diff-check.mjs --staged
//   node checkrein-diff-check.mjs --range <base>..<head>     (the three-dot form also works)
//
// Fails on: a file matching secret_globs (and no example_globs entry) added or modified; a file
// under a protected tree modified or deleted. Adding a file into a protected tree is retirement
// and passes. Warns (never fails) on added lines in text files that name a production host,
// login or database URL pattern, because runbooks legitimately name hosts.
// Exit 1 on any failure, 0 otherwise. Everything goes to stdout, one line per finding.
//
// With no checkrein.json, or a manifest below version 2, the check is off and exits 0 with one
// line saying so. A manifest that cannot be parsed fails closed (exit 1).
//
// This file must stay standalone: init and upgrade copy it to an adopter's repository root as
// checkrein-diff-check.mjs, where guards/manifest.mjs does not exist. globToRegExp, matchesGlob
// and isUnderTree below are therefore inlined copies of the helpers in guards/manifest.mjs, and
// guards/diff-check.test.mjs asserts that both copies agree. Change them together.
// Zero dependencies, Node 20 or newer.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_FILE = 'checkrein.json';
const NUL = String.fromCharCode(0);

const DEFAULTS = Object.freeze({
  protected_trees: [],
  secret_globs: ['.env', '.env.*'],
  example_globs: ['.env.example', '*.example', '*.sample'],
  production_markers: { hosts: [], logins: [], ports: [], database_url_patterns: [] },
});

// ---------------------------------------------------------------------------------------------
// Inlined path helpers (copies of guards/manifest.mjs; see the header).

export function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, '/');
  const closes = matchBraces(g);
  const open = [];
  let re = '';
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      let j = i;
      while (g[j] === '*') j++;
      if (j - i >= 2) {
        const atStart = i === 0 || g[i - 1] === '/';
        if (atStart && g[j] === '/') {
          re += '(?:.*/)?';
          i = j + 1;
        } else {
          re += '.*';
          i = j;
        }
        continue;
      }
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }
    if (c === '{' && closes.has(i)) {
      open.push(closes.get(i));
      re += '(?:';
      i += 1;
      continue;
    }
    if (c === ',' && open.length) {
      re += '|';
      i += 1;
      continue;
    }
    if (c === '}' && open.length && open[open.length - 1] === i) {
      open.pop();
      re += ')';
      i += 1;
      continue;
    }
    re += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    i += 1;
  }
  return new RegExp('^' + re + '$', 'i');
}

function matchBraces(g) {
  const closes = new Map();
  const stack = [];
  for (let i = 0; i < g.length; i++) {
    if (g[i] === '{') stack.push(i);
    else if (g[i] === '}' && stack.length) closes.set(stack.pop(), i);
  }
  return closes;
}

function cleanRel(p) {
  let s = path.posix.normalize(String(p).replace(/\\/g, '/'));
  if (s.startsWith('./')) s = s.slice(2);
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s === '.' ? '' : s;
}

export function matchesGlob(relPath, globs) {
  if (typeof relPath !== 'string' || !Array.isArray(globs)) return false;
  const p = cleanRel(relPath);
  if (p === '') return false;
  const name = p.slice(p.lastIndexOf('/') + 1);
  return globs.some((glob) => {
    if (typeof glob !== 'string' || glob === '') return false;
    let g = glob.replace(/\\/g, '/');
    if (g.endsWith('/')) g += '**';
    if (g.startsWith('./')) g = g.slice(2);
    else if (g.startsWith('/')) g = g.slice(1);
    const anchored = glob.replace(/\\/g, '/').includes('/');
    return globToRegExp(g).test(anchored ? p : name);
  });
}

export function isUnderTree(relPath, trees) {
  if (typeof relPath !== 'string' || !Array.isArray(trees)) return false;
  const p = cleanRel(relPath).toLowerCase();
  if (p === '' || p === '..' || p.startsWith('../')) return false;
  return trees.some((t) => {
    if (typeof t !== 'string') return false;
    const tree = cleanRel(t).replace(/^\/+/, '').toLowerCase();
    if (tree === '' || tree === '..' || tree.startsWith('../')) return false;
    return p === tree || p.startsWith(tree + '/');
  });
}

// ---------------------------------------------------------------------------------------------
// Manifest

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Returns { active: false, reason } or { active: true, manifest }; throws on a broken manifest.
export function readManifest(root) {
  const file = path.join(root, MANIFEST_FILE);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return { active: false, reason: `no ${MANIFEST_FILE} at ${root}, so there is nothing to check (run the init skill to install one)` };
    }
    throw new Error(`cannot read ${file}: ${err && err.message ? err.message : String(err)}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!isPlainObject(data)) throw new Error(`${file} must hold a JSON object at the top level`);
  const version = isPlainObject(data.checkrein) ? data.checkrein.manifest_version : undefined;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`${file}: checkrein.manifest_version must be a positive integer`);
  }
  if (version < 2) {
    return { active: false, reason: `manifest version ${version}; enforcement starts at version 2 (run the upgrade skill to turn it on)` };
  }
  return { active: true, manifest: normalizeManifest(data, file) };
}

export function normalizeManifest(data, file = MANIFEST_FILE) {
  const fail = (key, what) => {
    throw new Error(`${file}: ${key} must be ${what}`);
  };
  const m = { ...data };
  for (const key of ['protected_trees', 'secret_globs', 'example_globs']) {
    if (m[key] === undefined) m[key] = [...DEFAULTS[key]];
  }
  if (m.production_markers === undefined) m.production_markers = {};
  if (!isPlainObject(m.production_markers)) fail('production_markers', 'an object');
  m.production_markers = { ...structuredClone(DEFAULTS.production_markers), ...m.production_markers };
  const lists = {
    protected_trees: m.protected_trees,
    secret_globs: m.secret_globs,
    example_globs: m.example_globs,
    'production_markers.hosts': m.production_markers.hosts,
    'production_markers.logins': m.production_markers.logins,
    'production_markers.database_url_patterns': m.production_markers.database_url_patterns,
  };
  for (const [key, list] of Object.entries(lists)) {
    if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) fail(key, 'an array of strings');
  }
  for (const source of m.production_markers.database_url_patterns) {
    try {
      new RegExp(source, 'i');
    } catch (err) {
      fail('production_markers.database_url_patterns', `valid regular expressions (${err.message})`);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// The rules

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

// A host matches, ignoring case, as a whole token or as the dot-suffix of a subdomain, the same
// rule the production guard applies: "example.internal" matches "db.example.internal" but not
// "myexample.internal" or "example.internal2", while a sentence-ending period still matches.
function hostMatcher(host) {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(host)}(?![A-Za-z0-9_-])(?!\\.[A-Za-z0-9])`, 'i');
}

function loginMatcher(login) {
  return new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(login)}`, 'i');
}

function buildMarkers(manifest) {
  const pm = (manifest && manifest.production_markers) || {};
  const out = [];
  for (const h of pm.hosts || []) if (typeof h === 'string' && h.trim()) out.push({ kind: 'host', value: h, re: hostMatcher(h.trim()) });
  for (const l of pm.logins || []) if (typeof l === 'string' && l.trim()) out.push({ kind: 'login', value: l, re: loginMatcher(l.trim()) });
  for (const d of pm.database_url_patterns || []) if (typeof d === 'string' && d) out.push({ kind: 'database URL pattern', value: d, re: new RegExp(d, 'i') });
  return out;
}

function lineEntries(addedLines) {
  if (!Array.isArray(addedLines)) return [];
  return addedLines.map((entry, i) =>
    typeof entry === 'string' ? { line: null, text: entry, ordinal: i + 1 } : { line: entry && Number.isInteger(entry.line) ? entry.line : null, text: entry ? String(entry.text ?? '') : '', ordinal: i + 1 },
  );
}

// rows: { status, path, addedLines, oldPath?, binary? }[]. status is a git name-status letter
// (A, M, D, T, R, C; a trailing score such as R100 is accepted). addedLines are strings or
// { line, text }. Returns { failures, warnings }, each a list of { rule, path, message }.
export function checkDiff(rows, manifest) {
  const m = manifest || {};
  const secretGlobs = Array.isArray(m.secret_globs) ? m.secret_globs : DEFAULTS.secret_globs;
  const exampleGlobs = Array.isArray(m.example_globs) ? m.example_globs : DEFAULTS.example_globs;
  const trees = Array.isArray(m.protected_trees) ? m.protected_trees : [];
  const markers = buildMarkers(m);
  const failures = [];
  const warnings = [];

  for (const row of rows || []) {
    if (!row || typeof row.path !== 'string') continue;
    const status = String(row.status || '').charAt(0).toUpperCase();
    const p = row.path;
    const isSecret = (x) => matchesGlob(x, secretGlobs) && !matchesGlob(x, exampleGlobs);

    if ((status === 'A' || status === 'M' || status === 'T' || status === 'R' || status === 'C') && isSecret(p)) {
      const glob = secretGlobs.find((g) => matchesGlob(p, [g]));
      const verb = status === 'M' || status === 'T' ? 'modified' : 'added';
      failures.push({
        rule: 'secret',
        path: p,
        message: `FAIL ${p}: secret file ${verb} (matches secret glob ${glob}). Keep it out of version control (git rm --cached <path>) and commit an example file matching example_globs instead.`,
      });
    }

    if ((status === 'M' || status === 'T' || status === 'D') && isUnderTree(p, trees)) {
      const verb = status === 'D' ? 'deleted' : 'modified';
      failures.push({
        rule: 'protected',
        path: p,
        message: `FAIL ${p}: file inside a protected tree ${verb}. Protected trees only take new files (retirement); restore it with git restore --staged --worktree <path>.`,
      });
    }
    if (status === 'R' && typeof row.oldPath === 'string' && isUnderTree(row.oldPath, trees)) {
      failures.push({
        rule: 'protected',
        path: row.oldPath,
        message: `FAIL ${row.oldPath}: file moved out of a protected tree (to ${p}). Protected trees only take new files (retirement); leave it where it is.`,
      });
    }

    // The manifest at the root is where the markers are configured, so it is not scanned.
    if (status === 'D' || row.binary === true || markers.length === 0 || cleanRel(p) === MANIFEST_FILE) continue;
    for (const { line, text, ordinal } of lineEntries(row.addedLines)) {
      if (text.includes(NUL)) continue;
      for (const marker of markers) {
        if (!marker.re.test(text)) continue;
        const where = line !== null ? `${p}:${line}` : `${p} (added line ${ordinal})`;
        warnings.push({
          rule: 'production',
          path: p,
          message: `WARN ${where}: added line names production ${marker.kind} ${marker.value}. Fine in a runbook; elsewhere move it to configuration.`,
        });
      }
    }
  }
  return { failures, warnings };
}

// ---------------------------------------------------------------------------------------------
// Git output parsers

// Parses `git diff --name-status -z --no-renames` output (also handles rename records).
export function parseNameStatus(out) {
  const parts = String(out).split(NUL);
  const rows = [];
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    if (!status) {
      i += 1;
      continue;
    }
    const letter = status.charAt(0).toUpperCase();
    if (letter === 'R' || letter === 'C') {
      rows.push({ status: letter, oldPath: parts[i + 1], path: parts[i + 2], addedLines: [] });
      i += 3;
    } else {
      rows.push({ status: letter, path: parts[i + 1], addedLines: [] });
      i += 2;
    }
  }
  return rows.filter((r) => typeof r.path === 'string' && r.path !== '');
}

function unquoteCPath(s) {
  if (!s.startsWith('"')) return s;
  const body = s.endsWith('"') ? s.slice(1, -1) : s.slice(1);
  const bytes = [];
  const map = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const n = body[i + 1];
    if (/[0-7]/.test(n || '')) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else if (n in map) {
      bytes.push(map[n]);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function headerPath(rest) {
  let s = rest.replace(/\t$/, '');
  if (s === '/dev/null') return null;
  s = unquoteCPath(s);
  return s.startsWith('b/') ? s.slice(2) : s;
}

// Parses `git diff -U0` output into Map(path -> { addedLines: { line, text }[], binary }).
export function parsePatch(out) {
  const files = new Map();
  let current = null;
  let inHunk = false;
  let newLine = 0;
  let pendingBinary = false;
  for (const raw of String(out).split('\n')) {
    if (raw.startsWith('diff --git ')) {
      current = null;
      inHunk = false;
      pendingBinary = false;
      continue;
    }
    if (!inHunk) {
      if (raw.startsWith('+++ ')) {
        const p = headerPath(raw.slice(4));
        current = p === null ? null : { addedLines: [], binary: false };
        if (p !== null) files.set(p, current);
        continue;
      }
      if (raw.startsWith('Binary files ')) {
        const m = raw.match(/ and (.+) differ$/);
        const p = m ? headerPath(m[1]) : null;
        if (p !== null) files.set(p, { addedLines: [], binary: true });
        pendingBinary = true;
        continue;
      }
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      inHunk = !pendingBinary && current !== null;
      newLine = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (inHunk && current) {
      if (raw.startsWith('+')) {
        current.addedLines.push({ line: newLine, text: raw.slice(1) });
        newLine += 1;
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------------------------------------
// CLI

function git(root, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function collectRows(root, mode, range) {
  // Fixed prefixes, so diff.mnemonicPrefix or diff.noprefix cannot change the +++ header shape.
  const base = ['diff', '--no-renames', '--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/'];
  const selector = mode === 'staged' ? ['--cached'] : [range];
  const rows = parseNameStatus(git(root, [...base, '--name-status', '-z', ...selector]));
  const patch = parsePatch(git(root, [...base, '-U0', ...selector]));
  for (const row of rows) {
    const info = patch.get(row.path);
    if (info) {
      row.addedLines = info.addedLines;
      row.binary = info.binary;
    }
  }
  return rows;
}

function parseArgs(argv) {
  const opts = { mode: null, range: null, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged' || a === '--cached') opts.mode = 'staged';
    else if (a === '--range') {
      opts.mode = 'range';
      opts.range = argv[++i];
    } else if (a.startsWith('--range=')) {
      opts.mode = 'range';
      opts.range = a.slice('--range='.length);
    } else if (a === '--root') opts.root = argv[++i];
    else if (a.startsWith('--root=')) opts.root = a.slice('--root='.length);
    else throw new Error(`unknown argument ${a}; use --staged or --range <base>..<head>, optionally with --root <dir>`);
  }
  if (!opts.mode) throw new Error('give --staged or --range <base>..<head>');
  if (opts.mode === 'range' && (!opts.range || opts.range.startsWith('-') || !opts.range.includes('..'))) {
    throw new Error('--range needs a value of the form <base>..<head> or <base>...<head>');
  }
  if (!opts.root) throw new Error('--root needs a directory');
  return opts;
}

export function main(argv, log = (line) => process.stdout.write(line + '\n')) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    log(`diff-check: FAIL ${err.message}`);
    return 1;
  }
  const root = path.resolve(opts.root);
  let loaded;
  try {
    loaded = readManifest(root);
  } catch (err) {
    log(`diff-check: FAIL the manifest cannot be used, so the check fails closed: ${err.message}`);
    return 1;
  }
  if (!loaded.active) {
    log(`diff-check: OK (enforcement off: ${loaded.reason})`);
    return 0;
  }
  let rows;
  try {
    rows = collectRows(root, opts.mode, opts.range);
  } catch (err) {
    const detail = (err && err.stderr ? String(err.stderr) : err && err.message ? err.message : String(err)).trim().split('\n')[0];
    log(`diff-check: FAIL git diff did not run, so the check fails closed: ${detail}`);
    return 1;
  }
  let result;
  try {
    result = checkDiff(rows, loaded.manifest);
  } catch (err) {
    log(`diff-check: FAIL internal error, so the check fails closed: ${err && err.message ? err.message : String(err)}`);
    return 1;
  }
  for (const f of result.failures) log(`diff-check: ${f.message}`);
  for (const w of result.warnings) log(`diff-check: ${w.message}`);
  if (result.failures.length) {
    log(`diff-check: ${result.failures.length} failure(s); fix them before committing or pushing.`);
    return 1;
  }
  log('diff-check: OK');
  return 0;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2));
}
