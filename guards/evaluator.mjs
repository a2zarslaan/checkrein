// evaluator.mjs: the one shell-command evaluator every checkrein Bash guard reads.
//
// It turns a command string into segments: one per simple command, in evaluation order, with
// quotes resolved, separators split, substitutions and subshells opened, heredoc bodies kept as
// data, redirections separated from arguments, and wrapper commands stripped from command
// position. Guards match on segments, never on raw text, unless a rule says "raw".
//
// Segment = { argv, rawArgv, raw, redirects, kind, depth, index }
//   argv      tokens with quotes resolved; argv[0] is the command word after stripping variable
//             assignments, wrappers and directory prefixes. Empty for a redirection-only command
//             and for the placeholder segment that stands for a parenthesized subshell.
//   rawArgv   the same tokens before stripping.
//   raw       the segment's source text (a heredoc body is not part of it).
//   redirects { op, target }[]; op keeps its file descriptor ('2>', '2>&', '&>', '<<', '<<-', '<<<').
//   kind      how the segment joins the one before it in its group: 'pipe', 'and', 'or', 'seq'.
//             The first segment of a group takes the group's kind: 'top' at the top level,
//             'subshell' inside ( ), 'substitution' inside $( ), backticks and <( ), 'wrapper'
//             inside a string run by sh -c, bash -c, eval, su -c, or a heredoc fed to a shell.
//   depth     nesting level; subshells, substitutions and wrapper strings each add one.
//   index     position in evaluation order: substitutions before the command that holds them,
//             a subshell placeholder before its contents, wrapper segments after their command.
//
// To find the segment a pipe reads from, walk back to the nearest earlier segment of equal depth.
// A guardrail for cooperative agents, not a security boundary: a path assembled from variables
// at run time, or a script written now and run later, is invisible to any lexical reading.
// Zero dependencies, Node 20 or newer. Never throws on any input; an unterminated quote or
// substitution closes at end of input.

import os from 'node:os';
import path from 'node:path';

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const RESERVED = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until']);
const WORD_END = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '<', '>', ')']);
const TARGET_STOP = new Set(['\n', ';', '&', '|', ')', '<', '>']);
const REDIR_RE = /(\d*)(<<<|<<-|<<|<>|<&|<|>>|>&|>\||>)|(&>>|&>)/y;
const FD_RE = /\d+(?=[<>])/y;
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;
const MAX_DEPTH = 32;
const FALLBACK_ROOT = '/checkrein-unknown-root';

// Option shapes of the wrappers: `short` lists letters that take an argument, `long` the long
// options that take one when no `=` is given.
const SUDO = { short: 'ugpChDrtUTR', long: ['user', 'group', 'prompt', 'close-from', 'host', 'chdir', 'role', 'type', 'other-user', 'command-timeout', 'chroot'] };
const EXEC = { short: 'a', long: [] };
const NICE = { short: 'n', long: ['adjustment'], numeric: true };
const TIME = { short: 'fo', long: ['format', 'output'] };
const TIMEOUT = { short: 'sk', long: ['signal', 'kill-after'] };
const XARGS = { short: 'nIPLdEsa', long: ['max-args', 'max-procs', 'max-lines', 'delimiter', 'eof', 'max-chars', 'arg-file'] };
const PLAIN = { short: '', long: [] };

export function normalize(command) {
  const src = typeof command === 'string' ? command : String(command ?? '');
  let out = '';
  let state = 'n';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (state === 's') {
      out += c;
      if (c === "'") state = 'n';
      continue;
    }
    if (state === 'c') {
      out += c;
      if (c === '\n') state = 'n';
      continue;
    }
    if (c === '\\') {
      const n = src[i + 1];
      if (n === '\n') { i += 1; continue; }
      if (n === '\r' && src[i + 2] === '\n') { i += 2; continue; }
      if (n !== undefined) { out += c + n; i += 1; continue; }
      out += c;
      continue;
    }
    if (state === 'd') {
      out += c;
      if (c === '"') state = 'n';
      continue;
    }
    if (c === "'") state = 's';
    else if (c === '"') state = 'd';
    else if (c === '#' && (i === 0 || /[\s;&|()]/.test(src[i - 1]))) state = 'c';
    out += c;
  }
  return out;
}

