// protected-trees.mjs: the protected-tree rule (file tools and Bash, deny).
//
// File tools: deny when the target path or a Grep or Glob `path` lies under a protected tree, or
// when a Grep `glob` or Glob `pattern` could match a path inside one (each component matched,
// `**` and brace alternatives included). A search with no path or pattern into a tree is
// allowed; the `.ignore` file keeps repository-wide searches out of the trees.
// Bash: deny a segment that names a protected tree (literally, or as an unquoted glob that
// expands into it) unless its command word is a metadata or retirement command, and an
// assignment-only segment that names one; deny a reader downstream of a mention through a pipe
// (a substitution is part of its holder's text, so the holder is judged on it); deny an `mv`
// whose source is in a tree; deny a recursive grep, a find with an action, an rg that skips
// ignore files, or a git grep with no path, run from the repository root or a folder above a
// tree. Relative paths follow a literal `cd` or `pushd` earlier in the command; after one whose
// target cannot be read from the text, any path component equal to a tree's first component
// counts as a mention. A command that starts with CHECKREIN_ALLOW_PROTECTED=1 lifts this rule
// only.

import { hasRecursiveGrepFromRoot, startsWithAllowPrefix } from '../evaluator.mjs';
import {
  result, treeFor, pieces, viaXargs, upstreamIndex, gitSubcommand, fileRedirects, absolutePath, repoRelative,
  walksTree, globTreeFor, unquotedGlob, expandBraces, patternReachesTree,
} from './common.mjs';

export const RULE = 'protected-trees';
export const ALLOW_PREFIX = 'CHECKREIN_ALLOW_PROTECTED';

const META = new Set(['ls', 'test', '[', 'stat', 'du', 'wc', 'mkdir', 'echo', 'printf', 'gh']);
const GIT_META = new Set(['log', 'add', 'rm', 'commit', 'status', 'restore']);
const FIND_ACTIONS = new Set(['-exec', '-execdir', '-delete', '-ok', '-okdir']);
const DIFF_STAT = new Set(['--stat', '--shortstat', '--numstat', '--name-only', '--name-status']);
// Commands that only read the listing a metadata command prints on their stdin.
const STDIN_FILTERS = new Set(['wc', 'sort', 'uniq', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'cut', 'tr', 'column', 'cat', 'less', 'more', 'nl']);

function deny(tree) {
  return result(
    'deny',
    RULE,
    `checkrein: ${tree} is a protected tree and is never read as guidance. Metadata and retirement commands are allowed; for a deliberate read the operator names the path and the command starts with ${ALLOW_PREFIX}=1.`,
  );
}

function denyGrep(trees, what = 'a recursive grep') {
  return result(
    'deny',
    RULE,
    `checkrein: ${what} from the repository root walks the protected tree ${trees.join(', ')}, which is never read as guidance. Search with rg, which honours the .ignore file, or search a path outside the tree.`,
  );
}

function checkFileTool(ctx) {
  const { tool, toolInput, cwd, root, manifest } = ctx;
  const trees = manifest.protected_trees;
  const targets = [];
  if (tool === 'Grep' || tool === 'Glob') {
    const base = typeof toolInput.path === 'string' && toolInput.path !== '' ? toolInput.path : null;
    if (base) targets.push(base);
    const glob = tool === 'Grep' ? toolInput.glob : toolInput.pattern;
    if (typeof glob === 'string' && glob !== '') {
      for (const alt of expandBraces(glob)) {
        const g = alt.replace(/\\/g, '/');
        const full = base && !/^([a-z]:)?\//i.test(g) ? base.replace(/[\\/]+$/, '') + '/' + g : g;
        const rel = repoRelative(full, cwd, root);
        if (rel === null || rel === '') continue;
        const tree = trees.find((t) => patternReachesTree(rel, t)) || treeFor(full, cwd, root, trees);
        if (tree) return deny(tree);
      }
    }
  } else {
    const target = typeof toolInput.file_path === 'string' ? toolInput.file_path : toolInput.notebook_path;
    if (typeof target === 'string') targets.push(target);
  }
  for (const t of targets) {
    const tree = treeFor(t, cwd, root, trees);
    if (tree) return deny(tree);
  }
  return null;
}

// With ctx.loose (the working directory is unknown after a `cd` to a computed place), any path
// component equal to a tree's first component counts as a mention.
function looseTree(piece, trees) {
  const comps = String(piece).replace(/\\/g, '/').toLowerCase().split('/');
  return trees.find((t) => {
    const first = String(t).replace(/\\/g, '/').replace(/^\.?\/+/, '').split('/')[0].toLowerCase();
    return first !== '' && comps.includes(first);
  }) || null;
}

