#!/usr/bin/env node
// repo-checks.mjs: hygiene checks for the checkrein repository itself.
//
//   node scripts/repo-checks.mjs [--quiet]
//
// Runs from any directory; the repository root is the parent of this file's folder.
// Checks: em-dash, leaks, skills, skill-refs, plugin, manifest-template, readme, templates.
// Every finding is one line on stdout, prefixed with the check name. Exit 1 on any finding.
// Zero dependencies, Node 20 or newer. The helpers are exported for repo-checks.test.mjs.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EM_DASH = String.fromCharCode(0x2014); // built from its code point so no source file holds the character

const SKILL_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const MANIFEST_CONTRACT = {
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
  workspaces: [{ name: null, root: null }],
  protected_trees: null,
  secret_globs: null,
  domains: null,
  areas: null,
  review: { confidence_floor: null },
};

// ---------- small helpers (duplicated in checkrein-check.mjs on purpose: that file stays standalone) ----------

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

function toPosix(path) {
  return path.split(sep).join('/');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Every regular file under dir, skipping the named directories at any depth.
export function walkFiles(dir, skipDirs = ['.git', 'node_modules']) {
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
      if (!skipDirs.includes(entry.name)) out.push(...walkFiles(full, skipDirs));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// Read a file as text lines, or null for an unreadable or binary file.
function textLines(path) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    return null;
  }
  if (buffer.includes(0)) return null;
  return buffer.toString('utf8').split('\n');
}

// ---------- em-dash ----------

// Return every U+2014 in a file as { line, col }, both 1-based.
export function scanEmDash(path) {
  const lines = textLines(path);
  if (!lines) return [];
  const hits = [];
  lines.forEach((line, i) => {
    let col = line.indexOf(EM_DASH);
    while (col !== -1) {
      hits.push({ line: i + 1, col: col + 1 });
      col = line.indexOf(EM_DASH, col + 1);
    }
  });
  return hits;
}

// ---------- leaks ----------

// Parse a term list: one JavaScript regular expression per line, # lines and blank lines skipped.
// A line starting with (?-i) is matched case-sensitively; every other line ignores case.
export function parseTermList(text) {
  const terms = [];
  const errors = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    const caseSensitive = line.startsWith('(?-i)');
    const source = caseSensitive ? line.slice('(?-i)'.length) : line;
    if (source === '') return;
    try {
      terms.push({ source, caseSensitive, regex: new RegExp(source, caseSensitive ? '' : 'i'), line: i + 1 });
    } catch (error) {
      errors.push({ line: i + 1, message: error.message });
    }
  });
  return { terms, errors };
}

// Return every term hit in a file as { line, term }.
export function scanTerms(path, terms) {
  const lines = textLines(path);
  if (!lines) return [];
  const hits = [];
  lines.forEach((line, i) => {
    for (const term of terms) {
      if (term.regex.test(line)) hits.push({ line: i + 1, term: term.source });
    }
  });
  return hits;
}

// ---------- skills ----------

