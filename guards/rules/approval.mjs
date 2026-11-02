// approval.mjs: the approval rule (Bash only, ask).
//
// Asks before an action the operator approves: a push (`git push` in any form, `git subtree
// push`, a mutating `gh api` call on refs or contents), a pull request creation or merge
// (`gh pr create`, `gh pr merge` with gh's flags anywhere before the subcommand, a mutating
// `gh api` call on pulls or merges, a GraphQL mutation or a query read from a file), and a
// dependency change (the manifest's `approval.dependency_commands` plus a built-in list).
// A lockfile-faithful install never asks. `approval.ask` switches each class on or off.

import { result, gitSubcommand } from './common.mjs';

export const RULE = 'approval';
export const CLASSES = ['push', 'pr_create', 'pr_merge', 'dependency_change'];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GH_API_VALUE_OPTS = new Set(['-X', '--method', '-H', '--header', '-f', '--raw-field', '-F', '--field', '--input', '-q', '--jq', '-t', '--template', '--hostname', '-p', '--preview', '--cache']);

function ask(what, klass) {
  return result(
    'ask',
    RULE,
    `checkrein: ${what} waits for the operator's approval (approval class ${klass}). Approve it to run it once, or decline and hand the command to the operator.`,
  );
}

function ghApi(argv, start) {
  let method = '';
  let fields = false;
  let input = false;
  let queryFile = false;
  let endpoint = '';
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-') || a === '-') {
      if (!endpoint) endpoint = a;
      continue;
    }
    const eq = a.indexOf('=');
    const name = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    let value;
    if (a.startsWith('--')) {
      if (eq > 0) value = a.slice(eq + 1);
      else if (GH_API_VALUE_OPTS.has(a)) { value = argv[i + 1]; i += 1; }
    } else if (a.length > 2) {
      value = a.slice(2);
    } else if (GH_API_VALUE_OPTS.has(a)) {
      value = argv[i + 1];
      i += 1;
    }
    const short = a.startsWith('--') ? name : a.slice(0, 2);
    if (short === '-X' || short === '--method') method = String(value || '').toUpperCase();
    if (short === '-f' || short === '-F' || short === '--field' || short === '--raw-field') {
      fields = true;
      if ((short === '-F' || short === '--field') && /^query=@/.test(String(value || ''))) queryFile = true;
    }
    if (short === '--input') input = true;
  }
  return { method, fields, input, queryFile, endpoint };
}

function ghApiAction(argv, start, enabled) {
  const call = ghApi(argv, start);
  const endpoint = call.endpoint.replace(/^\/+/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (endpoint === 'graphql') {
    const unseen = call.input || call.queryFile;
    const mutation = unseen || argv.some((a) => /\bmutation\b/i.test(a));
    if (!mutation) return null;
    const text = argv.join(' ');
    const klass = /merge/i.test(text) ? 'pr_merge' : /pullrequest/i.test(text) ? 'pr_create' : 'push';
    if (enabled.has(klass)) return ask('a GraphQL mutation through gh api', klass);
    if (unseen && ['push', 'pr_create', 'pr_merge'].some((k) => enabled.has(k))) return ask('a GraphQL mutation through gh api', 'push');
    return null;
  }
  const mutating = MUTATING_METHODS.has(call.method) || call.fields || call.input;
  if (!mutating) return null;
  if (/\/(reviews|comments)$/i.test(endpoint)) return null;
  let klass = null;
  if (/(^|\/)merges(\/|$)/i.test(endpoint) || /(^|\/)pulls\/[^/]+\/merge$/i.test(endpoint)) klass = 'pr_merge';
  else if (/(^|\/)pulls(\/|$)/i.test(endpoint)) klass = 'pr_create';
  else if (/(^|\/)git\/refs(\/|$)/i.test(endpoint) || /(^|\/)contents(\/|$)/i.test(endpoint)) klass = 'push';
  if (!klass || !enabled.has(klass)) return null;
  return ask(`a mutating gh api call on ${endpoint}`, klass);
}

// The first operand after argv[start], skipping options and the options that take a value.
function subcommand(argv, start, valueOpts) {
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (valueOpts.has(a)) { i += 1; continue; }
    if (a.startsWith('-')) continue;
    return { name: a, index: i };
  }
  return { name: '', index: argv.length };
}

function hasOperand(argv, from) {
  return argv.slice(from).some((a) => !a.startsWith('-'));
}

const NPM_OPTS = new Set(['--prefix', '-C', '--workspace', '-w']);
const PNPM_OPTS = new Set(['--filter', '-F', '-C', '--dir', '--workspace-root']);
const YARN_OPTS = new Set(['--cwd']);
const POETRY_OPTS = new Set(['--directory', '-C', '--project', '-P']);
const CARGO_OPTS = new Set(['--manifest-path', '-C', '--config', '-Z', '--color']);
const GO_OPTS = new Set(['-C']);
const PIP_VALUE_OPTS = new Set([
  '-r', '--requirement', '-c', '--constraint', '-t', '--target', '-i', '--index-url', '--extra-index-url',
  '-f', '--find-links', '--prefix', '--root', '--src', '--upgrade-strategy', '--python-version', '--platform',
  '--implementation', '--abi', '--cache-dir', '--log', '--proxy', '--timeout', '--retries', '--trusted-host',
  '--cert', '--client-cert', '--exists-action', '--progress-bar', '--global-option', '--config-settings', '-C',
  '--report', '--python',
]);

function pipArgs(argv) {
  if (/^pip\d?(\.\d+)?$/.test(argv[0])) return argv.slice(1);
  if (/^python\d?(\.\d+)?$/.test(argv[0]) && argv[1] === '-m' && /^pip\d?$/.test(argv[2] || '')) return argv.slice(3);
  return null;
}