export function segments(command) {
  try {
    const nodes = parseText(normalize(command), 0, 'top');
    finalize(nodes);
    const out = [];
    flatten(nodes, out);
    out.forEach((seg, i) => { seg.index = i; });
    return out;
  } catch {
    return fallbackSegments(command);
  }
}

export function commandWords(command) {
  return segments(command).filter((s) => s.argv.length > 0).map((s) => s.argv[0]);
}

export function tokens(command) {
  return segments(command).flatMap((s) => s.argv);
}

export function startsWithAllowPrefix(command, name) {
  if (typeof command !== 'string' || typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  return new RegExp('^' + name + '=1[ \\t]+\\S').test(command);
}

export function hasRecursiveGrepFromRoot(command, repoRoot) {
  for (const seg of segments(command)) {
    if (!GREPS.has(seg.argv[0])) continue;
    const targets = recursiveGrepTargets(seg.argv);
    if (targets && targets.some((t) => isRootOrParent(t, repoRoot))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Parser

function makeCtx(src) {
  return { src, pos: 0, pending: [] };
}

function newCmd() {
  return { start: -1, end: -1, words: [], redirects: [], pre: [], group: null, heredocs: [], herestrings: [] };
}

function parseText(text, depth, kind) {
  return parseList(makeCtx(text), depth, kind, false);
}

function skipBlanks(ctx) {
  const s = ctx.src;
  while (ctx.pos < s.length) {
    const c = s[ctx.pos];
    if (c === ' ' || c === '\t' || c === '\r') ctx.pos++;
    else if (c === '\\' && s[ctx.pos + 1] === '\n') ctx.pos += 2;
    else break;
  }
}

function parseList(ctx, depth, groupKind, untilParen) {
  const src = ctx.src;
  const nodes = [];
  let kind = groupKind;
  let cmd = newCmd();
  const finish = (nextKind) => {
    const node = buildNode(ctx, cmd, kind, depth);
    cmd = newCmd();
    if (node) {
      nodes.push(node);
      kind = nextKind;
      return;
    }
    if (nodes.length === 0) return;
    if (nextKind === 'seq' && (kind === 'pipe' || kind === 'and' || kind === 'or')) return;
    kind = nextKind;
  };
  for (;;) {
    skipBlanks(ctx);
    if (ctx.pos >= src.length) {
      finish('seq');
      return nodes;
    }
    const c = src[ctx.pos];
    const n = src[ctx.pos + 1];
    if (c === '#') {
      const nl = src.indexOf('\n', ctx.pos);
      ctx.pos = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === '\n') {
      finish('seq');
      ctx.pos++;
      readHeredocBodies(ctx);
      continue;
    }
    if (c === ')') {
      finish('seq');
      ctx.pos++;
      if (untilParen) return nodes;
      continue;
    }
    if (c === ';') {
      finish('seq');
      if (n === ';') ctx.pos += src[ctx.pos + 2] === '&' ? 3 : 2;
      else if (n === '&') ctx.pos += 2;
      else ctx.pos += 1;
      continue;
    }
    if (c === '&') {
      if (n === '&') { finish('and'); ctx.pos += 2; continue; }
      if (n !== '>') { finish('seq'); ctx.pos += 1; continue; }
    }
    if (c === '|') {
      if (n === '|') { finish('or'); ctx.pos += 2; continue; }
      finish('pipe');
      ctx.pos += n === '&' ? 2 : 1;
      continue;
    }
    if (c === '(' && cmd.words.length === 0 && !cmd.group) {
      const start = ctx.pos;
      if (cmd.start < 0) cmd.start = start;
      if (n === '(') {
        const end = arithEnd(src, start + 2);
        if (end >= 0) {
          cmd.pre.push(...scanExpansions(src.slice(start + 2, end - 2), depth));
          const text = src.slice(start, end);
          cmd.words.push({ value: text, raw: text, quoted: false, start });
          ctx.pos = end;
          cmd.end = end;
          continue;
        }
      }
      ctx.pos++;
      cmd.group = parseList(ctx, depth + 1, 'subshell', true);
      cmd.end = ctx.pos;
      continue;
    }
    if ((c === '<' || c === '>') && n === '(') {
      const start = ctx.pos;
      if (cmd.start < 0) cmd.start = start;
      ctx.pos += 2;
      cmd.pre.push(...parseList(ctx, depth + 1, 'substitution', true));
      const text = src.slice(start, ctx.pos);
      cmd.words.push({ value: text, raw: text, quoted: false, start });
      cmd.end = ctx.pos;
      continue;
    }
    if (c === '<' || c === '>' || c === '&' || (c >= '0' && c <= '9' && matchesAt(FD_RE, src, ctx.pos))) {
      if (readRedirect(ctx, depth, cmd)) continue;
    }
    const word = readWord(ctx, depth, cmd);
    if (cmd.start < 0) cmd.start = word.start;
    cmd.words.push(word);
    cmd.end = ctx.pos;
  }
}

function matchesAt(re, src, pos) {
  re.lastIndex = pos;
  return re.test(src);
}

function readRedirect(ctx, depth, cmd) {
  REDIR_RE.lastIndex = ctx.pos;
  const m = REDIR_RE.exec(ctx.src);
  if (!m) return false;
  if (cmd.start < 0) cmd.start = ctx.pos;
  const op = m[0];
  ctx.pos += op.length;
  skipBlanks(ctx);
  let target = '';
  let quoted = false;
  if (ctx.pos < ctx.src.length && !TARGET_STOP.has(ctx.src[ctx.pos])) {
    const word = readWord(ctx, depth, cmd);
    target = word.value;
    quoted = word.quoted;
  }
  const base = op.replace(/^\d+/, '');
  if (base === '<<' || base === '<<-') {
    const heredoc = { delim: target, stripTabs: base === '<<-', quoted, body: null };
    ctx.pending.push(heredoc);
    cmd.heredocs.push(heredoc);
  } else if (base === '<<<') {
    cmd.herestrings.push(target);
  }
  cmd.redirects.push({ op, target });
  cmd.end = ctx.pos;
  return true;
}

function readHeredocBodies(ctx) {
  if (!ctx.pending.length) return;
  const src = ctx.src;
  for (const heredoc of ctx.pending) {
    const lines = [];
    while (ctx.pos < src.length) {
      const nl = src.indexOf('\n', ctx.pos);
      const end = nl < 0 ? src.length : nl;
      let line = src.slice(ctx.pos, end);
      ctx.pos = nl < 0 ? src.length : nl + 1;
      if (heredoc.stripTabs) line = line.replace(/^\t+/, '');
      if (line.replace(/\r$/, '') === heredoc.delim) break;
      lines.push(line);
    }
    heredoc.body = lines.join('\n');
  }
  ctx.pending = [];
}

function readWord(ctx, depth, cmd) {
  const src = ctx.src;
  const start = ctx.pos;
  let value = '';
  let quoted = false;
  while (ctx.pos < src.length) {
    const c = src[ctx.pos];
    if (WORD_END.has(c)) break;
    if (c === '\\') {
      const n = src[ctx.pos + 1];
      if (n === undefined) { value += c; ctx.pos += 1; continue; }
      ctx.pos += 2;
      if (n !== '\n') { value += n; quoted = true; }
      continue;
    }
    if (c === "'") {
      quoted = true;
      const end = src.indexOf("'", ctx.pos + 1);
      value += src.slice(ctx.pos + 1, end < 0 ? src.length : end);
      ctx.pos = end < 0 ? src.length : end + 1;
      continue;
    }
    if (c === '"') {
      quoted = true;
      ctx.pos += 1;
      value += readDoubleBody(ctx, depth, cmd, true);
      continue;
    }
    if (c === '`') {
      value += readBacktick(ctx, depth, cmd);
      continue;
    }
    if (c === '$') {
      const n = src[ctx.pos + 1];
      if (n === "'") { quoted = true; value += readAnsiC(ctx); continue; }
      if (n === '"') { ctx.pos += 1; continue; }
      if (n === '(' || n === '{') { value += readDollar(ctx, depth, cmd); continue; }
      value += c;
      ctx.pos += 1;
      continue;
    }
    if (c === '(' && !quoted && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(value)) {
      const end = parenEnd(src, ctx.pos + 1);
      cmd.pre.push(...scanExpansions(src.slice(ctx.pos + 1, end), depth));
      value += src.slice(ctx.pos, end);
      ctx.pos = end;
      continue;
    }
    value += c;
    ctx.pos += 1;
  }
  if (ctx.pos === start && ctx.pos < src.length) {
    value += src[ctx.pos];
    ctx.pos += 1;
  }
  return { value, raw: src.slice(start, ctx.pos), quoted, start };
}

// Reads the inside of a double-quoted string (inQuotes) or an unquoted heredoc body (not inQuotes).
function readDoubleBody(ctx, depth, cmd, inQuotes) {
  const src = ctx.src;
  let value = '';
  while (ctx.pos < src.length) {
    const c = src[ctx.pos];
    if (inQuotes && c === '"') {
      ctx.pos += 1;
      return value;
    }
    if (c === '\\') {
      const n = src[ctx.pos + 1];
      if (n === undefined) { value += c; ctx.pos += 1; continue; }
      if (n === '\n') { ctx.pos += 2; continue; }
      if (n === '$' || n === '`' || n === '\\' || (inQuotes && n === '"')) { value += n; ctx.pos += 2; continue; }
      value += c + n;
      ctx.pos += 2;
      continue;
    }
    if (c === '`') {
      value += readBacktick(ctx, depth, cmd);
      continue;
    }
    if (c === '$' && (src[ctx.pos + 1] === '(' || src[ctx.pos + 1] === '{')) {
      value += readDollar(ctx, depth, cmd);
      continue;
    }
    value += c;
    ctx.pos += 1;
  }
  return value;
}

function readDollar(ctx, depth, cmd) {
  const src = ctx.src;
  const start = ctx.pos;
  if (src[start + 1] === '{') {
    const end = braceEnd(src, start + 2);
    cmd.pre.push(...scanExpansions(src.slice(start + 2, Math.max(start + 2, end - 1)), depth));
    ctx.pos = end;
    return src.slice(start, end);
  }
  if (src[start + 2] === '(') {
    const end = arithEnd(src, start + 3);
    if (end >= 0) {
      cmd.pre.push(...scanExpansions(src.slice(start + 3, end - 2), depth));
      ctx.pos = end;
      return src.slice(start, end);
    }
  }
  ctx.pos = start + 2;
  cmd.pre.push(...parseList(ctx, depth + 1, 'substitution', true));
  return src.slice(start, ctx.pos);
}

function readBacktick(ctx, depth, cmd) {
  const src = ctx.src;
  const start = ctx.pos;
  let i = start + 1;
  let inner = '';
  while (i < src.length && src[i] !== '`') {
    if (src[i] === '\\' && i + 1 < src.length) {
      const n = src[i + 1];
      inner += n === '`' || n === '$' || n === '\\' ? n : '\\' + n;
      i += 2;
      continue;
    }
    inner += src[i];
    i += 1;
  }
  ctx.pos = i < src.length ? i + 1 : src.length;
  cmd.pre.push(...parseText(normalize(inner), depth + 1, 'substitution'));
  return src.slice(start, ctx.pos);
}

const ANSI_SIMPLE = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

function readAnsiC(ctx) {
  const src = ctx.src;
  let i = ctx.pos + 2;
  let out = '';
  while (i < src.length && src[i] !== "'") {
    if (src[i] === '\\' && i + 1 < src.length) {
      const n = src[i + 1];
      if (Object.prototype.hasOwnProperty.call(ANSI_SIMPLE, n)) { out += ANSI_SIMPLE[n]; i += 2; continue; }
      if (n === 'x') {
        const m = /^[0-9a-fA-F]{1,2}/.exec(src.slice(i + 2, i + 4));
        if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += 2 + m[0].length; continue; }
      }
      if (n === 'u' || n === 'U') {
        const len = n === 'u' ? 4 : 8;
        const m = new RegExp('^[0-9a-fA-F]{1,' + len + '}').exec(src.slice(i + 2, i + 2 + len));
        const cp = m ? parseInt(m[0], 16) : -1;
        if (m && cp <= 0x10ffff) { out += String.fromCodePoint(cp); i += 2 + m[0].length; continue; }
      }
      if (n >= '0' && n <= '7') {
        const m = /^[0-7]{1,3}/.exec(src.slice(i + 1, i + 4));
        out += String.fromCharCode(parseInt(m[0], 8) & 0xff);
        i += 1 + m[0].length;
        continue;
      }
      out += '\\' + n;
      i += 2;
      continue;
    }
    out += src[i];
    i += 1;
  }
  ctx.pos = i < src.length ? i + 1 : src.length;
  return out;
}

// Index just after the `))` closing an arithmetic form whose content starts at `from`, or -1.
function arithEnd(src, from) {
  let d = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '(') d++;
    else if (c === ')') {
      if (d > 0) d--;
      else return src[i + 1] === ')' ? i + 2 : -1;
    }
  }
  return -1;
}

function braceEnd(src, from) {
  let d = 1;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}' && --d === 0) return i + 1;
  }
  return src.length;
}

