// secrets.mjs: the secret-file rule (file tools and Bash, deny).
//
// A secret file is one whose path matches a `secret_globs` entry and no `example_globs` entry.
// File tools: deny any tool with a `file_path` or `notebook_path` on a secret file, and a Grep
// whose `path` is one or whose `glob` could match one (Glob only lists names, so it is allowed).
// Bash: deny a redirection into or out of a secret file whatever the command, and a segment
// that passes a secret file as an argument (a reader, an editor, `source` or `.`, `--env-file=`)
// unless the command word is a metadata command. An unquoted glob that expands onto a secret
// file counts as naming it. A secret name a metadata command prints is followed downstream: a
// pipe into xargs or into a reader that is not a stdin filter is denied, and so is a reader
// holding a substitution that produces the name. `export $(cat <file>)` is caught at the inner
// reader, which the evaluator opens as its own segment.

import {
  result, secretGlobFor, secretGlobForPattern, argPieces, fileRedirects, gitSubcommand, hasGlob, unquotedGlob,
  upstreamIndex, viaXargs, holderIndex,
} from './common.mjs';

export const RULE = 'secrets';

const META = new Set(['ls', 'test', '[', 'stat', 'du', 'wc', 'file', 'mkdir', 'echo', 'printf']);
const GIT_META = new Set(['status', 'log', 'check-ignore', 'ls-files']);
const FIND_ACTIONS = new Set(['-exec', '-execdir', '-delete', '-ok', '-okdir']);

function deny(target, glob, manifest) {
  const examples = manifest.example_globs.length ? manifest.example_globs.join(', ') : 'none configured';
  return result(
    'deny',
    RULE,
    `checkrein: ${target} matches the secret glob ${glob} and is never read or edited by an agent. Read an example file instead (example globs: ${examples}), or ask the operator for the value you need.`,
  );
}

function metadataAllowed(argv) {
  const word = argv[0];
  if (META.has(word)) return true;
  if (word === 'find') return !argv.some((a) => FIND_ACTIONS.has(a));
  if (word === 'git') return GIT_META.has(gitSubcommand(argv).name);
  return false;
}

function checkFileTool(ctx) {
  const { tool, toolInput, cwd, root, manifest } = ctx;
  let target = null;
  if (tool === 'Grep') {
    target = typeof toolInput.path === 'string' ? toolInput.path : null;
    if (typeof toolInput.glob === 'string' && toolInput.glob !== '') {
      const base = target ? target.replace(/[\\/]+$/, '') + '/' : '';
      const g = toolInput.glob.includes('/') ? base + toolInput.glob : toolInput.glob;
      const glob = secretGlobForPattern(g, cwd, root, manifest) || (hasGlob(g) ? null : secretGlobFor(g, cwd, root, manifest));
      if (glob) return deny(toolInput.glob, glob, manifest);
    }
  } else if (tool === 'Glob') return null;
  else target = typeof toolInput.file_path === 'string' ? toolInput.file_path : toolInput.notebook_path;
  if (typeof target !== 'string' || target === '') return null;
  const glob = secretGlobFor(target, cwd, root, manifest);
  return glob ? deny(target, glob, manifest) : null;
}

// The secret file a word names: literally, or as a glob the shell expands onto it.
function secretIn(words, ctx, globs) {
  const { cwd, root, manifest } = ctx;
  for (const word of words) {
    for (const piece of argPieces(word)) {
      const glob = secretGlobFor(piece, cwd, root, manifest) || (globs ? secretGlobForPattern(piece, cwd, root, manifest) : null);
      if (glob) return { piece, glob };
    }
  }
  return null;
}

// Commands that only read the listing a metadata command prints on their stdin.
const STDIN_FILTERS = new Set(['wc', 'sort', 'uniq', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'cut', 'tr', 'column', 'cat', 'less', 'more', 'nl']);

// Bash: a direct argument or redirect target that is a secret file, a secret name printed by a
// metadata command and fed to a reader through a pipe or xargs, and a secret name produced by a
// substitution inside a reader's arguments.
function checkBash(ctx) {
  const { segs, cwd, root, manifest } = ctx;
  const taint = new Array(segs.length).fill(null);
  const held = new Array(segs.length).fill(null);
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const globs = unquotedGlob(seg.raw);
    for (const r of fileRedirects(seg)) {
      const glob = secretGlobFor(r.target, cwd, root, manifest) || (globs ? secretGlobForPattern(r.target, cwd, root, manifest) : null);
      if (glob) return deny(r.target, glob, manifest);
    }
    const mention = seg.argv.length ? secretIn(seg.argv.slice(1), ctx, globs) : null;
    const up = seg.kind === 'pipe' ? upstreamIndex(segs, i) : -1;
    const piped = up >= 0 ? taint[up] : null;
    if (seg.argv.length) {
      const meta = metadataAllowed(seg.argv);
      if (mention && !meta) return deny(mention.piece, mention.glob, manifest);
      if (held[i] && !meta) return deny(held[i].piece, held[i].glob, manifest);
      const sinkAllowed = viaXargs(seg) ? meta : meta || STDIN_FILTERS.has(seg.argv[0]);
      if (piped && !sinkAllowed) return deny(piped.piece, piped.glob, manifest);
    }
    taint[i] = mention || piped || held[i];
    const holder = holderIndex(segs, i);
    if (holder >= 0 && taint[i] && !held[holder]) held[holder] = taint[i];
  }
  return null;
}

export function check(ctx) {
  if (!ctx.manifest.secret_globs.length) return null;
  if (ctx.tool === 'Bash') return checkBash(ctx);
  return checkFileTool(ctx);
}