function hitIn(texts, ctx, globs = false) {
  const trees = ctx.manifest.protected_trees;
  for (const text of texts) {
    for (const piece of pieces(text)) {
      const tree = treeFor(piece, ctx.cwd, ctx.root, trees)
        || (globs ? globTreeFor(piece, ctx.cwd, ctx.root, trees) : null)
        || (ctx.loose ? looseTree(piece, trees) : null);
      if (tree) return tree;
    }
  }
  return null;
}

function segmentHit(seg, ctx) {
  const globs = unquotedGlob(seg.raw);
  return hitIn([...seg.argv, ...seg.rawArgv, ...fileRedirects(seg).map((r) => r.target)], ctx, globs) || hitIn([seg.raw], ctx);
}

// The sources of an mv: every operand but the last, or every operand when -t names the target.
function mvSourceHit(args, ctx) {
  const operands = [];
  let targetGiven = false;
  let endOpts = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!endOpts && a === '--') { endOpts = true; continue; }
    if (!endOpts && a.startsWith('-') && a !== '-') {
      if (a === '-t' || a === '--target-directory') { targetGiven = true; i += 1; continue; }
      if (a.startsWith('--target-directory=') || /^-[^-]*t./.test(a)) targetGiven = true;
      continue;
    }
    operands.push(a);
  }
  const sources = targetGiven ? operands : operands.slice(0, -1);
  return hitIn(sources, ctx);
}

function metadataAllowed(seg, ctx) {
  const argv = seg.argv;
  const word = argv[0];
  if (META.has(word)) return true;
  if (word === 'find') return !argv.some((a) => FIND_ACTIONS.has(a));
  if (word === 'mv') return !mvSourceHit(argv.slice(1), ctx);
  if (word === 'git') {
    const sub = gitSubcommand(argv);
    if (sub.name === 'mv') return !mvSourceHit(argv.slice(sub.index + 1), ctx);
    if (GIT_META.has(sub.name)) return true;
    if (sub.name === 'diff') {
      const rest = argv.slice(sub.index + 1);
      return rest.some((a) => DIFF_STAT.has(a)) && !rest.some((a) => a === '-p' || a === '--patch' || a === '-u');
    }
  }
  return false;
}

function pipeSinkAllowed(seg, ctx) {
  if (!seg.argv.length) return true;
  if (viaXargs(seg)) return metadataAllowed(seg, ctx);
  return metadataAllowed(seg, ctx) || STDIN_FILTERS.has(seg.argv[0]);
}