function parenEnd(src, from) {
  let d = 1;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '(') d++;
    else if (src[i] === ')' && --d === 0) return i + 1;
  }
  return src.length;
}

function scanExpansions(text, depth) {
  if (!text || (text.indexOf('$') < 0 && text.indexOf('`') < 0)) return [];
  const holder = newCmd();
  readDoubleBody(makeCtx(text), depth, holder, false);
  return holder.pre;
}

function buildNode(ctx, cmd, kind, depth) {
  if (!cmd.words.length && !cmd.redirects.length && !cmd.group) return null;
  const rawArgv = cmd.words.map((w) => w.value);
  const argv = cmd.group ? [] : stripCommand(cmd.words);
  const raw = cmd.start >= 0 ? ctx.src.slice(cmd.start, cmd.end).trim() : '';
  const seg = { argv, rawArgv, raw, redirects: cmd.redirects, kind, depth, index: 0 };
  const node = { seg, pre: cmd.pre, inner: cmd.group || [], after: [], heredocs: cmd.heredocs, herestrings: cmd.herestrings, done: false };
  const inner = wrapperString(argv);
  if (inner !== null && depth < MAX_DEPTH) node.after.push(...parseText(normalize(inner), depth + 1, 'wrapper'));
  return node;
}

// Heredoc bodies are read after the command line ends, so their expansions and the shell-stdin
// case are resolved once the whole command has been parsed.
function finalize(nodes) {
  for (const node of nodes) {
    if (!node.done) {
      node.done = true;
      const depth = node.seg.depth;
      for (const heredoc of node.heredocs) {
        if (!heredoc.quoted) node.pre.push(...scanExpansions(heredoc.body ?? '', depth));
      }
      if (depth < MAX_DEPTH && shellReadsStdin(node.seg.argv)) {
        for (const heredoc of node.heredocs) node.after.push(...parseText(normalize(heredoc.body ?? ''), depth + 1, 'wrapper'));
        for (const text of node.herestrings) node.after.push(...parseText(normalize(text), depth + 1, 'wrapper'));
      }
    }
    finalize(node.pre);
    finalize(node.inner);
    finalize(node.after);
  }
}

