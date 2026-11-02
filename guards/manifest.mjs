// manifest.mjs: the manifest loader and path matchers shared by every checkrein guard.
//
// loadManifest(projectDir) is the one switch for enforcement. It reads checkrein.json at the
// repository root and returns { active: false, reason } when the file is absent or its
// checkrein.manifest_version is below 2, or { active: true, manifest } for version 2 or higher,
// with every tier 2 key filled from DEFAULTS. Anything else throws an Error naming the file
// (unreadable, invalid JSON, a missing or non-integer version, a key of the wrong type), so the
// hook entry points fail closed with an ask. It is the only function here that touches the disk.
//
// Path rules: paths use forward slashes after normalizing, and every comparison ignores case.
// A glob without a slash matches the file name at any depth (".env" matches "config/.env");
// a glob with a slash matches the whole path from the repository root.
// Zero dependencies, Node 20 or newer.

import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILE = 'checkrein.json';

export const DEFAULTS = Object.freeze({
  protected_trees: [],
  secret_globs: ['.env', '.env.*'],
  example_globs: ['.env.example', '*.example', '*.sample'],
  production_markers: { hosts: [], logins: [], ports: [], database_url_patterns: [] },
  approval: { ask: ['push', 'pr_create', 'pr_merge', 'dependency_change'], dependency_commands: [] },
  consulted: { mode: 'block', code_globs: ['src/**', '**/src/**'], required_reads: [] },
  paths: { corrections_log: 'project-documentation/corrections-log.md' },
});

const OBJECT_KEYS = ['production_markers', 'approval', 'consulted', 'paths'];

export function loadManifest(projectDir) {
  if (typeof projectDir !== 'string' || projectDir === '') {
    throw new Error('checkrein: no repository root was given, so checkrein.json cannot be located');
  }
  const file = path.join(projectDir, MANIFEST_FILE);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return { active: false, reason: `no ${MANIFEST_FILE} at ${file}` };
    }
    throw new Error(`checkrein: cannot read ${file}: ${err && err.message ? err.message : String(err)}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`checkrein: ${file} is not valid JSON: ${err.message}`);
  }
  if (!isPlainObject(data)) throw new Error(`checkrein: ${file} must hold a JSON object at the top level`);
  const version = isPlainObject(data.checkrein) ? data.checkrein.manifest_version : undefined;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`checkrein: ${file}: checkrein.manifest_version must be a positive integer`);
  }
  if (version < 2) {
    return { active: false, reason: `${file} is manifest version ${version}; enforcement needs version 2` };
  }
  const manifest = withDefaults(data);
  validate(manifest, file);
  return { active: true, manifest };
}

export function withDefaults(data) {
  const out = { ...data };
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (OBJECT_KEYS.includes(key)) {
      const given = isPlainObject(out[key]) ? out[key] : out[key] === undefined ? {} : out[key];
      out[key] = isPlainObject(given) ? { ...structuredClone(value), ...given } : given;
    } else if (out[key] === undefined) {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

function validate(m, file) {
  const fail = (key, what) => {
    throw new Error(`checkrein: ${file}: ${key} must be ${what}`);
  };
  for (const key of OBJECT_KEYS) if (!isPlainObject(m[key])) fail(key, 'an object');
  const stringLists = {
    protected_trees: m.protected_trees,
    secret_globs: m.secret_globs,
    example_globs: m.example_globs,
    'production_markers.hosts': m.production_markers.hosts,
    'production_markers.logins': m.production_markers.logins,
    'production_markers.database_url_patterns': m.production_markers.database_url_patterns,
    'approval.ask': m.approval.ask,
    'approval.dependency_commands': m.approval.dependency_commands,
    'consulted.code_globs': m.consulted.code_globs,
    'consulted.required_reads': m.consulted.required_reads,
  };
  for (const [key, list] of Object.entries(stringLists)) {
    if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) fail(key, 'an array of strings');
  }
  const ports = m.production_markers.ports;
  if (!Array.isArray(ports) || !ports.every((p) => (Number.isInteger(p) && p > 0) || (typeof p === 'string' && /^\d+$/.test(p)))) {
    fail('production_markers.ports', 'an array of port numbers');
  }
  for (const source of m.production_markers.database_url_patterns) {
    try {
      new RegExp(source);
    } catch (err) {
      fail('production_markers.database_url_patterns', `valid regular expressions (${err.message})`);
    }
  }
  if (m.consulted.mode !== 'block' && m.consulted.mode !== 'warn') fail('consulted.mode', '"block" or "warn"');
  if (typeof m.paths.corrections_log !== 'string' || m.paths.corrections_log === '') fail('paths.corrections_log', 'a non-empty string');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

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

function cleanAbs(p) {
  let s = path.posix.normalize(String(p).replace(/\\/g, '/'));
  if (s.length > 1 && !/^[a-z]:\/$/i.test(s)) s = s.replace(/\/+$/, '');
  return s;
}

function isAbsolutePath(p) {
  return p.startsWith('/') || /^[a-z]:\//i.test(p);
}

// A relative absPath is read as relative to the root. Returns '' for the root itself.
export function relativeToRoot(absPath, root) {
  if (typeof absPath !== 'string' || typeof root !== 'string' || root === '') return null;
  const r = cleanAbs(root);
  let p = absPath.replace(/\\/g, '/');
  if (!isAbsolutePath(p)) p = r + '/' + p;
  p = cleanAbs(p);
  const pl = p.toLowerCase();
  const rl = r.toLowerCase();
  if (pl === rl) return '';
  const prefix = rl.endsWith('/') ? rl : rl + '/';
  return pl.startsWith(prefix) ? p.slice(prefix.length) : null;
}