// A pip install reproduces a recorded tree only when it installs from a requirements file and
// names no package beside it.
function pipFaithful(args) {
  let requirement = false;
  let packages = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-r' || a === '--requirement' || a.startsWith('--requirement=') || /^-r./.test(a)) requirement = true;
    if (PIP_VALUE_OPTS.has(a)) { i += 1; continue; }
    if (a.startsWith('-')) continue;
    packages += 1;
  }
  return requirement && packages === 0;
}

// Lockfile-faithful installs: they reproduce the recorded tree and never ask.
function lockfileFaithful(argv) {
  const word = argv[0];
  if (word === 'npm') return subcommand(argv, 1, NPM_OPTS).name === 'ci';
  if (word === 'pnpm') {
    const sub = subcommand(argv, 1, PNPM_OPTS);
    return (sub.name === 'install' || sub.name === 'i') && argv.includes('--frozen-lockfile') && !hasOperand(argv, sub.index + 1);
  }
  if (word === 'yarn') {
    const sub = subcommand(argv, 1, YARN_OPTS);
    return sub.name === 'install' && (argv.includes('--immutable') || argv.includes('--frozen-lockfile'));
  }
  const pip = pipArgs(argv);
  if (pip) return pip[0] === 'install' && pipFaithful(pip.slice(1));
  return false;
}

// The built-in dependency change a command makes, named as manager plus subcommand
// (`pnpm add`, `pip install`), or null.
function builtInDependencyChange(argv) {
  const word = argv[0];
  if (word === 'npm') {
    const sub = subcommand(argv, 1, NPM_OPTS);
    if (['install', 'i', 'add', 'in', 'isntall'].includes(sub.name)) return hasOperand(argv, sub.index + 1) ? `npm ${sub.name}` : null;
    return ['uninstall', 'un', 'remove', 'rm', 'r', 'unlink', 'update', 'up', 'upgrade', 'udpate'].includes(sub.name) ? `npm ${sub.name}` : null;
  }
  if (word === 'pnpm') {
    const sub = subcommand(argv, 1, PNPM_OPTS);
    if (['add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade'].includes(sub.name)) return `pnpm ${sub.name}`;
    if (sub.name === 'install' || sub.name === 'i') {
      return hasOperand(argv, sub.index + 1) || !argv.includes('--frozen-lockfile') ? `pnpm ${sub.name}` : null;
    }
    return null;
  }
  if (word === 'yarn') {
    const sub = subcommand(argv, 1, YARN_OPTS).name;
    return ['add', 'remove', 'up', 'upgrade'].includes(sub) ? `yarn ${sub}` : null;
  }
  const pip = pipArgs(argv);
  if (pip) return pip[0] === 'install' && !pipFaithful(pip.slice(1)) ? 'pip install' : null;
  if (word === 'poetry') return subcommand(argv, 1, POETRY_OPTS).name === 'add' ? 'poetry add' : null;
  if (word === 'cargo') {
    const rest = argv[1] && argv[1].startsWith('+') ? 2 : 1;
    return subcommand(argv, rest, CARGO_OPTS).name === 'add' ? 'cargo add' : null;
  }
  if (word === 'go') return subcommand(argv, 1, GO_OPTS).name === 'get' ? 'go get' : null;
  return null;
}

function dependencyAction(argv, manifest) {
  if (!argv.length || lockfileFaithful(argv)) return null;
  for (const prefix of manifest.approval.dependency_commands) {
    const want = String(prefix).trim().split(/\s+/).filter(Boolean);
    if (want.length && want.every((t, i) => argv[i] === t)) return want.join(' ');
  }
  return builtInDependencyChange(argv);
}

const GH_GLOBAL_VALUE_OPTS = new Set(['-R', '--repo', '--hostname']);

// gh's command path: the first two operands, with its flags (before the group and between the
// group and its subcommand) skipped. Returns the index after the second operand too.
function ghPath(argv) {
  const ops = [];
  for (let i = 1; i < argv.length && ops.length < 2; i++) {
    const a = argv[i];
    if (GH_GLOBAL_VALUE_OPTS.has(a)) { i += 1; continue; }
    if (a.startsWith('-')) continue;
    ops.push({ name: a, index: i });
  }
  return { group: ops[0] ? ops[0].name : '', sub: ops[1] ? ops[1].name : '', groupIndex: ops[0] ? ops[0].index : argv.length };
}

export function check(ctx) {
  if (ctx.tool !== 'Bash') return null;
  const enabled = new Set(ctx.manifest.approval.ask);
  for (const seg of ctx.segs) {
    const argv = seg.argv;
    const word = argv[0];
    if (!word) continue;
    if (word === 'git') {
      const sub = gitSubcommand(argv);
      const subtreePush = sub.name === 'subtree' && argv.slice(sub.index + 1).includes('push');
      if (sub.name === 'push' || subtreePush) {
        if (enabled.has('push')) return ask(subtreePush ? 'git subtree push' : 'git push', 'push');
        continue;
      }
    }
    if (word === 'gh') {
      const gh = ghPath(argv);
      if (gh.group === 'pr' && gh.sub === 'create' && enabled.has('pr_create')) return ask('gh pr create', 'pr_create');
      if (gh.group === 'pr' && gh.sub === 'merge' && enabled.has('pr_merge')) return ask('gh pr merge', 'pr_merge');
      if (gh.group === 'api') {
        const r = ghApiAction(argv, gh.groupIndex + 1, enabled);
        if (r) return r;
      }
      continue;
    }
    if (enabled.has('dependency_change')) {
      const dep = dependencyAction(argv, ctx.manifest);
      if (dep) return ask(`the dependency change ${dep}`, 'dependency_change');
    }
  }
  return null;
}

