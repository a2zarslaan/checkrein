#!/usr/bin/env node
// checkrein-check.mjs: the mechanical check for a repository that uses checkrein.
//
// The init skill copies this one file to the repository root. Run it there:
//
//   node checkrein-check.mjs [--root <dir>] [--quiet]
//
// --root   the repository root to check (default: the directory holding this file)
// --quiet  print findings only, no success summary
//
// Checks, in order: manifest, corrections, working-docs, state-doc, changelog, em-dash, cross-refs.
// The manifest check accepts manifest versions 1 and 2. Version 2 keys are optional; each one present
// is checked for type and shape, and in a version 1 manifest they are reported as unknown keys.
// Every finding is one line on stdout, prefixed with the check name. A warning never fails the run.
// The working-docs check reads the direct children of the working docs folder only.
//
// Known limit of cross-refs: a backticked token with no slash counts as a path only when its
// extension is one of .md .json .mjs .js .ts .yml .yaml .sh, so a dead `notes.py` or `index.html`
// is not reported. Wider matching would flag names such as `Node.js` that are not paths.
// Cross-refs also skips history: the changelog, the corrections log, Part 2 of the state document
// and struck-through ~~spans~~, because those records keep the paths they recorded.
// Exit code 1 on any failure, 0 otherwise. Zero dependencies, Node 20 or newer.
//
// This file is deliberately standalone: it imports only Node built-ins so it can be copied anywhere.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EM_DASH = String.fromCharCode(0x2014); // built from its code point so no source file holds the character

// The manifest contract. Each object lists its required keys; a value of null means a leaf.
const CONTRACT = {
  checkrein: { manifest_version: null },
  project: { name: null, description: null, tracker: null },
  vcs: { trunk: null, release_branch: null },
  commands: { lint: null, typecheck: null, test: null, build: null, format_check: null },
  paths: {
    docs_dir: null,
    brief: null,
    architecture: null,
    business_rules: null,
    corrections_log: null,
    state_doc: null,
    changelog: null,
    working_docs_dir: null,
    runbooks_dir: null,
    refdocs_root: null,
  },
  workspaces: null,
  protected_trees: null,
  secret_globs: null,
  domains: null,
  areas: null,
  review: { confidence_floor: null },
};

// Manifest version 2 adds these keys. Each is optional (the guards fill a missing one with its
// default) and is checked for type and shape only when present. In a version 1 manifest they are
// unknown keys, because nothing reads them until the manifest says version 2.
const CONTRACT_V2 = {
  production_markers: { hosts: null, logins: null, ports: null, database_url_patterns: null },
  example_globs: null,
  approval: { ask: null, dependency_commands: null },
  consulted: { mode: null, code_globs: null, required_reads: null },
};
const SUPPORTED_VERSIONS = [1, 2];
const APPROVAL_CLASSES = ['push', 'pr_create', 'pr_merge', 'dependency_change'];
const CONSULTED_MODES = ['block', 'warn'];

const STATE_PARTS = [
  '## Part 1: Structural inventory',
  '## Part 2: Delta log',
  '## Part 3: Open gaps',
  '## Part 4: Accepted debt and settled decisions',
];

const CORRECTION_FIELDS = ['**What went wrong:**', '**Correct approach:**', '**Rule:**', '**Files affected:**'];
const CHANGELOG_SUBSECTIONS = ['### Added', '### Changed', '### Fixed'];
const CHANGELOG_SECTION = /^## PR #\d+: \S.*$/;
const PATH_EXTENSIONS = /\.(md|json|mjs|js|ts|yml|yaml|sh)$/;

// ---------- argument parsing ----------

function parseArgs(argv) {
  const opts = { root: dirname(fileURLToPath(import.meta.url)), quiet: false, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--root') {
      const value = argv[i + 1];
      if (!value) opts.error = '--root needs a directory';
      else opts.root = resolve(process.cwd(), value);
      i += 1;
    } else if (arg.startsWith('--root=')) opts.root = resolve(process.cwd(), arg.slice('--root='.length));
    else opts.error = `unknown argument "${arg}"`;
  }
  return opts;
}

