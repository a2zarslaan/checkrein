// common.mjs: path and argument helpers shared by the pretool rules.
//
// Every rule receives one context object built by pretooluse.mjs:
//   { tool, toolInput, command, segs, manifest, root, cwd }
// where segs is the evaluator's output for a Bash command (an empty array for other tools),
// root is the repository root and cwd is the directory the tool call runs in.
// A rule returns null (no opinion) or { decision, rule, reason }.
// Zero dependencies, Node 20 or newer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { relativeToRoot, isUnderTree, matchesGlob } from '../manifest.mjs';

export function result(decision, rule, reason) {
  return { decision, rule, reason };
}

export function isAbsolutePath(p) {
  return p.startsWith('/') || /^[a-z]:\//i.test(p);
}

let home = null;

function homeDir() {
  if (home === null) home = os.homedir().replace(/\\/g, '/');
  return home;
}

const DRIVE_ROOT = /^[a-z]:[\\/]/i;

// On a drive-letter root, the MSYS spelling `/c/repo` names `c:/repo`.
function msysToDrive(p, root) {
  if (!DRIVE_ROOT.test(String(root || ''))) return p;
  return p.replace(/^\/([a-z])(?=\/|$)/i, '$1:');
}

// Resolves a path as the shell or a file tool would see it: `~`, `$HOME` and `$PWD` expanded,
// a relative path read against cwd. Returns the absolute path with forward slashes.
export function absolutePath(text, cwd, root) {
  const base = msysToDrive(String(cwd || root || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/', root);
  let p = msysToDrive(String(text).replace(/\\/g, '/'), root);
  p = p
    .replace(/^~(?=\/|$)/, homeDir())
    .replace(/^\$\{?HOME\}?(?=\/|$)/, homeDir())
    .replace(/^\$\{?PWD\}?(?=\/|$)/, base);
  if (!isAbsolutePath(p)) p = (base === '/' ? '' : base) + '/' + p;
  return p;
}

const realCache = new Map();

function realOrNull(p) {
  try {
    return fs.realpathSync.native(p).replace(/\\/g, '/');
  } catch {
    return null;
  }
}

function realRoot(root) {
  if (!realCache.has(root)) realCache.set(root, realOrNull(root));
  return realCache.get(root);
}

// The real form of a path that may not exist yet: its longest existing ancestor resolved, the
// rest appended.
function realPath(abs) {
  const parts = path.posix.normalize(abs).split('/');
  for (let n = parts.length; n > 1; n--) {
    const head = parts.slice(0, n).join('/') || '/';
    const real = realOrNull(head);
    if (real !== null) return [real.replace(/\/+$/, ''), ...parts.slice(n)].join('/');
  }
  return null;
}

// The repository-relative form of a path, or null when it lies outside the repository. A root
// or a path reached through a symbolic link is compared in its real form too.
export function repoRelative(text, cwd, root) {
  if (typeof text !== 'string' || text === '') return null;
  const abs = absolutePath(text, cwd, root);
  const direct = relativeToRoot(abs, root);
  if (direct !== null || DRIVE_ROOT.test(root) || !abs.startsWith('/')) return direct;
  const rr = realRoot(root);
  if (rr && rr !== root) {
    const viaRoot = relativeToRoot(abs, rr);
    if (viaRoot !== null) return viaRoot;
  }
  const rp = realPath(abs);
  if (rp === null || rp === abs) return null;
  return relativeToRoot(rp, root) ?? (rr ? relativeToRoot(rp, rr) : null);
}

// True when a path names the repository root or one of its ancestors, or a folder above a tree:
// a recursive walk that starts there reaches the tree.
export function walksTree(text, cwd, root, trees) {
  const rel = repoRelative(text, cwd, root);
  if (rel === null) {
    const abs = absolutePath(text, cwd, root).toLowerCase().replace(/\/+$/, '');
    const r = String(root).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    return abs === '' || r.startsWith(abs + '/');
  }
  if (rel === '') return true;
  const p = rel.toLowerCase().replace(/\/+$/, '');
  return trees.some((t) => String(t).toLowerCase().replace(/^\.?\/+/, '').startsWith(p + '/'));
}

// Glob words: a shell expands `*`, `?` and `[...]` only outside quotes.
const GLOB_CHAR = /[*?[]/;

export function hasGlob(word) {
  return GLOB_CHAR.test(String(word));
}

// True when the segment's source text holds a glob character outside quotes.
export function unquotedGlob(raw) {
  return GLOB_CHAR.test(String(raw).replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ''));
}

// One path component of a shell glob as a regular expression. A wildcard never matches a
// leading dot, as in the shell without dotglob.
export function componentRegExp(comp) {
  const c = String(comp);
  let re = '';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else if (ch === '[') {
      const end = c.indexOf(']', i + 2);
      if (end < 0) { re += '\\['; continue; }
      let body = c.slice(i + 1, end);
      if (body.startsWith('!')) body = '^' + body.slice(1);
      re += '[' + body.replace(/\\/g, '\\\\') + ']';
      i = end;
    } else re += escapeRegExp(ch);
  }
  const dot = /^[*?[]/.test(c) ? '(?!\\.)' : '';
  return new RegExp('^' + dot + re + '$', 'i');
}

function treeParts(tree) {
  return String(tree).replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean);
}

// True when a repository-relative glob pattern names a path inside the tree: its leading
// components (after any `**` components, which may match nothing) each match the tree's, and
// the first of them holds a literal character. A pattern made only of wildcards (`**/*.md`,
// `*/x`) is a repository-wide search, which the `.ignore` file governs.
export function patternReachesTree(relPattern, tree) {
  const comps = String(relPattern).replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter((c) => c !== '' && c !== '.');
  const tparts = treeParts(tree);
  if (!tparts.length) return false;
  for (let s = 0; s < comps.length; s++) {
    if (s > 0 && comps[s - 1] !== '**') break;
    if (!/[^*?]/.test(comps[s].replace(/\[[^\]]*\]/g, 'x'))) continue;
    let ok = true;
    for (let j = 0; j < tparts.length; j++) {
      const comp = comps[s + j];
      if (comp === undefined || comp === '**' || !componentRegExp(comp).test(tparts[j])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// Brace alternatives of a glob, expanded: `{a,b}/x` gives `a/x` and `b/x`.
export function expandBraces(glob) {
  const g = String(glob);
  const open = g.indexOf('{');
  if (open < 0) return [g];
  let depth = 0;
  const cuts = [];
  for (let i = open; i < g.length; i++) {
    if (g[i] === '{') depth += 1;
    else if (g[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const parts = [];
        let start = open + 1;
        let d = 0;
        for (let k = open + 1; k < i; k++) {
          if (g[k] === '{') d += 1;
          else if (g[k] === '}') d -= 1;
          else if (g[k] === ',' && d === 0) { parts.push(g.slice(start, k)); start = k + 1; }
        }
        parts.push(g.slice(start, i));
        for (const p of parts) for (const rest of expandBraces(g.slice(i + 1))) cuts.push(...expandBraces(g.slice(0, open) + p + rest));
        return cuts;
      }
    }
  }
  return [g];
}

// The protected tree a glob word could expand into, or null.
export function globTreeFor(text, cwd, root, trees) {
  if (!hasGlob(text)) return null;
  for (const alt of expandBraces(text)) {
    const rel = repoRelative(alt, cwd, root);
    if (rel === null || rel === '') continue;
    const tree = trees.find((t) => patternReachesTree(rel, t));
    if (tree) return tree;
  }
  return null;
}

// A literal file name a secret glob stands for: `.env.*` stands for `.env.x`.
function secretLiteral(glob) {
  return String(glob).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\*+/g, 'x').replace(/\?/g, 'x');
}

// The secret glob a glob word could expand onto (and no example glob covers), or null.
export function secretGlobForPattern(text, cwd, root, manifest) {
  if (!hasGlob(text)) return null;
  for (const alt of expandBraces(text)) {
    let rel = repoRelative(alt, cwd, root);
    if (rel === null) rel = absolutePath(alt, cwd, root).replace(/^[a-z]:\//i, '').replace(/^\/+/, '');
    if (rel === '') continue;
    const comps = rel.split('/');
    for (const g of manifest.secret_globs) {
      const lit = secretLiteral(g);
      if (matchesGlob(lit, manifest.example_globs)) continue;
      const anchored = String(g).includes('/');
      const litComps = lit.split('/');
      const want = anchored ? comps : comps.slice(-1);
      const have = anchored ? litComps : litComps.slice(-1);
      if (want.length === have.length && want.every((c, i) => componentRegExp(c).test(have[i]))) return g;
    }
  }
  return null;
}

const JOINERS = new Set(['pipe', 'and', 'or', 'seq']);
const shapes = new WeakMap();

// For every segment, in one pass: the kind of its group's first segment, and the first later
// segment at a lower depth (the one that holds it).
function shapeOf(segs) {
  let s = shapes.get(segs);
  if (s) return s;
  const kinds = new Array(segs.length);
  const holders = new Array(segs.length).fill(-1);
  const groupAt = [];
  const open = [];
  for (let i = 0; i < segs.length; i++) {
    const { depth, kind } = segs[i];
    while (open.length && segs[open[open.length - 1]].depth > depth) holders[open.pop()] = i;
    if (!JOINERS.has(kind)) groupAt[depth] = kind;
    kinds[i] = groupAt[depth] || 'top';
    open.push(i);
  }
  s = { kinds, holders };
  shapes.set(segs, s);
  return s;
}

// The group a segment belongs to: the kind of the first segment of its group.
export function groupKind(segs, i) {
  return shapeOf(segs).kinds[i];
}

// The segment that holds a substitution: the first later segment at a lower depth. -1 when the
// segment is not inside a substitution.
export function holderIndex(segs, i) {
  const s = shapeOf(segs);
  return s.kinds[i] === 'substitution' ? s.holders[i] : -1;
}

// The protected tree a path falls under, or null.
export function treeFor(text, cwd, root, trees) {
  const rel = repoRelative(text, cwd, root);
  if (rel === null || rel === '') return null;
  return trees.find((t) => isUnderTree(rel, [t])) || null;
}

// The secret glob a path matches (and no example glob does), or null. A path outside the
// repository is matched on its absolute form, so a name-only glob such as `.env` still applies.
export function secretGlobFor(text, cwd, root, manifest) {
  if (typeof text !== 'string' || text === '') return null;
  let rel = repoRelative(text, cwd, root);
  if (rel === null) rel = absolutePath(text, cwd, root).replace(/^[a-z]:\//i, '').replace(/^\/+/, '');
  if (rel === '') return null;
  if (matchesGlob(rel, manifest.example_globs)) return null;
  return manifest.secret_globs.find((g) => matchesGlob(rel, [g])) || null;
}

// A word plus the pieces a shell or a tool could read as separate paths: `--file=a`, `HEAD:a`,
// `a,b`, braces, parentheses, quotes, words of a sentence. The whole word is always kept too,
// so a Windows path such as `C:/repo/x` is read before it is split at the colon.
const PIECE_SPLIT = /[\s=:,{}()'"`<>|;&]+/;

export function pieces(text) {
  const t = String(text);
  const out = new Set([t]);
  for (const part of t.split(PIECE_SPLIT)) if (part) out.add(part);
  return [...out];
}

// The same split without breaking on whitespace: an argument such as a commit message is one
// piece, so a sentence that mentions a file name is not read as that file.
const ARG_SPLIT = /[=,]|:(?![\\/])/;

export function argPieces(text) {
  const t = String(text);
  const out = new Set([t]);
  for (const part of t.split(ARG_SPLIT)) if (part) out.add(part);
  return [...out];
}

export function baseName(word) {
  return String(word).replace(/^.*[\/\\]/, '').replace(/\.exe$/i, '');
}

// True when the segment's command word was reached through xargs.
export function viaXargs(seg) {
  const lead = seg.rawArgv.length - seg.argv.length;
  return lead > 0 && seg.rawArgv.slice(0, lead).some((t) => baseName(t) === 'xargs');
}

// The nearest earlier segment of equal depth: the one a pipe reads from. -1 when none.
export function upstreamIndex(segs, i) {
  const d = segs[i].depth;
  for (let j = i - 1; j >= 0; j--) {
    if (segs[j].depth === d) return j;
    if (segs[j].depth < d) return -1;
  }
  return -1;
}

const GIT_VALUE_OPTS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);

// The git subcommand and its position in argv (argv[0] is `git`). Global options before the
// subcommand are skipped, including `-c name=value`, `-C <dir>` and their glued forms.
export function gitSubcommand(argv) {
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') return { name: argv[i + 1] || '', index: i + 1 };
    if (GIT_VALUE_OPTS.has(a)) { i += 2; continue; }
    if (a.startsWith('-')) { i += 1; continue; }
    return { name: a, index: i };
  }
  return { name: '', index: argv.length };
}

const HEREDOC_OPS = /(<<|<<-|<<<)$/;

// Redirect targets that name a file (heredoc delimiters and here-strings are data).
export function fileRedirects(seg) {
  return seg.redirects.filter((r) => !HEREDOC_OPS.test(r.op) && r.target !== '');
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}
