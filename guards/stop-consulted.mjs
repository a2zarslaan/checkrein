// stop-consulted.mjs: the consulted-evidence guard, run when a turn ends (the Stop hook event).
//
// When the turn edited a file that matches consulted.code_globs, the session transcript must show
// that every required file was read at some point in the session: the corrections log at
// paths.corrections_log plus each consulted.required_reads entry. Evidence is a Read call on the
// file, a Grep whose path names it, or a Bash command that names it next to a reader word.
// Missing evidence blocks the end of the turn once (or warns, when consulted.mode is "warn").
// stop_hook_active marks the continuation a block caused, so the second stop always passes.
//
// Silent cases: no manifest or a version 1 manifest (whatever the input), stop_hook_active true,
// and a transcript that is missing, unreadable, empty, or whose newest assistant text is not the
// input's last_assistant_message (the harness writes it asynchronously, and a lagging transcript
// must never produce a false block). A manifest that cannot be loaded, or an internal error,
// blocks with the error text (fail closed); stop_hook_active still lets the next stop pass.
// Blind spot: edits made through Bash are not seen as edits; reads made through Bash are seen.
// Zero dependencies, Node 20 or newer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, matchesGlob, relativeToRoot } from './manifest.mjs';

export const EDIT_TOOLS = Object.freeze(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export const READER_WORDS = Object.freeze(['cat', 'sed', 'head', 'tail', 'grep', 'rg', 'awk', 'less']);

const MAX_LISTED = 5;

export function parseTranscript(text) {
  const entries = [];
  if (typeof text !== 'string') return entries;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const value = JSON.parse(line);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) entries.push(value);
    } catch {
      // A partly written or foreign line is skipped, never fatal.
    }
  }
  return entries;
}

function blocksOf(entry) {
  const content = entry && entry.message ? entry.message.content : undefined;
  return Array.isArray(content) ? content.filter((b) => b && typeof b === 'object') : [];
}

// Injected user entries (isMeta, or an origin.kind other than "human") are not a human turn.
export function isRealUserMessage(entry) {
  if (!entry || entry.type !== 'user' || entry.isSidechain === true || entry.isMeta === true) return false;
  const kind = entry.origin && typeof entry.origin === 'object' ? entry.origin.kind : undefined;
  if (kind !== undefined && kind !== 'human') return false;
  const content = entry.message ? entry.message.content : undefined;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return !content.some((b) => b && b.type === 'tool_result');
  return false;
}

function toolUses(entries) {
  const out = [];
  for (const entry of entries) {
    if (!entry || entry.type !== 'assistant' || entry.isSidechain === true) continue;
    for (const block of blocksOf(entry)) {
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        out.push({ name: block.name, input: block.input && typeof block.input === 'object' ? block.input : {} });
      }
    }
  }
  return out;
}

function cleanPath(p) {
  let s = String(p).replace(/\\/g, '/').trim();
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  return s;
}

function requiredFiles(manifest) {
  const list = [manifest.paths.corrections_log, ...manifest.consulted.required_reads];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const p = cleanPath(item);
    if (p === '' || seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    out.push(p);
  }
  return out;
}

// True when candidate (a path from a tool call) is the required file: equal to it, or ending in
// "/<file>". Case-insensitive, slashes normalized.
function pathNames(candidate, file) {
  if (typeof candidate !== 'string' || candidate === '') return false;
  const c = candidate.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const f = file.toLowerCase();
  const bare = c.startsWith('./') ? c.slice(2) : c;
  return bare === f || c.endsWith('/' + f);
}