// ---------- small helpers (duplicated in repo-checks.mjs on purpose: this file stays standalone) ----------

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function toPosix(path) {
  return path.split(sep).join('/');
}

// Replace every HTML comment with blank space of the same shape, so line numbers survive.
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, ' '));
}

// Mark each line as inside or outside a fenced code block. The fence lines themselves count as inside.
function fenceMask(lines) {
  const mask = [];
  let fence = null;
  for (const line of lines) {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence === null && match) {
      fence = match[1][0].repeat(match[1].length);
      mask.push(true);
    } else if (fence !== null && match && match[1][0] === fence[0] && match[1].length >= fence.length && line.trim() === match[1]) {
      fence = null;
      mask.push(true);
    } else {
      mask.push(fence !== null);
    }
  }
  return mask;
}

function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------- the run ----------

const opts = parseArgs(process.argv.slice(2));
const findings = [];
const warnings = [];
const output = []; // findings and warnings in the order the checks produce them
let checksRun = 0;

function fail(check, message) {
  findings.push(`${check}: ${message}`);
  output.push(`${check}: ${message}`);
}

function warn(check, message) {
  warnings.push(`${check}: WARN ${message}`);
  output.push(`${check}: WARN ${message}`);
}

if (opts.error) {
  console.log(`checkrein-check: ${opts.error}`);
  console.log('usage: node checkrein-check.mjs [--root <dir>] [--quiet]');
  process.exit(1);
}

const ROOT = opts.root;
const rel = (abs) => toPosix(relative(ROOT, abs)) || '.';
const fromRoot = (p) => join(ROOT, p);

if (!isDir(ROOT)) {
  console.log(`checkrein-check: root "${ROOT}" is not a directory`);
  process.exit(1);
}

// ---------- manifest ----------