const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;
const CD_KINDS = new Set(['top', 'seq', 'and', 'subshell', 'substitution', 'wrapper']);
const GROUP_STARTS = new Set(['top', 'subshell', 'substitution', 'wrapper']);
const DYNAMIC = /[$`*?[]|^-$|^~[^/]/;

// The directory a `cd` or `pushd` moves to, null when it cannot be known from the text.
function cdTarget(argv, cwd, root) {
  const ops = argv.slice(1).filter((a) => !/^-[LPe@n]+$/.test(a));
  if (argv[0] === 'pushd' && ops.length === 0) return null;
  const op = ops.length ? ops[0] : '~';
  if (DYNAMIC.test(op) || /^[+-]\d+$/.test(op)) return null;
  return absolutePath(op, cwd, root);
}

// A walk of the whole repository from the root or a folder above a tree that does not honour
// the .ignore file: find with an action, rg told to skip ignore files, git grep with no path.
const RG_VALUE = new Set(['-e', '-f', '-g', '-t', '-T', '-m', '-A', '-B', '-C', '-j', '-M', '-r', '-E', '--regexp', '--file', '--glob', '--iglob', '--type', '--type-not', '--max-count', '--after-context', '--before-context', '--context', '--threads', '--max-columns', '--replace', '--encoding', '--max-depth', '--sort', '--sortr', '--type-add']);
const GIT_GREP_VALUE = new Set(['-e', '-f', '-A', '-B', '-C', '-m', '--max-depth', '--threads', '-O', '--open-files-in-pager', '--max-count', '--context', '--after-context', '--before-context']);

function operandsAfter(argv, from, valueOpts) {
  const out = [];
  let patternGiven = false;
  let end = false;
  for (let i = from; i < argv.length; i++) {
    const a = argv[i];
    if (!end && a === '--') { end = true; continue; }
    if (!end && a.startsWith('-') && a !== '-') {
      const name = a.startsWith('--') ? a.split('=')[0] : a.slice(0, 2);
      if (name === '-e' || name === '-f' || name === '--regexp' || name === '--file') patternGiven = true;
      if (valueOpts.has(a)) i += 1;
      continue;
    }
    out.push({ word: a, afterDashes: end });
  }
  return { out, patternGiven };
}

function walkHit(seg, ctx) {
  const { argv } = seg;
  const trees = ctx.manifest.protected_trees;
  const walks = (paths) => (paths.length ? paths : ['.']).some((p) => walksTree(p, ctx.cwd, ctx.root, trees));
  const word = argv[0];
  if (word === 'find' && argv.some((a) => FIND_ACTIONS.has(a))) {
    const starts = [];
    for (const a of argv.slice(1)) {
      if (a.startsWith('-') || a === '(' || a === '!') break;
      starts.push(a);
    }
    return walks(starts) ? 'a find with an action' : null;
  }
  if (word === 'rg') {
    const unrestricted = argv.reduce((n, a) => n + (/^-u+$/.test(a) ? a.length - 1 : 0), 0);
    const noIgnore = argv.some((a) => a === '--no-ignore' || a === '--no-ignore-dot') || unrestricted >= 2;
    if (!noIgnore) return null;
    const { out, patternGiven } = operandsAfter(argv, 1, RG_VALUE);
    return walks((patternGiven ? out : out.slice(1)).map((o) => o.word)) ? 'an rg that skips the .ignore file' : null;
  }
  if (word === 'git') {
    const sub = gitSubcommand(argv);
    if (sub.name !== 'grep') return null;
    const { out, patternGiven } = operandsAfter(argv, sub.index + 1, GIT_GREP_VALUE);
    const paths = (patternGiven ? out : out.slice(1)).map((o) => o.word);
    if (paths.some((p) => /^:(!|\^|\(exclude\))/.test(p))) return null;
    return walks(paths) ? 'a git grep with no path' : null;
  }
  return null;
}

function checkBash(ctx) {
  const { segs, command, root, manifest } = ctx;
  const trees = manifest.protected_trees;
  if (startsWithAllowPrefix(command, ALLOW_PREFIX)) return null;
  if (hasRecursiveGrepFromRoot(command, root)) return denyGrep(trees);
  const taint = new Array(segs.length).fill(null);
  // The working directory at each depth, carried through `cd` and `pushd`; null when unknown.
  const dirs = [ctx.cwd];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const d = seg.depth;
    if (GROUP_STARTS.has(seg.kind) && d > 0) dirs[d] = dirs[d - 1] === undefined ? ctx.cwd : dirs[d - 1];
    if (dirs[d] === undefined) dirs[d] = ctx.cwd;
    const here = dirs[d];
    const sctx = { ...ctx, cwd: here === null ? ctx.cwd : here, loose: here === null };
    const mention = segmentHit(seg, sctx);
    const up = seg.kind === 'pipe' ? upstreamIndex(segs, i) : -1;
    const upstreamTree = up >= 0 ? taint[up] : null;
    taint[i] = mention || upstreamTree;
    if (seg.argv.length) {
      if (mention && !metadataAllowed(seg, sctx)) return deny(mention);
      const walk = walkHit(seg, sctx);
      if (walk) return denyGrep(trees, walk);
    } else {
      const assigned = hitIn(seg.rawArgv.filter((t) => ASSIGN_RE.test(t)), sctx, unquotedGlob(seg.raw));
      const redirected = assigned || hitIn(fileRedirects(seg).map((r) => r.target), sctx);
      if (redirected) return deny(redirected);
    }
    if (upstreamTree && !pipeSinkAllowed(seg, sctx)) return deny(upstreamTree);
    if ((seg.argv[0] === 'cd' || seg.argv[0] === 'pushd') && CD_KINDS.has(seg.kind)) {
      dirs[d] = here === null ? null : cdTarget(seg.argv, here, root);
    } else if (seg.argv[0] === 'popd' && CD_KINDS.has(seg.kind)) {
      dirs[d] = null;
    }
  }
  return null;
}

export function check(ctx) {
  if (!ctx.manifest.protected_trees.length) return null;
  if (ctx.tool === 'Bash') return checkBash(ctx);
  return checkFileTool(ctx);
}