function hasReaderWord(command) {
  const words = command.split(/[\s;|&()`'"<>{}]+/);
  return words.some((w) => {
    const base = w.slice(w.lastIndexOf('/') + 1).toLowerCase();
    return READER_WORDS.includes(base);
  });
}

function hasEvidence(uses, file) {
  const lower = file.toLowerCase();
  for (const { name, input } of uses) {
    if (name === 'Read' && pathNames(input.file_path, file)) return true;
    if (name === 'Grep' && pathNames(input.path, file)) return true;
    if (name === 'Bash' && typeof input.command === 'string') {
      const cmd = input.command.replace(/\\/g, '/');
      if (cmd.toLowerCase().includes(lower) && hasReaderWord(cmd)) return true;
    }
  }
  return false;
}

// entries: parsed transcript lines. Returns { edited, missing }: edited lists the repository
// relative paths edited since the last real user message that match consulted.code_globs;
// missing lists the required files with no read evidence anywhere in the transcript (always
// empty when edited is empty).
export function evaluateTranscript(entries, manifest, projectRoot) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && e.isSidechain !== true) : [];
  let start = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (isRealUserMessage(list[i])) {
      start = i + 1;
      break;
    }
  }
  const edited = [];
  const seen = new Set();
  for (const { name, input } of toolUses(list.slice(start))) {
    if (!EDIT_TOOLS.includes(name)) continue;
    const target = typeof input.file_path === 'string' ? input.file_path : input.notebook_path;
    if (typeof target !== 'string' || target === '') continue;
    const rel = relativeToRoot(target, projectRoot);
    if (rel === null || rel === '') continue;
    if (!matchesGlob(rel, manifest.consulted.code_globs)) continue;
    if (seen.has(rel.toLowerCase())) continue;
    seen.add(rel.toLowerCase());
    edited.push(rel);
  }
  if (edited.length === 0) return { edited, missing: [] };
  const uses = toolUses(list);
  const missing = requiredFiles(manifest).filter((file) => !hasEvidence(uses, file));
  return { edited, missing };
}

function listed(items) {
  const head = items.slice(0, MAX_LISTED).join(', ');
  return items.length > MAX_LISTED ? `${head} and ${items.length - MAX_LISTED} more` : head;
}

export function stopMessage(result, mode) {
  const files = listed(result.missing);
  const edits = listed(result.edited);
  const them = result.missing.length === 1 ? 'it' : 'them';
  if (mode === 'warn') {
    return {
      systemMessage: `checkrein: this turn edited code (${edits}) but the session shows no read of ${files}. Read ${them} and re-check the work against ${them}.`,
    };
  }
  return {
    decision: 'block',
    reason: `checkrein: this turn edited code (${edits}) but the session shows no read of ${files}. Read ${files} now, re-check the work against ${them}, then finish.`,
  };
}

function errorText(err) {
  const msg = err && err.message ? err.message : String(err);
  return msg.replace(/^checkrein: /, '');
}

function failClosed(message) {
  return {
    decision: 'block',
    reason: `checkrein: the consulted-evidence guard could not run (${String(message).replace(/^checkrein: /, '')}). Tell the operator this error, then finish.`,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOf(entry) {
  return blocksOf(entry)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
}

// True when the input's last_assistant_message is not yet the newest main-chain assistant text
// in the file, so the file is behind this turn.
function transcriptLags(entries, lastMessage) {
  if (typeof lastMessage !== 'string' || lastMessage.trim() === '') return false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || e.type !== 'assistant' || e.isSidechain === true) continue;
    const text = textOf(e);
    if (text !== '') return text !== lastMessage.trim();
  }
  return true;
}

function readTranscript(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return null;
  try {
    const text = fs.readFileSync(transcriptPath, 'utf8');
    return text.trim() === '' ? null : text;
  } catch {
    return null;
  }
}

// input: the parsed Stop hook input; parseError: set when stdin was not valid JSON. The manifest
// is loaded first, so an inactive repository prints nothing whatever the input. Returns the
// output object to print, or null for no output.
export function runStop(input, projectDir, parseError = null) {
  const object = isPlainObject(input);
  if (object && input.stop_hook_active === true) return null;
  const fromInput = object && typeof input.cwd === 'string' ? input.cwd : '';
  const root = projectDir || fromInput;
  let loaded;
  try {
    if (!root) {
      if (parseError) throw new Error(`the hook input is not valid JSON: ${errorText(parseError)}`);
      throw new Error('no repository root: CLAUDE_PROJECT_DIR is unset and the input has no cwd');
    }
    loaded = loadManifest(root);
  } catch (err) {
    return failClosed(errorText(err));
  }
  if (!loaded.active) return null;
  if (parseError) return failClosed(`the hook input is not valid JSON: ${errorText(parseError)}`);
  if (!object) return failClosed('the hook input is not a JSON object');
  const text = readTranscript(input.transcript_path);
  if (text === null) return null;
  const entries = parseTranscript(text);
  if (entries.length === 0) return null;
  if (transcriptLags(entries, input.last_assistant_message)) return null;
  const result = evaluateTranscript(entries, loaded.manifest, root);
  if (result.missing.length === 0) return null;
  return stopMessage(result, loaded.manifest.consulted.mode);
}

// The whole hook run on one stdin text: returns the object to print, or null to print nothing.
export function run(stdinText, env = process.env) {
  let input = null;
  let parseError = null;
  try {
    input = JSON.parse(stdinText);
  } catch (err) {
    parseError = err;
  }
  return runStop(input, env.CLAUDE_PROJECT_DIR, parseError);
}

function main() {
  let output;
  try {
    output = run(fs.readFileSync(0, 'utf8'));
  } catch (err) {
    output = failClosed(errorText(err));
  }
  if (output) process.stdout.write(JSON.stringify(output) + '\n');
  process.exitCode = 0;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