function checkManifest() {
  const check = 'manifest';
  checksRun += 1;
  const manifestPath = fromRoot('checkrein.json');
  const text = readText(manifestPath);
  if (text === null) {
    fail(check, 'checkrein.json not found at the repository root (run the init skill to create it)');
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    fail(check, `checkrein.json does not parse: ${error.message}`);
    return null;
  }
  if (!isPlainObject(manifest)) {
    fail(check, 'checkrein.json must hold a JSON object');
    return null;
  }

  const version = manifest.checkrein?.manifest_version;
  for (const key of Object.keys(manifest)) {
    if (key in CONTRACT) continue;
    if (key in CONTRACT_V2) {
      if (version !== 1) continue; // checked below for version 2; an unsupported version is reported once
      fail(check, `unknown top-level key "${key}" (a manifest version 2 key; the upgrade skill moves the manifest to version 2)`);
    } else {
      fail(check, `unknown top-level key "${key}"`);
    }
  }
  for (const [key, shape] of Object.entries(CONTRACT)) {
    if (!(key in manifest)) {
      fail(check, `missing key "${key}"`);
      continue;
    }
    if (shape === null) continue;
    if (!isPlainObject(manifest[key])) {
      fail(check, `"${key}" must be an object`);
      continue;
    }
    for (const sub of Object.keys(shape)) {
      if (!(sub in manifest[key])) fail(check, `missing key "${key}.${sub}"`);
    }
    for (const sub of Object.keys(manifest[key])) {
      if (!(sub in shape)) fail(check, `unknown key "${key}.${sub}"`);
    }
  }

  if (!SUPPORTED_VERSIONS.includes(version)) {
    fail(check, `checkrein.manifest_version must be 1 or 2 (found ${JSON.stringify(version)})`);
  }
  if (version === 2) checkManifestV2(check, manifest);

  for (const group of ['project', 'vcs', 'commands']) {
    if (!isPlainObject(manifest[group])) continue;
    for (const [sub, value] of Object.entries(manifest[group])) {
      if (typeof value !== 'string') fail(check, `"${group}.${sub}" must be a string`);
    }
  }
  if (typeof manifest.vcs?.trunk === 'string' && manifest.vcs.trunk.trim() === '') {
    fail(check, '"vcs.trunk" must name the branch pull requests target');
  }

  if (isPlainObject(manifest.paths)) {
    for (const [key, value] of Object.entries(manifest.paths)) {
      const label = `paths.${key}`;
      if (typeof value !== 'string' || value.trim() === '') {
        fail(check, `"${label}" must be a non-empty string`);
        continue;
      }
      const abs = fromRoot(value);
      if (value.endsWith('/')) {
        if (!existsSync(abs)) fail(check, `"${label}" points to "${value}", which does not exist`);
        else if (!isDir(abs)) fail(check, `"${label}" points to "${value}", which is not a directory`);
      } else if (!existsSync(abs)) {
        fail(check, `"${label}" points to "${value}", which does not exist`);
      } else if (isDir(abs)) {
        fail(check, `"${label}" points to the directory "${value}"; write directory values with a trailing /`);
      }
    }
  }

  for (const key of ['protected_trees', 'secret_globs', 'domains', 'areas']) {
    if (!(key in manifest)) continue;
    const value = manifest[key];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      fail(check, `"${key}" must be an array of strings`);
    }
  }
  if (Array.isArray(manifest.protected_trees)) {
    for (const tree of manifest.protected_trees) {
      if (typeof tree === 'string' && tree.trim() !== '' && !existsSync(fromRoot(tree))) {
        warn(check, `protected_trees entry "${tree}" does not exist`);
      }
    }
  }
  if (Array.isArray(manifest.domains) && !manifest.domains.includes('process')) {
    fail(check, '"domains" must include "process"');
  }

  const floor = manifest.review?.confidence_floor;
  if (isPlainObject(manifest.review) && 'confidence_floor' in manifest.review) {
    if (!Number.isInteger(floor) || floor < 0 || floor > 100) {
      fail(check, `"review.confidence_floor" must be an integer from 0 to 100 (found ${JSON.stringify(floor)})`);
    }
  }

  if ('workspaces' in manifest) {
    const workspaces = manifest.workspaces;
    if (!Array.isArray(workspaces) || workspaces.length === 0) {
      fail(check, '"workspaces" must be a non-empty array of {name, root}');
    } else {
      const seen = new Set();
      workspaces.forEach((ws, i) => {
        const label = `workspaces[${i}]`;
        if (!isPlainObject(ws)) {
          fail(check, `${label} must be an object with "name" and "root"`);
          return;
        }
        if (typeof ws.name !== 'string' || ws.name.trim() === '') fail(check, `${label}.name must be a non-empty string`);
        else if (seen.has(ws.name)) fail(check, `${label}.name "${ws.name}" is used twice`);
        else seen.add(ws.name);
        if (typeof ws.root !== 'string' || ws.root.trim() === '') fail(check, `${label}.root must be a non-empty string`);
        else if (!isDir(fromRoot(ws.root))) fail(check, `${label}.root "${ws.root}" is not a directory`);
      });
    }
  }

  return manifest;
}

