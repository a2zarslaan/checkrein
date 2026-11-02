// pretooluse.mjs: the checkrein PreToolUse entry point.
//
// Reads one hook input object on stdin, resolves the repository root from CLAUDE_PROJECT_DIR
// (falling back to the input's cwd), and loads checkrein.json. With no manifest or a version 1
// manifest it prints nothing. Otherwise it runs the rules in precedence order (production,
// protected trees, secrets, approval); the first rule that fires decides. A deny or an ask is
// printed as the hook's JSON decision; an allow prints nothing, so other hooks and the settings
// decide. Any error anywhere prints an ask whose reason starts with "checkrein guard error:"
// and ends by naming the alternatives (fix the manifest or report the error, or approve once).
// Always exits 0. Zero dependencies, Node 20 or newer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segments } from './evaluator.mjs';
import { loadManifest, withDefaults } from './manifest.mjs';
import * as production from './rules/production.mjs';
import * as protectedTrees from './rules/protected-trees.mjs';
import * as secrets from './rules/secrets.mjs';
import * as approval from './rules/approval.mjs';

export const RULES = [production, protectedTrees, secrets, approval];
export const ERROR_PREFIX = 'checkrein guard error:';

const ALLOW = Object.freeze({ decision: 'allow', rule: 'none', reason: '' });
const INACTIVE = Object.freeze({ decision: 'allow', rule: 'inactive', reason: 'checkrein enforcement is off: no manifest of version 2 or higher' });

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Accepts a loadManifest result ({ active, manifest }), a manifest object, or null.
// Returns the active manifest with defaults filled, or null when enforcement is off.
function activeManifest(manifest) {
  if (!isPlainObject(manifest)) return null;
  if (typeof manifest.active === 'boolean') return manifest.active ? activeManifest(manifest.manifest) : null;
  const version = isPlainObject(manifest.checkrein) ? manifest.checkrein.manifest_version : undefined;
  if (!Number.isInteger(version) || version < 2) return null;
  return withDefaults(manifest);
}

function isFileTool(toolInput) {
  return typeof toolInput.file_path === 'string' || typeof toolInput.notebook_path === 'string';
}

export function decide(input, manifest, projectRoot) {
  const m = activeManifest(manifest);
  if (!m) return { ...INACTIVE };
  if (!isPlainObject(input)) throw new Error('the hook input is not a JSON object');
  const root = projectRoot || process.env.CLAUDE_PROJECT_DIR || input.cwd;
  if (typeof root !== 'string' || root === '') throw new Error('no repository root: CLAUDE_PROJECT_DIR is unset and the input has no cwd');
  const tool = input.tool_name;
  const toolInput = isPlainObject(input.tool_input) ? input.tool_input : {};
  const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : root;
  const ctx = { tool, toolInput, command: '', segs: [], manifest: m, root, cwd };
  if (tool === 'Bash') {
    if (typeof toolInput.command !== 'string') throw new Error('the Bash tool input has no command string');
    ctx.command = toolInput.command;
    ctx.segs = segments(toolInput.command);
  } else if (tool !== 'Grep' && tool !== 'Glob' && !isFileTool(toolInput)) {
    return { ...ALLOW };
  }
  for (const rule of RULES) {
    const r = rule.check(ctx);
    if (r) return r;
  }
  return { ...ALLOW };
}

export function hookOutput(decision, reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } };
}

export const ERROR_ALTERNATIVE = 'Fix checkrein.json (or report the error), or approve this one call.';

function errorText(err) {
  const msg = err && err.message ? err.message : String(err);
  return `${msg.replace(/^checkrein: /, '').replace(/[\s.]*$/, '')}. ${ERROR_ALTERNATIVE}`;
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
  try {
    const fromInput = isPlainObject(input) && typeof input.cwd === 'string' ? input.cwd : '';
    const root = env.CLAUDE_PROJECT_DIR || fromInput;
    if (!root) {
      if (parseError) throw new Error(`the hook input is not valid JSON: ${parseError.message}`);
      throw new Error('no repository root: CLAUDE_PROJECT_DIR is unset and the input has no cwd');
    }
    const loaded = loadManifest(root);
    if (!loaded.active) return null;
    if (parseError) throw new Error(`the hook input is not valid JSON: ${parseError.message}`);
    const d = decide(input, loaded.manifest, root);
    if (d.decision === 'allow') return null;
    return hookOutput(d.decision, d.reason);
  } catch (err) {
    return hookOutput('ask', `${ERROR_PREFIX} ${errorText(err)}`);
  }
}

async function main() {
  let out;
  try {
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) text += chunk;
    out = run(text);
  } catch (err) {
    out = hookOutput('ask', `${ERROR_PREFIX} ${errorText(err)}`);
  }
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
  process.exitCode = 0;
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
