// production.mjs: the production-access rule (Bash only, deny).
//
// Denies an SSH-family client in command position (after wrapper and directory stripping, and
// also behind a runner, after find's -exec, located by a substitution in command position, or
// in echo or printf text piped into a shell), a remote shell scheme in any token, and any
// production marker from the manifest found in a token or in the raw command text: a host (the
// name or a subdomain of it, any case), a login, a port written as `:<port>`, `-p <port>` or
// `--port <port>`, or a database URL pattern.

import { normalize, segments } from '../evaluator.mjs';
import { result, fileRedirects, escapeRegExp, baseName, upstreamIndex, holderIndex } from './common.mjs';

export const RULE = 'production';

const CLIENTS = new Set(['ssh', 'scp', 'sftp', 'rsync', 'autossh', 'sshpass', 'mosh', 'ssh-copy-id', 'telnet']);
const SCHEME = /^(ssh|scp|sftp):\/\//i;
const NAME_CHAR = 'A-Za-z0-9_\\-';

function deny(what) {
  return result(
    'deny',
    RULE,
    `checkrein: agents never open a connection to production (${what}). Diagnose on a local copy; when a production-side action is needed, hand the operator one single-line command and stop.`,
  );
}

// The host itself or any subdomain of it (`db.example.internal`), never a longer name that only
// ends with the same text (`notexample.internal`).
function hostPattern(host) {
  return new RegExp(`(?:^|[^${NAME_CHAR}])${escapeRegExp(host)}(?![${NAME_CHAR}]|\\.[${NAME_CHAR}])`, 'i');
}

function loginPattern(login) {
  const tail = login.endsWith('@') ? '' : `(?![${NAME_CHAR}]|\\.[${NAME_CHAR}])`;
  return new RegExp(`(?:^|[^${NAME_CHAR}.])${escapeRegExp(login)}${tail}`, 'i');
}

function portPattern(port) {
  const p = escapeRegExp(String(port));
  return new RegExp(`(?::|(?:^|\\s)-[pP]\\s*|(?:^|\\s)--port(?:=|\\s+))${p}(?!\\d)`);
}

function portInArgv(argv, port) {
  const p = String(port);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '-p' || a === '-P' || a === '--port') && argv[i + 1] === p) return true;
    if (a === `-p${p}` || a === `-P${p}` || a === `--port=${p}`) return true;
  }
  return false;
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
// Runners that take a command later in their arguments; the evaluator does not strip these.
const RUNNERS = new Set(['doas', 'caffeinate', 'watch', 'stdbuf', 'unbuffer', 'chrt', 'ionice', 'taskset', 'flock']);
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const LOCATORS = [['which'], ['command', '-v'], ['command', '-V'], ['type', '-p'], ['type', '-P'], ['type'], ['whence'], ['where']];

function isClient(word) {
  return typeof word === 'string' && CLIENTS.has(baseName(word).toLowerCase());
}

function shellReadsStdin(argv) {
  if (!argv.length || !SHELLS.has(argv[0])) return false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || /^-[a-z]*c[a-z]*$/i.test(a)) return false;
    if (a === '-s' || /^-[a-z]*s[a-z]*$/i.test(a)) return true;
    if (!a.startsWith('-')) return false;
  }
  return true;
}

// The text an echo or printf with literal arguments writes, read as a command.
function printedText(argv) {
  if (argv[0] === 'echo') return [argv.slice(1).filter((a) => !/^-[neE]+$/.test(a)).join(' ')];
  if (argv[0] === 'printf') return [argv.slice(1).join(' '), ...argv.slice(2)];
  return [];
}

// A client reached some way the command word does not show: a runner, find's -exec, or a
// substitution that locates the client and stands in command position.
function hiddenClient(segs, i) {
  const seg = segs[i];
  const { argv } = seg;
  if (RUNNERS.has(argv[0])) {
    const hit = argv.slice(1).find(isClient);
    if (hit) return `${baseName(hit)} run by ${argv[0]}`;
  }
  if (argv[0] === 'find') {
    for (let k = 1; k < argv.length - 1; k++) {
      if (FIND_EXEC.has(argv[k]) && isClient(argv[k + 1])) return `${baseName(argv[k + 1])} run by find ${argv[k]}`;
    }
  }
  const holder = holderIndex(segs, i);
  if (holder >= 0 && /^(\$\(|`)/.test(segs[holder].argv[0] || '')) {
    for (const loc of LOCATORS) {
      if (loc.every((t, k) => argv[k] === t) && argv.slice(loc.length).some(isClient)) {
        return `${baseName(argv.slice(loc.length).find(isClient))} located by ${loc.join(' ')} in command position`;
      }
    }
  }
  return null;
}

export function check(ctx) {
  if (ctx.tool !== 'Bash') return null;
  const { manifest } = ctx;
  const segs = [...ctx.segs];
  const piped = [];
  for (let i = 0; i < ctx.segs.length; i++) {
    const seg = ctx.segs[i];
    if (seg.kind !== 'pipe' || !shellReadsStdin(seg.argv)) continue;
    const up = upstreamIndex(ctx.segs, i);
    if (up < 0) continue;
    for (const text of printedText(ctx.segs[up].argv)) {
      piped.push(text);
      segs.push(...segments(text));
    }
  }
  for (let i = 0; i < segs.length; i++) {
    const word = segs[i].argv[0];
    if (word && CLIENTS.has(word.toLowerCase())) return deny(`${word} in command position`);
    const hidden = word ? hiddenClient(segs, i) : null;
    if (hidden) return deny(hidden);
  }
  const words = [];
  for (const seg of segs) {
    words.push(...seg.argv, ...seg.rawArgv);
    for (const r of fileRedirects(seg)) words.push(r.target);
  }
  for (const w of words) {
    const m = SCHEME.exec(w);
    if (m) return deny(`the ${m[1].toLowerCase()}:// remote scheme`);
  }
  const texts = [ctx.command, normalize(ctx.command), ...piped, ...words];
  const markers = manifest.production_markers;
  for (const host of markers.hosts) {
    if (!host) continue;
    const re = hostPattern(host);
    if (texts.some((t) => re.test(t))) return deny(`the production host ${host}`);
  }
  for (const login of markers.logins) {
    if (!login) continue;
    const re = loginPattern(login);
    if (texts.some((t) => re.test(t))) return deny(`the production login ${login}`);
  }
  for (const port of markers.ports) {
    const re = portPattern(port);
    if (texts.some((t) => re.test(t)) || segs.some((s) => portInArgv(s.argv, port))) {
      return deny(`the production port ${port}`);
    }
  }
  for (const source of markers.database_url_patterns) {
    if (!source) continue;
    const re = new RegExp(source, 'i');
    if (texts.some((t) => re.test(t))) return deny(`a production database URL matching ${source}`);
  }
  return null;
}