function flatten(nodes, out) {
  for (const node of nodes) {
    flatten(node.pre, out);
    out.push(node.seg);
    flatten(node.inner, out);
    flatten(node.after, out);
  }
}

// Input the parser cannot finish (nesting deep enough to exhaust the stack) errs toward deny:
// every word becomes the command word of its own segment.
function fallbackSegments(command) {
  const src = typeof command === 'string' ? command : '';
  const words = src.split(/[\s;&|()`<>'"{}$]+/).filter(Boolean);
  return words.map((w, i) => ({ argv: [baseName(w)], rawArgv: [w], raw: w, redirects: [], kind: i === 0 ? 'top' : 'seq', depth: 0, index: i }));
}

// ---------------------------------------------------------------------------------------------
// Command position: assignments, reserved words, wrappers, directory prefixes

function baseName(word) {
  const b = word.replace(/^.*[\/\\]/, '').replace(/\.exe$/i, '');
  return b || word;
}

function skipOptions(list, i, spec) {
  while (i < list.length) {
    const a = list[i].value;
    if (a === '--') return i + 1;
    if (!a.startsWith('-') || a === '-') return i;
    if (spec.numeric && /^--?\d+$/.test(a)) { i += 1; continue; }
    if (a.startsWith('--')) {
      const name = a.slice(2).split('=')[0];
      i += 1;
      if (!a.includes('=') && spec.long.includes(name)) i += 1;
      continue;
    }
    i += 1;
    for (let k = 1; k < a.length; k++) {
      if (spec.short.includes(a[k])) {
        if (k === a.length - 1) i += 1;
        break;
      }
    }
  }
  return i;
}

function stripEnv(list, i) {
  while (i < list.length) {
    const a = list[i].value;
    if (a === '--') return { list, i: i + 1 };
    if (a === '-' || a === '-i' || a === '-0' || a === '-v' || a === '--ignore-environment' || a === '--null' || a === '--debug') { i += 1; continue; }
    let split = null;
    if (a === '-S' || a === '--split-string') split = list[i + 1] ? list[i + 1].value : '';
    else if (a.startsWith('--split-string=')) split = a.slice('--split-string='.length);
    else if (/^-[iv0]*S./.test(a)) split = a.slice(a.indexOf('S') + 1);
    if (split !== null) {
      const consumed = a === '-S' || a === '--split-string' ? 2 : 1;
      const words = splitWords(split);
      return { list: list.slice(0, i).concat(words, list.slice(i + consumed)), i };
    }
    if (a === '-u' || a === '-C' || a === '-P' || a === '--unset' || a === '--chdir') { i += 2; continue; }
    if (/^-[uCP]./.test(a) || a.startsWith('--unset=') || a.startsWith('--chdir=')) { i += 1; continue; }
    if (a.startsWith('-') && a.length > 1) { i += 1; continue; }
    if (ASSIGN_RE.test(a)) { i += 1; continue; }
    return { list, i };
  }
  return { list, i };
}

function splitWords(text) {
  const nodes = parseText(normalize(text), 0, 'top');
  const first = nodes.find((n) => n.seg.rawArgv.length > 0);
  return first ? first.seg.rawArgv.map((v) => ({ value: v, raw: v, quoted: true })) : [];
}

function commandLookupOnly(list, i) {
  for (; i < list.length; i++) {
    const a = list[i].value;
    if (a === '--' || !a.startsWith('-') || a === '-') return false;
    if (/^-[a-zA-Z]*[vV]/.test(a)) return true;
  }
  return false;
}

function stripCommand(words) {
  let list = words.slice();
  let i = 0;
  for (let guard = 0; i < list.length && guard < 64; guard++) {
    const item = list[i];
    if (ASSIGN_RE.test(item.raw)) { i += 1; continue; }
    if (RESERVED.has(item.value) && !item.quoted) { i += 1; continue; }
    const base = baseName(item.value);
    let next = -1;
    if (base === 'sudo') next = skipOptions(list, i + 1, SUDO);
    else if (base === 'env') {
      const r = stripEnv(list, i + 1);
      list = r.list;
      next = r.i;
    } else if (base === 'exec') next = skipOptions(list, i + 1, EXEC);
    else if (base === 'nice') next = skipOptions(list, i + 1, NICE);
    else if (base === 'nohup') next = skipOptions(list, i + 1, PLAIN);
    else if (base === 'time') next = skipOptions(list, i + 1, TIME);
    else if (base === 'command' || base === 'builtin') next = commandLookupOnly(list, i + 1) ? -1 : skipOptions(list, i + 1, PLAIN);
    else if (base === 'timeout') {
      const d = skipOptions(list, i + 1, TIMEOUT);
      next = d < list.length ? d + 1 : -1;
    } else if (base === 'xargs') next = skipOptions(list, i + 1, XARGS);
    if (next < 0 || next >= list.length) break;
    i = next;
  }
  const argv = list.slice(i).map((x) => x.value);
  if (argv.length) argv[0] = baseName(argv[0]);
  return argv;
}

function shellArgs(argv) {
  let hasC = false;
  let hasS = false;
  let j = 1;
  for (; j < argv.length; j++) {
    const a = argv[j];
    if (a === '--' || a === '-') { j += 1; break; }
    if (a.startsWith('--')) {
      if (a === '--rcfile' || a === '--init-file') j += 1;
      continue;
    }
    if ((a[0] === '-' || a[0] === '+') && a.length > 1) {
      const letters = a.slice(1);
      if (a[0] === '-' && letters.includes('c')) hasC = true;
      if (a[0] === '-' && letters.includes('s')) hasS = true;
      if (letters.includes('o') || letters.includes('O')) j += 1;
      continue;
    }
    break;
  }
  return { hasC, hasS, operand: argv[j] };
}

function wrapperString(argv) {
  if (!argv.length) return null;
  const w = argv[0];
  if (SHELLS.has(w)) {
    const p = shellArgs(argv);
    return p.hasC && p.operand !== undefined ? p.operand : null;
  }
  if (w === 'eval') return argv.length > 1 ? argv.slice(1).join(' ') : null;
  if (w === 'su') {
    for (let j = 1; j < argv.length; j++) {
      if ((argv[j] === '-c' || argv[j] === '--command') && j + 1 < argv.length) return argv[j + 1];
      if (argv[j].startsWith('--command=')) return argv[j].slice('--command='.length);
    }
  }
  return null;
}

function shellReadsStdin(argv) {
  if (!argv.length || !SHELLS.has(argv[0])) return false;
  const p = shellArgs(argv);
  return !p.hasC && (p.hasS || p.operand === undefined);
}

// ---------------------------------------------------------------------------------------------
// Recursive grep from the repository root

const GREPS = new Set(['grep', 'egrep', 'fgrep', 'ggrep']);
const GREP_SHORT_ARG = 'efmABCdD';
const GREP_LONG_ARG = new Set(['regexp', 'file', 'max-count', 'after-context', 'before-context', 'context', 'directories', 'devices', 'include', 'exclude', 'exclude-dir', 'exclude-from', 'label', 'binary-files', 'group-separator']);

function recursiveGrepTargets(argv) {
  let recursive = false;
  let patternGiven = false;
  let endOpts = false;
  const operands = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (endOpts || a === '-' || !a.startsWith('-')) { operands.push(a); continue; }
    if (a === '--') { endOpts = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
      let val = eq < 0 ? undefined : a.slice(eq + 1);
      if (name.length >= 3 && ('recursive'.startsWith(name) || 'dereference-recursive'.startsWith(name))) recursive = true;
      if (val === undefined && GREP_LONG_ARG.has(name)) { i += 1; val = argv[i]; }
      if (name === 'regexp' || name === 'file') patternGiven = true;
      if (name === 'directories' && val === 'recurse') recursive = true;
      continue;
    }
    for (let k = 1; k < a.length; k++) {
      const ch = a[k];
      if (ch === 'r' || ch === 'R') { recursive = true; continue; }
      if (GREP_SHORT_ARG.includes(ch)) {
        let val;
        if (k < a.length - 1) val = a.slice(k + 1);
        else { i += 1; val = argv[i]; }
        if (ch === 'e' || ch === 'f') patternGiven = true;
        if (ch === 'd' && val === 'recurse') recursive = true;
        break;
      }
    }
  }
  if (!recursive) return null;
  const targets = patternGiven ? operands : operands.slice(1);
  return targets.length ? targets : ['.'];
}

function cleanPath(p) {
  let s = path.posix.normalize(String(p).replace(/\\/g, '/'));
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

// Spellings of the working directory or the repository root, read like the root itself.
const ROOT_SPELLING = new RegExp(
  '^(?:\\$\\{?PWD\\}?|\\$\\{?CLAUDE_PROJECT_DIR\\}?|\\$\\(\\s*pwd\\s*\\)|`\\s*pwd\\s*`|' +
    '\\$\\(\\s*git\\s+rev-parse\\s+--show-toplevel\\s*\\)|`\\s*git\\s+rev-parse\\s+--show-toplevel\\s*`|~\\+)(?=/|$)',
);

function isRootOrParent(target, repoRoot) {
  const root = cleanPath(repoRoot || FALLBACK_ROOT);
  const home = cleanPath(os.homedir());
  let t = String(target).replace(/\\/g, '/');
  t = t
    .replace(ROOT_SPELLING, root)
    .replace(/^\$\{?HOME\}?(?=\/|$)/, home)
    .replace(/^~(?=\/|$)/, home);
  const parts = t.split('/');
  const g = parts.findIndex((p) => /[*?[]/.test(p));
  if (g >= 0) {
    t = parts.slice(0, g).join('/');
    if (t === '') t = parts[0] === '' && g > 0 ? '/' : '.';
  }
  if (t === '') return false;
  const absolute = t.startsWith('/') || /^[a-z]:\//i.test(t);
  const resolved = cleanPath(absolute ? t : path.posix.join(root, t)).toLowerCase();
  const r = root.toLowerCase();
  if (resolved === r || resolved === '/' || resolved === '.') return true;
  return r.startsWith(resolved.endsWith('/') ? resolved : resolved + '/');
}