function unquote(value, lineNo, errors) {
  if (value.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) {
      errors.push(`line ${lineNo}: unterminated double-quoted value`);
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) {
      errors.push(`line ${lineNo}: unterminated single-quoted value`);
      return value;
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

// Parse the YAML frontmatter of a SKILL.md. Supports the subset skills use: top-level keys with
// plain, quoted or block (| or >) scalars, and one level of nested mapping or list.
// Returns { data, errors, found, endLine }.
export function parseFrontmatter(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const errors = [];
  const data = {};
  if (lines[0] !== '---') return { data, errors: ['the file does not start with a --- frontmatter line'], found: false, endLine: 0 };
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { data, errors: ['the frontmatter has no closing --- line'], found: false, endLine: 0 };

  let i = 1;
  while (i < end) {
    const line = lines[i];
    const lineNo = i + 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      i += 1;
      continue;
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/);
    if (!match) {
      errors.push(`line ${lineNo}: expected "key: value", found "${line.slice(0, 80)}"`);
      i += 1;
      continue;
    }
    const key = match[1];
    const value = (match[2] ?? '').trim();
    if (key in data) errors.push(`line ${lineNo}: duplicate key "${key}"`);

    // Gather the indented continuation lines.
    const block = [];
    let j = i + 1;
    while (j < end && (lines[j].trim() === '' || /^\s/.test(lines[j]))) {
      block.push(lines[j]);
      j += 1;
    }
    while (block.length && block[block.length - 1].trim() === '') block.pop();

    if (/^[|>][+-]?$/.test(value)) {
      const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
      const body = block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
      data[key] = value.startsWith('|') ? body.join('\n') : body.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ').trim();
    } else if (value === '' && block.length) {
      const items = block.filter((l) => l.trim());
      if (items.every((l) => /^\s+- /.test(l))) {
        data[key] = items.map((l) => unquote(l.replace(/^\s+- /, '').trim(), lineNo, errors));
      } else {
        const nested = {};
        for (const l of items) {
          const m = l.match(/^\s+([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
          if (!m) errors.push(`line ${lineNo}: cannot parse nested line "${l.trim().slice(0, 80)}" under "${key}"`);
          else nested[m[1]] = unquote((m[2] ?? '').trim(), lineNo, errors);
        }
        data[key] = nested;
      }
    } else {
      let scalar = value;
      if (block.length) {
        if (/^["']/.test(scalar)) scalar = [scalar, ...block.map((l) => l.trim())].join(' ');
        else scalar = [scalar, ...block.map((l) => l.trim()).filter(Boolean)].join(' ');
      }
      if (!/^["']/.test(scalar)) {
        if (/:\s/.test(scalar)) errors.push(`line ${lineNo}: the value of "${key}" holds ": " and must be quoted to be valid YAML`);
        if (/\s#/.test(scalar)) errors.push(`line ${lineNo}: the value of "${key}" holds " #", which YAML reads as a comment; quote it`);
        if (/^[[{&*!%@`]/.test(scalar)) errors.push(`line ${lineNo}: the value of "${key}" starts with a YAML indicator; quote it`);
      }
      data[key] = unquote(scalar, lineNo, errors);
    }
    i = j;
  }
  return { data, errors, found: true, endLine: end + 1 };
}

// ---------- readme ----------

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

// Find the markdown tables in text and return, for each, the backticked names in the first cell of
// every body row: [{ line, names: [...] }].
export function parseReadmeTables(text) {
  const lines = text.split('\n');
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    const isRow = (l) => l !== undefined && l.trim().startsWith('|');
    const isDivider = (l) => l !== undefined && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
    if (isRow(lines[i]) && isDivider(lines[i + 1])) {
      const table = { line: i + 1, names: [] };
      let j = i + 2;
      while (isRow(lines[j])) {
        const first = splitRow(lines[j])[0] ?? '';
        for (const match of first.matchAll(/`([^`]+)`/g)) table.names.push(match[1].trim());
        j += 1;
      }
      tables.push(table);
      i = j;
    } else {
      i += 1;
    }
  }
  return tables;
}

// Pick the skills table: the table whose first column names the most skill folders.
export function findSkillsTable(text, skillNames) {
  const wanted = new Set(skillNames);
  let best = null;
  for (const table of parseReadmeTables(text)) {
    const score = table.names.filter((n) => wanted.has(n)).length;
    if (score > 0 && (!best || score > best.score)) best = { ...table, score };
  }
  return best;
}

// ---------- skill cross-refs ----------

// Replace every HTML comment with blank space of the same shape, so line numbers survive.
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, ' '));
}

// Same token rules as pathCandidate in checkrein-check.mjs. A slash-bearing token with no file
// extension counts only when its first segment exists under one of the bases.
export function pathCandidate(token, bases) {
  let t = token.trim();
  if (t === '' || /\s/.test(t) || t.includes('{{')) return null;
  if (/[<>*$|()[\]=^\\?'"`,;@!]/.test(t)) return null;
  if (/^https?:/i.test(t) || t.includes('://')) return null;
  if (/^[/~-]/.test(t)) return null;
  t = t.replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '');
  if (t === '') return null;
  if (/\.(md|json|mjs|js|ts|yml|yaml|sh)$/.test(t)) return t;
  if (!t.includes('/')) return null;
  if (t.endsWith('/')) return t;
  const segments = t.split('/');
  if (segments[segments.length - 1].includes('.')) return t;
  return bases.some((base) => existsSync(join(base, segments[0]))) ? t : null;
}

// Every dead backticked path in the skills' markdown, as { file, line, path }. A skill path may name
// an adopter file (resolved against templates/, the adopter root), a file in its own skill folder
// (references/, evals/), a file next to the citing file, or a file in this repository.
export function scanSkillCrossRefs(root) {
  const dead = [];
  const skillsDir = join(root, 'skills');
  if (!isDir(skillsDir)) return dead;
  // A bare file name (`_INDEX.md`) names a kind of file; it resolves when one exists anywhere in templates/.
  const templateNames = new Set(walkFiles(join(root, 'templates')).map((f) => f.slice(dirname(f).length + 1)));
  for (const file of walkFiles(skillsDir).filter((f) => f.endsWith('.md'))) {
    const skillDir = join(skillsDir, toPosix(relative(skillsDir, file)).split('/')[0]);
    const bases = [join(root, 'templates'), skillDir, dirname(file), root];
    const lines = stripHtmlComments(readText(file) ?? '').split('\n');
    lines.forEach((rawLine, i) => {
      if (/^\s{0,3}(`{3,}|~{3,})/.test(rawLine)) return; // a fence line
      const line = rawLine.replace(/~~.*?~~/g, '');
      for (const match of line.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) {
        const candidate = pathCandidate(match[1], bases);
        if (!candidate) continue;
        if (bases.some((base) => existsSync(join(base, candidate)))) continue;
        if (!candidate.includes('/') && templateNames.has(candidate)) continue;
        dead.push({ file, line: i + 1, path: candidate });
      }
    });
  }
  return dead;
}

// ---------- the checks ----------

function skillFolders(root) {
  const dir = join(root, 'skills');
  if (!isDir(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function compareKeys(actual, contract, path, report) {
  if (contract === null) return;
  if (Array.isArray(contract)) {
    if (!Array.isArray(actual)) {
      report(`"${path}" must be an array`);
      return;
    }
    actual.forEach((item, i) => compareKeys(item, contract[0], `${path}[${i}]`, report));
    return;
  }
  if (!isPlainObject(actual)) {
    report(`"${path || 'the manifest'}" must be an object`);
    return;
  }
  const prefix = path ? `${path}.` : '';
  for (const key of Object.keys(contract)) {
    if (!(key in actual)) report(`missing key "${prefix}${key}"`);
    else compareKeys(actual[key], contract[key], `${prefix}${key}`, report);
  }
  for (const key of Object.keys(actual)) {
    if (!(key in contract)) report(`unknown key "${prefix}${key}"`);
  }
}

export function runChecks(root = ROOT) {
  const findings = [];
  const notices = [];
  const fail = (check, message) => findings.push(`${check}: ${message}`);
  const rel = (abs) => toPosix(relative(root, abs));

  // em-dash
  for (const file of walkFiles(root)) {
    for (const hit of scanEmDash(file)) fail('em-dash', `${rel(file)}:${hit.line}:${hit.col}: em dash (U+2014)`);
  }

  // leaks
  const termFile = join(root, '.leakcheck', 'terms.txt');
  const termText = readText(termFile);
  if (termText === null) {
    notices.push('leaks: notice: .leakcheck/terms.txt not found, leak check skipped');
  } else {
    const { terms, errors } = parseTermList(termText);
    for (const error of errors) fail('leaks', `.leakcheck/terms.txt:${error.line}: invalid pattern: ${error.message}`);
    // A hit names the term by its line in the term file, never by its text: the term list stays private.
    const termLine = new Map(terms.map((term) => [term.source, term.line]));
    for (const file of walkFiles(root, ['.git', 'node_modules', '.leakcheck'])) {
      for (const hit of scanTerms(file, terms)) fail('leaks', `${rel(file)}:${hit.line}: matches term #${termLine.get(hit.term)}`);
    }
  }

  // skills
  const skills = skillFolders(root);
  if (skills.length === 0) fail('skills', 'no skill folders under skills/');
  for (const name of skills) {
    const path = join(root, 'skills', name, 'SKILL.md');
    const text = readText(path);
    const where = `skills/${name}/SKILL.md`;
    if (text === null) {
      fail('skills', `${where} is missing`);
      continue;
    }
    const lineCount = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
    if (lineCount >= 500) fail('skills', `${where} has ${lineCount} lines; keep it under 500`);
    const { data, errors, found } = parseFrontmatter(text);
    for (const error of errors) fail('skills', `${where}: frontmatter ${error}`);
    if (!found) continue;
    for (const key of Object.keys(data)) {
      if (!SKILL_KEYS.has(key)) fail('skills', `${where}: frontmatter key "${key}" is not portable (allowed: ${[...SKILL_KEYS].join(', ')})`);
    }
    if (data.name !== name) fail('skills', `${where}: name "${data.name ?? ''}" must equal the folder name "${name}"`);
    if (typeof data.name === 'string' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.name)) fail('skills', `${where}: name must use lowercase letters, digits and single hyphens`);
    if (typeof data.name === 'string' && data.name.length > 64) fail('skills', `${where}: name is longer than 64 characters`);
    const description = typeof data.description === 'string' ? data.description : '';
    if (description.length < 1 || description.length > 1024) fail('skills', `${where}: description must be 1 to 1024 characters (found ${description.length})`);
  }

  // skill-refs
  for (const hit of scanSkillCrossRefs(root)) fail('skill-refs', `${rel(hit.file)}:${hit.line}: \`${hit.path}\` does not exist`);

  // plugin
  const readJson = (relPath) => {
    const text = readText(join(root, relPath));
    if (text === null) {
      fail('plugin', `${relPath} is missing`);
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      fail('plugin', `${relPath} does not parse: ${error.message}`);
      return null;
    }
  };
  const plugin = readJson('.claude-plugin/plugin.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  if (plugin && plugin.name !== 'checkrein') fail('plugin', `.claude-plugin/plugin.json name must be "checkrein" (found ${JSON.stringify(plugin.name)})`);
  if (marketplace) {
    const entry = Array.isArray(marketplace.plugins) ? marketplace.plugins[0] : undefined;
    if (!entry) fail('plugin', '.claude-plugin/marketplace.json has no plugins[0] entry');
    else {
      if (plugin && entry.name !== plugin.name) fail('plugin', `marketplace plugins[0].name ${JSON.stringify(entry.name)} must equal the plugin name ${JSON.stringify(plugin.name)}`);
      if (entry.source !== './') fail('plugin', `marketplace plugins[0].source must be "./" (found ${JSON.stringify(entry.source)})`);
    }
  }

  // manifest-template
  const templateText = readText(join(root, 'templates', 'checkrein.json'));
  if (templateText === null) fail('manifest-template', 'templates/checkrein.json is missing');
  else {
    try {
      const template = JSON.parse(templateText);
      compareKeys(template, MANIFEST_CONTRACT, '', (message) => fail('manifest-template', `templates/checkrein.json: ${message}`));
      if (template?.checkrein?.manifest_version !== 1) fail('manifest-template', 'templates/checkrein.json: checkrein.manifest_version must be 1');
    } catch (error) {
      fail('manifest-template', `templates/checkrein.json does not parse: ${error.message}`);
    }
  }

  // readme
  const readme = readText(join(root, 'README.md'));
  if (readme === null) fail('readme', 'README.md is missing');
  else if (skills.length) {
    const table = findSkillsTable(readme, skills);
    if (!table) fail('readme', 'README.md has no skills table (a table whose first column holds backticked skill names)');
    else {
      for (const name of skills) {
        if (!table.names.includes(name)) fail('readme', `README.md:${table.line}: the skills table does not list \`${name}\``);
      }
      for (const name of table.names) {
        if (!skills.includes(name)) fail('readme', `README.md:${table.line}: the skills table lists \`${name}\`, which has no folder under skills/`);
      }
    }
  }

  // templates
  const script = join(root, 'scripts', 'checkrein-check.mjs');
  if (!existsSync(script)) fail('templates', 'scripts/checkrein-check.mjs is missing');
  else {
    const result = spawnSync(process.execPath, [script, '--root', join(root, 'templates'), '--quiet'], { encoding: 'utf8' });
    if (result.status !== 0) {
      const lines = (result.stdout ?? '').split('\n').filter((l) => l && !l.startsWith('checkrein-check: FAILED'));
      for (const line of lines) fail('templates', line);
      if (lines.length === 0) fail('templates', `the adopter check exited ${result.status} on templates/ ${(result.stderr ?? '').trim()}`);
    }
  }

  return { findings, notices };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const { findings, notices } = runChecks(ROOT);
  for (const line of notices) console.log(line);
  for (const line of findings) console.log(line);
  if (findings.length) {
    console.log(`repo-checks: FAILED (${findings.length} finding${findings.length === 1 ? '' : 's'})`);
    process.exit(1);
  }
  if (!quiet) console.log('repo-checks: OK');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