// The version 2 keys: every key is optional, and a present key must have the documented shape.
// A list rule reports a value that is not an array, then the first item that breaks the rule.
function checkManifestV2(check, manifest) {
  const listOf = (label, value, itemOk, plural, singular) => {
    if (!Array.isArray(value)) {
      fail(check, `"${label}" must be an array of ${plural}`);
      return;
    }
    const bad = value.findIndex((item) => !itemOk(item));
    if (bad !== -1) fail(check, `"${label}[${bad}]" must be ${singular} (found ${JSON.stringify(value[bad])})`);
  };
  const nonEmpty = (item) => typeof item === 'string' && item.trim() !== '';
  const noSpace = (item) => nonEmpty(item) && !/\s/.test(item);

  for (const [key, shape] of Object.entries(CONTRACT_V2)) {
    if (!(key in manifest) || shape === null) continue;
    if (!isPlainObject(manifest[key])) {
      fail(check, `"${key}" must be an object`);
      continue;
    }
    for (const sub of Object.keys(manifest[key])) {
      if (!(sub in shape)) fail(check, `unknown key "${key}.${sub}"`);
    }
  }
  const sub = (key, name) => (isPlainObject(manifest[key]) && name in manifest[key] ? { present: true, value: manifest[key][name] } : { present: false });

  const hosts = sub('production_markers', 'hosts');
  if (hosts.present) listOf('production_markers.hosts', hosts.value, noSpace, 'hostnames or addresses', 'a hostname or address with no spaces');
  const logins = sub('production_markers', 'logins');
  if (logins.present) listOf('production_markers.logins', logins.value, (item) => noSpace(item) && /^[^@]+@/.test(item), 'logins', 'a login written as "user@" or "user@host"');
  const ports = sub('production_markers', 'ports');
  if (ports.present) {
    const portOk = (item) => {
      const n = typeof item === 'string' && /^\d+$/.test(item) ? Number(item) : item;
      return Number.isInteger(n) && n >= 1 && n <= 65535;
    };
    listOf('production_markers.ports', ports.value, portOk, 'port numbers', 'a port number from 1 to 65535');
  }
  const urls = sub('production_markers', 'database_url_patterns');
  if (urls.present) {
    if (!Array.isArray(urls.value)) fail(check, '"production_markers.database_url_patterns" must be an array of regular expression sources');
    else {
      urls.value.forEach((source, i) => {
        const label = `production_markers.database_url_patterns[${i}]`;
        if (!nonEmpty(source)) {
          fail(check, `"${label}" must be a non-empty regular expression source (found ${JSON.stringify(source)})`);
          return;
        }
        try {
          new RegExp(source);
        } catch (error) {
          fail(check, `"${label}" is not a valid regular expression: ${error.message}`);
        }
      });
    }
  }

  if ('example_globs' in manifest) listOf('example_globs', manifest.example_globs, nonEmpty, 'glob strings', 'a non-empty glob string');

  const ask = sub('approval', 'ask');
  if (ask.present) {
    if (!Array.isArray(ask.value)) fail(check, `"approval.ask" must be an array drawn from ${APPROVAL_CLASSES.join(', ')}`);
    else {
      ask.value.forEach((item, i) => {
        if (!APPROVAL_CLASSES.includes(item)) fail(check, `"approval.ask[${i}]" must be one of ${APPROVAL_CLASSES.join(', ')} (found ${JSON.stringify(item)})`);
      });
    }
  }
  const depCommands = sub('approval', 'dependency_commands');
  if (depCommands.present) listOf('approval.dependency_commands', depCommands.value, nonEmpty, 'command prefixes', 'a non-empty command prefix');

  const mode = sub('consulted', 'mode');
  if (mode.present && !CONSULTED_MODES.includes(mode.value)) {
    fail(check, `"consulted.mode" must be "block" or "warn" (found ${JSON.stringify(mode.value)})`);
  }
  const codeGlobs = sub('consulted', 'code_globs');
  if (codeGlobs.present) listOf('consulted.code_globs', codeGlobs.value, nonEmpty, 'glob strings', 'a non-empty glob string');
  const reads = sub('consulted', 'required_reads');
  if (reads.present) {
    if (!Array.isArray(reads.value) || !reads.value.every(nonEmpty)) {
      fail(check, '"consulted.required_reads" must be an array of non-empty repository-relative file paths');
    } else {
      for (const file of reads.value) {
        if (!isFile(fromRoot(file))) warn(check, `consulted.required_reads entry "${file}" is not a file in the repository`);
      }
    }
  }
}

// Resolve a manifest path to an absolute path only when it exists in the expected form.
function manifestFile(manifest, key) {
  const value = manifest?.paths?.[key];
  if (typeof value !== 'string' || value === '' || value.endsWith('/')) return null;
  const abs = fromRoot(value);
  return isFile(abs) ? abs : null;
}

function manifestDir(manifest, key) {
  const value = manifest?.paths?.[key];
  if (typeof value !== 'string' || value === '') return null;
  const abs = fromRoot(value);
  return isDir(abs) ? abs : null;
}

// ---------- corrections ----------

function checkCorrections(manifest) {
  const check = 'corrections';
  checksRun += 1;
  const file = manifestFile(manifest, 'corrections_log');
  if (!file) return; // the manifest check already reported the path
  const domains = new Set(Array.isArray(manifest.domains) ? manifest.domains : []);
  const lines = stripHtmlComments(readText(file) ?? '').split('\n');
  const inFence = fenceMask(lines);
  const name = rel(file);
  const grammar = /^### (Pattern|Convention) \[([^\]]*)\]: (.*\S.*)$/;

  const headings = [];
  lines.forEach((line, i) => {
    if (!inFence[i] && /^#{1,6} /.test(line)) headings.push(i);
  });

  headings.forEach((start, h) => {
    const line = lines[start];
    const where = `${name}:${start + 1}`;
    if (!line.startsWith('### ')) {
      if (/^#{1,6} (Pattern|Convention) \[/.test(line)) {
        fail(check, `${where}: rule headings are level 3 ("### "); this one is not, so the heading index misses it: "${line.slice(0, 120)}"`);
      }
      return;
    }
    const match = line.match(grammar);
    if (!match) {
      fail(check, `${where}: heading does not follow "### Pattern|Convention [<domains>]: <sentence>": "${line.slice(0, 120)}"`);
      return;
    }
    const tags = match[2].split(', ');
    for (const tag of tags) {
      if (!domains.has(tag)) fail(check, `${where}: tag "${tag}" is not in the manifest's domains`);
    }
    const end = h + 1 < headings.length ? headings[h + 1] : lines.length;
    let cursor = start + 1;
    for (const field of CORRECTION_FIELDS) {
      let found = -1;
      for (let j = cursor; j < end; j += 1) {
        if (lines[j].includes(field)) {
          found = j;
          break;
        }
      }
      if (found === -1) {
        fail(check, `${where}: entry is missing ${field} (the four fields must appear in order)`);
        break;
      }
      cursor = found + 1;
    }
  });
}

// ---------- working-docs ----------

function checkWorkingDocs(manifest) {
  const check = 'working-docs';
  checksRun += 1;
  const dir = manifestDir(manifest, 'working_docs_dir');
  if (!dir) return;
  const allowed = /^(plan|audit) - .+\.md$/;
  // Direct children only: a subfolder (a staging folder, say) is not a working doc.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const base = entry.name;
    if (!entry.isFile() || !base.endsWith('.md')) continue;
    if (base === 'README.md' || allowed.test(base)) continue;
    fail(check, `${rel(join(dir, base))}: working docs are named "plan - <descriptor>.md" or "audit - <descriptor>.md"`);
  }
}

// ---------- state-doc ----------

function checkStateDoc(manifest) {
  const check = 'state-doc';
  checksRun += 1;
  const file = manifestFile(manifest, 'state_doc');
  if (!file) return;
  const name = rel(file);
  const lines = stripHtmlComments(readText(file) ?? '').split('\n');
  const inFence = fenceMask(lines);

  let previous = -1;
  for (const part of STATE_PARTS) {
    const hits = [];
    lines.forEach((line, i) => {
      if (!inFence[i] && line.trimEnd() === part) hits.push(i);
    });
    if (hits.length === 0) {
      fail(check, `${name}: missing the heading "${part}"`);
      continue;
    }
    if (hits.length > 1) fail(check, `${name}:${hits[1] + 1}: "${part}" appears more than once`);
    if (hits[0] < previous) fail(check, `${name}:${hits[0] + 1}: "${part}" is out of order`);
    previous = hits[0];
  }

  lines.forEach((line, i) => {
    if (inFence[i] || !line.startsWith('## Part ')) return;
    if (!STATE_PARTS.includes(line.trimEnd())) fail(check, `${name}:${i + 1}: "${line.trim()}" is not one of the four Part headings`);
  });

  const title = lines.findIndex((line, i) => !inFence[i] && /^# /.test(line));
  if (title === -1) {
    fail(check, `${name}: no "# " title line; the currency marker is the first line after the title`);
    return;
  }
  let next = title + 1;
  while (next < lines.length && lines[next].trim() === '') next += 1;
  if (next >= lines.length || !/^Current as of: .+/.test(lines[next])) {
    fail(check, `${name}:${title + 1}: the first line after the title must be "Current as of: <merge commit sha or description>"`);
  }
}

// ---------- changelog ----------

function checkChangelog(manifest) {
  const check = 'changelog';
  checksRun += 1;
  const file = manifestFile(manifest, 'changelog');
  if (!file) return;
  const name = rel(file);
  const lines = stripHtmlComments(readText(file) ?? '').split('\n');
  const inFence = fenceMask(lines);

  let section = null; // { line, subsections, sub: { line, content } }
  const closeSub = () => {
    if (section?.sub && !section.sub.content) warn(check, `${name}:${section.sub.line + 1}: "${lines[section.sub.line].trim()}" is empty; leave out empty subsections`);
    if (section) section.sub = null;
  };
  const closeSection = () => {
    closeSub();
    if (section && section.subsections === 0) warn(check, `${name}:${section.line + 1}: section "${lines[section.line].trim()}" has no Added, Changed or Fixed subsection`);
    section = null;
  };

  lines.forEach((line, i) => {
    if (inFence[i]) {
      if (section?.sub) section.sub.content = true;
      return;
    }
    if (/^# /.test(line)) {
      closeSection();
      return;
    }
    if (line.startsWith('## ')) {
      closeSection();
      section = { line: i, subsections: 0, sub: null };
      // A warning, not a failure: a project may keep a release section between the PR sections.
      if (!CHANGELOG_SECTION.test(line.trimEnd())) warn(check, `${name}:${i + 1}: section "${line.trim()}" is not headed "## PR #<number>: <title>"`);
      return;
    }
    if (/^#{3,6} /.test(line)) {
      const heading = line.trimEnd();
      if (!section) {
        fail(check, `${name}:${i + 1}: "${heading}" sits outside any "## " section`);
        return;
      }
      closeSub();
      if (!CHANGELOG_SUBSECTIONS.includes(heading)) {
        fail(check, `${name}:${i + 1}: "${heading}" is not one of ### Added, ### Changed, ### Fixed`);
        return;
      }
      section.subsections += 1;
      section.sub = { line: i, content: false };
      return;
    }
    if (section?.sub && line.trim() !== '') section.sub.content = true;
  });
  closeSection();
}

// ---------- em-dash ----------

function scanEmDash(check, file) {
  let buffer;
  try {
    buffer = readFileSync(file);
  } catch {
    return;
  }
  if (buffer.includes(0)) return; // binary file
  const lines = buffer.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    const col = line.indexOf(EM_DASH);
    if (col !== -1) fail(check, `${rel(file)}:${i + 1}:${col + 1}: em dash (U+2014); use a period, comma, colon, semicolon or parentheses`);
  });
}

function checkEmDash(manifest) {
  const check = 'em-dash';
  checksRun += 1;
  const files = [];
  const docsDir = manifestDir(manifest, 'docs_dir');
  if (docsDir) files.push(...walkFiles(docsDir));
  for (const top of ['AGENTS.md', 'CLAUDE.md', 'checkrein.json']) {
    if (isFile(fromRoot(top))) files.push(fromRoot(top));
  }
  for (const file of files) scanEmDash(check, file);
}

// ---------- cross-refs ----------

// Decide whether a backticked token names a repository path. Returns the path to test, or null.
// Placeholders (<, >, *, {{, $), commands (spaces), patterns, URLs, absolute paths, slash commands
// and flags are never paths. A token with a slash and no file extension (`origin/main`, an
// owner/repo pair) counts only when its first segment exists, so `scripts/build` is checked.
function pathCandidate(token) {
  let t = token.trim();
  if (t === '' || /\s/.test(t) || t.includes('{{')) return null;
  if (/[<>*$|()[\]=^\\?'"`,;@!]/.test(t)) return null;
  if (/^https?:/i.test(t) || t.includes('://')) return null;
  if (/^[/~-]/.test(t)) return null;
  t = t.replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, ''); // drop a #anchor or a :line suffix
  if (t === '') return null;
  if (PATH_EXTENSIONS.test(t)) return t;
  if (!t.includes('/')) return null;
  if (t.endsWith('/')) return t;
  const segments = t.split('/');
  if (segments[segments.length - 1].includes('.')) return t;
  return existsSync(fromRoot(segments[0])) ? t : null;
}

// Paths resolve against the repository root; a path relative to the citing file is accepted too.
function candidateExists(candidate, fileDir) {
  return existsSync(fromRoot(candidate)) || existsSync(join(fileDir, candidate));
}

// Mark the lines of the state document's Part 2 section: the delta log is history and keeps the
// paths it recorded, even after they move.
function historyMask(lines, inFence) {
  let inPart2 = false;
  return lines.map((line, i) => {
    if (!inFence[i] && line.startsWith('## ')) inPart2 = line.trimEnd() === STATE_PARTS[1];
    return inPart2;
  });
}

function checkCrossRefs(manifest) {
  const check = 'cross-refs';
  checksRun += 1;
  // The changelog and the corrections log are append-only history; the paths they cite may since
  // have moved, and those records are never rewritten, so they are not checked.
  const history = new Set([manifestFile(manifest, 'changelog'), manifestFile(manifest, 'corrections_log')].filter(Boolean));
  const stateDoc = manifestFile(manifest, 'state_doc');
  const files = [];
  if (isFile(fromRoot('AGENTS.md'))) files.push(fromRoot('AGENTS.md'));
  const docsDir = manifestDir(manifest, 'docs_dir');
  if (docsDir) files.push(...walkFiles(docsDir).filter((f) => f.endsWith('.md') && !history.has(f)));

  for (const file of files) {
    const lines = stripHtmlComments(readText(file) ?? '').split('\n');
    const inFence = fenceMask(lines);
    const skip = file === stateDoc ? historyMask(lines, inFence) : lines.map(() => false);
    const fileDir = dirname(file);
    lines.forEach((rawLine, i) => {
      if (skip[i]) return;
      if (inFence[i] && /^\s{0,3}(`{3,}|~{3,})/.test(rawLine)) return; // the fence line itself
      const line = rawLine.replace(/~~.*?~~/g, ''); // a struck-through span records something retired
      for (const match of line.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) {
        const token = match[1];
        const candidate = pathCandidate(token);
        if (!candidate) continue;
        if (candidateExists(candidate, fileDir)) continue;
        fail(check, `${rel(file)}:${i + 1}: \`${candidate}\` does not exist`);
      }
    });
  }
}

// ---------- main ----------

const manifest = checkManifest();
if (manifest) {
  checkCorrections(manifest);
  checkWorkingDocs(manifest);
  checkStateDoc(manifest);
  checkChangelog(manifest);
  checkEmDash(manifest);
  checkCrossRefs(manifest);
}

for (const line of output) console.log(line);
if (findings.length > 0) {
  console.log(`checkrein-check: FAILED (${findings.length} finding${findings.length === 1 ? '' : 's'} in ${checksRun} checks)`);
  process.exit(1);
}
if (!opts.quiet) {
  const note = warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '';
  console.log(`checkrein-check: OK (${checksRun} checks${note})`);
}
process.exit(0);
