// Tests for guards/evaluator.mjs. Run: node --test guards/*.test.mjs
// Fixtures use invented names only: example.internal, deploy-user@, port 55000, retired/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalize,
  segments,
  commandWords,
  tokens,
  hasRecursiveGrepFromRoot,
  startsWithAllowPrefix,
} from './evaluator.mjs';

const ROOT = '/work/repo';
const argvs = (cmd) => segments(cmd).map((s) => s.argv);
const kinds = (cmd) => segments(cmd).map((s) => s.kind);
const words = (cmd) => commandWords(cmd);

// normalize

test('normalize removes a backslash-newline continuation', () => {
  assert.equal(normalize('ssh \\\ndeploy-user@example.internal'), 'ssh deploy-user@example.internal');
});

test('normalize keeps a backslash-newline inside single quotes', () => {
  assert.equal(normalize("echo 'a\\\nb'"), "echo 'a\\\nb'");
});

test('normalize does not join a comment line to the next line', () => {
  assert.equal(normalize('# note \\\nssh host'), '# note \\\nssh host');
  assert.deepEqual(words('# note \\\nssh host'), ['ssh']);
});

test('a continuation splits nothing: the command word survives', () => {
  assert.deepEqual(argvs('s\\\nsh host'), [['ssh', 'host']]);
});

// quoting and escapes

test('a separator inside single quotes is argument data', () => {
  assert.deepEqual(argvs("echo 'a; ssh host'"), [['echo', 'a; ssh host']]);
});

test('separators inside double quotes are argument data', () => {
  assert.deepEqual(argvs('git commit -m "fix && ssh host | cat"'), [['git', 'commit', '-m', 'fix && ssh host | cat']]);
});

test('a backslash-escaped semicolon does not split', () => {
  assert.deepEqual(argvs('echo a\\; ssh host'), [['echo', 'a;', 'ssh', 'host']]);
});

test('adjacent quoted and unquoted parts join into one token', () => {
  assert.deepEqual(argvs(`s'sh' "deploy-user@"example.internal`), [['ssh', 'deploy-user@example.internal']]);
});

test('an escaped command word resolves to the plain word', () => {
  assert.deepEqual(words('\\ssh host'), ['ssh']);
});

test('double quotes resolve backslash escapes of quote, dollar and backslash only', () => {
  assert.deepEqual(argvs('echo "a\\"b\\$c\\\\d\\e"'), [['echo', 'a"b$c\\d\\e']]);
});

test('an unterminated single quote closes at end of input', () => {
  assert.deepEqual(argvs("echo 'abc; ls"), [['echo', 'abc; ls']]);
});

test('an unterminated double quote closes at end of input', () => {
  assert.deepEqual(argvs('cat "retired/notes.md'), [['cat', 'retired/notes.md']]);
});

test('ANSI-C quoting decodes hex escapes in the command word', () => {
  assert.deepEqual(words("$'\\x73sh' host"), ['ssh']);
});

test('a locale string $"..." reads as a double-quoted string', () => {
  assert.deepEqual(argvs('echo $"a b"'), [['echo', 'a b']]);
});

test('empty and blank commands give no segments', () => {
  assert.deepEqual(segments(''), []);
  assert.deepEqual(segments('   \n\t '), []);
});

test('non-string input gives no segments and does not throw', () => {
  assert.deepEqual(segments(undefined), []);
  assert.deepEqual(segments(null), []);
});

test('a comment is not a command', () => {
  assert.deepEqual(argvs('echo hi # ssh host'), [['echo', 'hi']]);
});

test('a hash inside a word is literal', () => {
  assert.deepEqual(argvs('echo a#b'), [['echo', 'a#b']]);
});

// separators

test('semicolon splits with kind seq', () => {
  assert.deepEqual(argvs('ls; ssh host'), [['ls'], ['ssh', 'host']]);
  assert.deepEqual(kinds('ls; ssh host'), ['top', 'seq']);
});

test('&& splits with kind and', () => {
  assert.deepEqual(kinds('make && ssh host'), ['top', 'and']);
});

test('|| splits with kind or', () => {
  assert.deepEqual(kinds('make || ssh host'), ['top', 'or']);
});

test('a pipe splits with kind pipe', () => {
  assert.deepEqual(argvs('cat a | grep b'), [['cat', 'a'], ['grep', 'b']]);
  assert.deepEqual(kinds('cat a | grep b'), ['top', 'pipe']);
});

test('|& is a pipe', () => {
  assert.deepEqual(kinds('make |& tee log'), ['top', 'pipe']);
});

test('a background & splits with kind seq', () => {
  assert.deepEqual(argvs('sleep 1 & ssh host'), [['sleep', '1'], ['ssh', 'host']]);
  assert.deepEqual(kinds('sleep 1 & ssh host'), ['top', 'seq']);
});

test('a newline splits with kind seq', () => {
  assert.deepEqual(argvs('ls\nssh host'), [['ls'], ['ssh', 'host']]);
  assert.deepEqual(kinds('ls\n\nssh host'), ['top', 'seq']);
});

test('a pipe followed by a newline keeps kind pipe', () => {
  assert.deepEqual(kinds('cat a |\n  grep b'), ['top', 'pipe']);
});

test('indexes run in order and raw holds each segment source', () => {
  const segs = segments('ls -la ;  cat  a.txt|wc -l');
  assert.deepEqual(segs.map((s) => s.index), [0, 1, 2]);
  assert.deepEqual(segs.map((s) => s.raw), ['ls -la', 'cat  a.txt', 'wc -l']);
});

test('every segment carries exactly the contract fields', () => {
  for (const seg of segments('FOO=1 cat a > b | (ls) && $(pwd)')) {
    assert.deepEqual(Object.keys(seg).sort(), ['argv', 'depth', 'index', 'kind', 'raw', 'rawArgv', 'redirects']);
  }
});

// subshells and substitutions

test('a parenthesized subshell gives a placeholder then its contents one level deeper', () => {
  const segs = segments('(cd retired && cat a) | grep x');
  assert.deepEqual(segs.map((s) => s.argv), [[], ['cd', 'retired'], ['cat', 'a'], ['grep', 'x']]);
  assert.deepEqual(segs.map((s) => s.kind), ['top', 'subshell', 'and', 'pipe']);
  assert.deepEqual(segs.map((s) => s.depth), [0, 1, 1, 0]);
  assert.equal(segs[0].raw, '(cd retired && cat a)');
});

test('$( ) opens a substitution evaluated before its command', () => {
  const segs = segments('echo $(cat retired/a)');
  assert.deepEqual(segs.map((s) => s.argv), [['cat', 'retired/a'], ['echo', '$(cat retired/a)']]);
  assert.deepEqual(segs.map((s) => [s.kind, s.depth]), [['substitution', 1], ['top', 0]]);
});

test('backticks open a substitution', () => {
  const segs = segments('echo `ssh host`');
  assert.equal(segs[0].kind, 'substitution');
  assert.deepEqual(segs[0].argv, ['ssh', 'host']);
});

test('an escaped backtick inside backticks stays inner data', () => {
  assert.deepEqual(argvs('echo `echo \\`date\\``')[0], ['date']);
});

test('nested substitutions nest their depth', () => {
  const segs = segments('echo $(echo $(cat retired/a))');
  assert.deepEqual(segs.map((s) => [s.argv[0], s.depth]), [['cat', 2], ['echo', 1], ['echo', 0]]);
});

test('a substitution inside double quotes is opened', () => {
  assert.deepEqual(words('echo "value: $(cat .env)"'), ['cat', 'echo']);
});

test('a separator inside a substitution splits only inside it', () => {
  const segs = segments('echo $(ls; ssh host) done');
  assert.deepEqual(segs.map((s) => s.argv[0]), ['ls', 'ssh', 'echo']);
  assert.deepEqual(segs.map((s) => s.kind), ['substitution', 'seq', 'top']);
  assert.deepEqual(segs[2].argv, ['echo', '$(ls; ssh host)', 'done']);
});

test('a pipe inside a substitution keeps kind pipe at the inner depth', () => {
  const segs = segments('echo $(ls retired | head)');
  assert.deepEqual(segs.map((s) => [s.argv[0], s.kind, s.depth]), [['ls', 'substitution', 1], ['head', 'pipe', 1], ['echo', 'top', 0]]);
});

test('arithmetic expansion is not a command', () => {
  assert.deepEqual(argvs('echo $((1 + 2))'), [['echo', '$((1 + 2))']]);
});

test('a substitution inside arithmetic is still opened', () => {
  assert.deepEqual(words('echo $(( $(wc -l < f) + 1 ))'), ['wc', 'echo']);
});

test('process substitution opens both sides', () => {
  assert.deepEqual(words('diff <(cat a) <(cat b)'), ['cat', 'cat', 'diff']);
});

test('a substitution inside a parameter expansion is opened', () => {
  assert.deepEqual(words('echo ${X:-$(cat .env)}'), ['cat', 'echo']);
});

test('an unterminated substitution closes at end of input', () => {
  assert.deepEqual(words('echo $(cat retired/a'), ['cat', 'echo']);
});

// heredocs

test('a heredoc body is data, not commands', () => {
  const segs = segments('cat <<EOF > notes.txt\nssh deploy-user@example.internal\nEOF');
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0].argv, ['cat']);
  assert.deepEqual(segs[0].redirects, [{ op: '<<', target: 'EOF' }, { op: '>', target: 'notes.txt' }]);
  assert.equal(segs[0].raw, 'cat <<EOF > notes.txt');
});

test('a quoted heredoc delimiter keeps substitutions in the body as data', () => {
  const segs = segments("cat <<'EOF'\n$(ssh host)\nEOF");
  assert.deepEqual(segs.map((s) => s.argv), [['cat']]);
  assert.deepEqual(segs[0].redirects, [{ op: '<<', target: 'EOF' }]);
});

test('an unquoted heredoc body has its substitutions opened', () => {
  assert.deepEqual(words('cat <<EOF\nplain line\n$(cat .env)\nEOF'), ['cat', 'cat']);
});

test('<<- matches a tab-indented delimiter', () => {
  assert.deepEqual(argvs('cat <<-END\n\tssh host\n\tEND\nls'), [['cat'], ['ls']]);
});

test('commands after the heredoc delimiter are parsed', () => {
  assert.deepEqual(words('cat <<EOF | grep x\nbody\nEOF\nssh host'), ['cat', 'grep', 'ssh']);
});

test('two heredocs on one line are both read as data', () => {
  assert.deepEqual(words('cat <<A <<B\nssh one\nA\nssh two\nB\nls'), ['cat', 'ls']);
});

test('a here-string is a word, not a command', () => {
  const segs = segments('grep x <<< "ssh host; ls"');
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0].redirects, [{ op: '<<<', target: 'ssh host; ls' }]);
});

test('a heredoc fed to a shell is parsed as that shell runs it', () => {
  const segs = segments("bash <<'EOF'\nssh host\nEOF");
  assert.deepEqual(segs.map((s) => [s.argv[0], s.kind, s.depth]), [['bash', 'top', 0], ['ssh', 'wrapper', 1]]);
});

test('an unterminated heredoc never throws and swallows the rest as data', () => {
  assert.deepEqual(words('cat <<EOF\nssh host'), ['cat']);
});

// redirections

test('an input redirection keeps its target out of argv', () => {
  const [seg] = segments('cat < .env');
  assert.deepEqual(seg.argv, ['cat']);
  assert.deepEqual(seg.redirects, [{ op: '<', target: '.env' }]);
});

test('output and append redirections', () => {
  const [seg] = segments('echo x > out.txt >> log.txt');
  assert.deepEqual(seg.redirects, [{ op: '>', target: 'out.txt' }, { op: '>>', target: 'log.txt' }]);
});

test('file descriptor redirections keep their descriptor', () => {
  const [seg] = segments('make 2> err.txt 2>&1 >&2');
  assert.deepEqual(seg.argv, ['make']);
  assert.deepEqual(seg.redirects, [{ op: '2>', target: 'err.txt' }, { op: '2>&', target: '1' }, { op: '>&', target: '2' }]);
});

test('&> and >| redirections', () => {
  const [seg] = segments('make &> all.log >| forced.txt');
  assert.deepEqual(seg.redirects, [{ op: '&>', target: 'all.log' }, { op: '>|', target: 'forced.txt' }]);
});

test('a glued redirection target and a quoted target', () => {
  const [seg] = segments('echo x >out.txt 2>"my errors.txt"');
  assert.deepEqual(seg.redirects, [{ op: '>', target: 'out.txt' }, { op: '2>', target: 'my errors.txt' }]);
});

test('a redirection before the command word', () => {
  assert.deepEqual(argvs('> out.txt cat a'), [['cat', 'a']]);
});

test('a redirection-only command has an empty argv', () => {
  const [seg] = segments('> .env');
  assert.deepEqual(seg.argv, []);
  assert.deepEqual(seg.redirects, [{ op: '>', target: '.env' }]);
});

test('a digit glued to a word is an argument, not a descriptor', () => {
  const [seg] = segments('echo a2>out');
  assert.deepEqual(seg.argv, ['echo', 'a2']);
  assert.deepEqual(seg.redirects, [{ op: '>', target: 'out' }]);
});

// variable prefixes and wrappers

test('variable assignment prefixes are stripped from command position', () => {
  const [seg] = segments("FOO=1 BAR='a b' ssh host");
  assert.deepEqual(seg.argv, ['ssh', 'host']);
  assert.deepEqual(seg.rawArgv, ['FOO=1', 'BAR=a b', 'ssh', 'host']);
});

test('a quoted word that looks like an assignment is a command word', () => {
  assert.deepEqual(words('"FOO=1" ssh'), ['FOO=1']);
});

test('a bare assignment has an empty argv', () => {
  assert.deepEqual(argvs('FOO=1'), [[]]);
});

test('sudo with flags is stripped', () => {
  assert.deepEqual(argvs('sudo -u root -E -n ssh host'), [['ssh', 'host']]);
  assert.deepEqual(argvs('sudo --user=root -- cat .env'), [['cat', '.env']]);
});

test('env with options and VAR=val arguments is stripped', () => {
  assert.deepEqual(argvs('env -i -u HOME FOO=1 BAR=2 ssh host'), [['ssh', 'host']]);
});

test('env -S splits its string into the command', () => {
  assert.deepEqual(argvs("env -S 'ssh host' extra"), [['ssh', 'host', 'extra']]);
});

test('exec, nice, nohup and time are stripped', () => {
  assert.deepEqual(words('exec -a name ssh host'), ['ssh']);
  assert.deepEqual(words('nice -n 10 ssh host'), ['ssh']);
  assert.deepEqual(words('nice -5 ssh host'), ['ssh']);
  assert.deepEqual(words('nohup ssh host'), ['ssh']);
  assert.deepEqual(words('time -p ssh host'), ['ssh']);
});

test('command and builtin are stripped unless they only look a name up', () => {
  assert.deepEqual(words('command ssh host'), ['ssh']);
  assert.deepEqual(words('command -p ssh host'), ['ssh']);
  assert.deepEqual(words('builtin cd retired'), ['cd']);
  assert.deepEqual(argvs('command -v ssh'), [['command', '-v', 'ssh']]);
});

test('timeout with a duration and options is stripped', () => {
  assert.deepEqual(argvs('timeout 5 ssh host'), [['ssh', 'host']]);
  assert.deepEqual(argvs('timeout -s KILL -k 2 5s ssh host'), [['ssh', 'host']]);
  assert.deepEqual(argvs('timeout --signal=KILL --preserve-status 1m ssh host'), [['ssh', 'host']]);
});

test('xargs with its argument-taking flags is stripped', () => {
  assert.deepEqual(argvs('xargs -0 -r -n 1 -I X -P 4 cat X'), [['cat', 'X']]);
  assert.deepEqual(argvs('xargs -n1 -I{} cat {}'), [['cat', '{}']]);
});

test('stacked wrappers and an absolute client path strip to the client', () => {
  assert.deepEqual(words('sudo env A=1 timeout 3 nice -n 2 nohup /usr/bin/ssh host'), ['ssh']);
});

test('a wrapper with nothing after it stays the command word', () => {
  assert.deepEqual(words('sudo -v'), ['sudo']);
  assert.deepEqual(words('ls | xargs'), ['ls', 'xargs']);
  assert.deepEqual(words('env'), ['env']);
});

test('reserved words before a command are stripped', () => {
  assert.deepEqual(argvs('if ssh host; then cat a; fi'), [['ssh', 'host'], ['cat', 'a'], []]);
  assert.deepEqual(argvs('{ cat a; }'), [['cat', 'a'], []]);
  assert.deepEqual(words('! ssh host'), ['ssh']);
});

// directory prefixes and paths

test('an absolute path to a client strips to its name', () => {
  assert.deepEqual(words('/usr/bin/ssh host'), ['ssh']);
  assert.deepEqual(segments('/usr/bin/ssh host')[0].rawArgv[0], '/usr/bin/ssh');
});

test('a quoted Windows-style path strips to the client name without .exe', () => {
  assert.deepEqual(words('"C:\\Tools\\OpenSSH\\ssh.exe" host'), ['ssh']);
  assert.deepEqual(words("'D:\\bin\\scp.EXE' a b"), ['scp']);
});

test('relative and home-relative paths strip to the name', () => {
  assert.deepEqual(words('./bin/tool --flag'), ['tool']);
  assert.deepEqual(words('~/bin/ssh host'), ['ssh']);
  assert.deepEqual(words('"$HOME"/bin/ssh host'), ['ssh']);
});

// sh -c and relatives

test('sh -c parses its string as wrapper segments one level deeper', () => {
  const segs = segments("sh -c 'cat retired/a; ls'");
  assert.deepEqual(segs.map((s) => [s.argv[0], s.kind, s.depth]), [['sh', 'top', 0], ['cat', 'wrapper', 1], ['ls', 'seq', 1]]);
});

test('bash -lc, bash -c, zsh -c and dash -c recurse', () => {
  assert.deepEqual(words('bash -lc "ssh host"'), ['bash', 'ssh']);
  assert.deepEqual(words("bash -c 'ssh host'"), ['bash', 'ssh']);
  assert.deepEqual(words("zsh -c 'ssh host'"), ['zsh', 'ssh']);
  assert.deepEqual(words("dash -c 'ssh host'"), ['dash', 'ssh']);
});

test('shell options before -c are skipped', () => {
  assert.deepEqual(words("bash -o pipefail -e -c 'ssh host'"), ['bash', 'ssh']);
});

test('eval parses its arguments as a command', () => {
  const segs = segments("eval 'ssh host; ls'");
  assert.deepEqual(segs.map((s) => [s.argv[0], s.kind]), [['eval', 'top'], ['ssh', 'wrapper'], ['ls', 'seq']]);
});

test('a wrapper shell under sudo recurses', () => {
  assert.deepEqual(words("sudo -u root bash -c 'ssh host'"), ['bash', 'ssh']);
});

test('nested shell strings recurse with growing depth', () => {
  const segs = segments(`sh -c "bash -c 'ssh host'"`);
  assert.deepEqual(segs.map((s) => [s.argv[0], s.depth]), [['sh', 0], ['bash', 1], ['ssh', 2]]);
});

test('a shell running a script file does not recurse', () => {
  assert.deepEqual(words('bash scripts/build.sh ssh'), ['bash']);
});

test('xargs into sh -c recurses', () => {
  assert.deepEqual(words("ls | xargs -I{} sh -c 'cat {}'"), ['ls', 'sh', 'cat']);
});

test('su -c recurses', () => {
  assert.deepEqual(words("su -c 'ssh host' root"), ['su', 'ssh']);
});

test('a here-string fed to a shell is parsed as a command', () => {
  assert.deepEqual(words("bash <<< 'ssh host'"), ['bash', 'ssh']);
});

// commandWords and tokens

test('commandWords lists argv[0] of every segment with a command', () => {
  assert.deepEqual(words('FOO=1 git -c a=b push && (ls) | > out'), ['git', 'ls']);
});

test('tokens flattens every argv token', () => {
  assert.deepEqual(tokens('gh pr create -ftitle=x; ssh -p 55000 example.internal'), ['gh', 'pr', 'create', '-ftitle=x', 'ssh', '-p', '55000', 'example.internal']);
});

// hasRecursiveGrepFromRoot

test('recursive grep from . is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret .', ROOT), true);
});

test('recursive grep with no target defaults to . and is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret', ROOT), true);
});

test('recursive grep over * and ./* is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -R secret *', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret ./*', ROOT), true);
});

test('recursive grep over $PWD in any spelling is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep --recursive secret $PWD', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret "${PWD}/"', ROOT), true);
});

test('recursive grep over $(pwd) is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret "$(pwd)"', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret "$(pwd)/"', ROOT), true);
});

test('recursive grep over a backtick pwd is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret `pwd`', ROOT), true);
});

test('recursive grep over the git top level is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret "$(git rev-parse --show-toplevel)"', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret `git rev-parse --show-toplevel`', ROOT), true);
});

test('recursive grep over $CLAUDE_PROJECT_DIR in any spelling is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret $CLAUDE_PROJECT_DIR', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret "${CLAUDE_PROJECT_DIR}/"', ROOT), true);
});

test('recursive grep over ~+ is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret ~+', ROOT), true);
});

test('recursive grep over a subfolder of a root spelling is allowed', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret "$(pwd)/src"', ROOT), false);
  assert.equal(hasRecursiveGrepFromRoot('grep -rn secret $CLAUDE_PROJECT_DIR/src', ROOT), false);
});

test('recursive grep over the root path or a parent is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret /work/repo', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret /WORK/Repo/', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret ..', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret /', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret src/..', ROOT), true);
});

test('recursive grep over a subfolder is allowed', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret src', ROOT), false);
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret src/* docs', ROOT), false);
  assert.equal(hasRecursiveGrepFromRoot('grep -r -e pat src lib', ROOT), false);
});

test('a non-recursive grep from the root is allowed', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep secret .', ROOT), false);
  assert.equal(hasRecursiveGrepFromRoot('grep -e r -n secret .', ROOT), false);
  assert.equal(hasRecursiveGrepFromRoot('grep -erfoo .', ROOT), false);
});

test('-d recurse and --directories=recurse count as recursive', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -d recurse secret .', ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('grep --directories=recurse secret .', ROOT), true);
});

test('recursive grep inside a wrapper or after a separator is caught', () => {
  assert.equal(hasRecursiveGrepFromRoot("ls && bash -c 'egrep -ri secret .'", ROOT), true);
  assert.equal(hasRecursiveGrepFromRoot('sudo /usr/bin/grep -r secret .', ROOT), true);
});

test('rg and grep in a commit message are not recursive grep', () => {
  assert.equal(hasRecursiveGrepFromRoot('rg secret .', ROOT), false);
  assert.equal(hasRecursiveGrepFromRoot('git commit -m "grep -r secret ."', ROOT), false);
});

test('recursive grep on a Windows-style root is compared case-insensitively', () => {
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret "C:\\Work\\Repo"', 'c:\\work\\repo'), true);
  assert.equal(hasRecursiveGrepFromRoot('grep -r secret "C:\\Work\\Repo\\src"', 'c:\\work\\repo'), false);
});

// startsWithAllowPrefix

test('the allow prefix at the start of the command is seen', () => {
  assert.equal(startsWithAllowPrefix('CHECKREIN_ALLOW_PROTECTED=1 cat retired/a.md', 'CHECKREIN_ALLOW_PROTECTED'), true);
});

test('the allow prefix later in the command is not seen', () => {
  assert.equal(startsWithAllowPrefix('ls; CHECKREIN_ALLOW_PROTECTED=1 cat retired/a.md', 'CHECKREIN_ALLOW_PROTECTED'), false);
});

test('the allow prefix after leading blanks is not seen', () => {
  const name = 'CHECKREIN_ALLOW_PROTECTED';
  assert.equal(startsWithAllowPrefix(`  ${name}=1 cat retired/a.md`, name), false);
  assert.equal(startsWithAllowPrefix(`\t${name}=1 cat retired/a.md`, name), false);
});

test('only the value 1 followed by a space counts', () => {
  const name = 'CHECKREIN_ALLOW_PROTECTED';
  assert.equal(startsWithAllowPrefix(`${name}=0 cat retired/a.md`, name), false);
  assert.equal(startsWithAllowPrefix(`${name}=10 cat retired/a.md`, name), false);
  assert.equal(startsWithAllowPrefix(`${name}=1`, name), false);
  assert.equal(startsWithAllowPrefix(`OTHER=1 cat retired/a.md`, name), false);
  assert.equal(startsWithAllowPrefix(undefined, name), false);
});

test('the allow prefix is an assignment and leaves the command word', () => {
  assert.deepEqual(words('CHECKREIN_ALLOW_PROTECTED=1 cat retired/a.md'), ['cat']);
});

// robustness

test('malformed input never throws', () => {
  const samples = ['(((', ')))', '$(', '`', "'", '"', '<<', '<<<', '>&', '|||', ';;;', '&&&', '$((', '${', 'a\\', '<(', 'cat <<', '((1+', 'f() { ls; }'];
  for (const s of samples) assert.ok(Array.isArray(segments(s)), s);
});

test('a deterministic fuzz of shell punctuation never throws', () => {
  const alphabet = ['a', ' ', '"', "'", '\\', '$', '(', ')', '`', ';', '&', '|', '<', '>', '\n', '#', '{', '}', '-c', 'sh', '='];
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  for (let n = 0; n < 2000; n++) {
    let s = '';
    const len = rand() % 30;
    for (let i = 0; i < len; i++) s += alphabet[rand() % alphabet.length];
    const segs = segments(s);
    assert.ok(Array.isArray(segs), JSON.stringify(s));
    for (const seg of segs) assert.ok(Array.isArray(seg.argv) && typeof seg.raw === 'string');
  }
});

test('deep nesting does not throw and still exposes the inner command word', () => {
  assert.ok(words('$('.repeat(5000) + 'ssh host' + ')'.repeat(5000)).includes('ssh'));
  assert.ok(Array.isArray(segments("sh -c '".repeat(200) + 'ls')));
});

test('a non-ASCII dash in input is ordinary word data', () => {
  const dash = String.fromCharCode(0x2014);
  assert.deepEqual(argvs(`echo a${dash}b`), [['echo', `a${dash}b`]]);
});

test('no fixture in this file contains the em dash character', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  assert.equal(source.includes(String.fromCharCode(0x2014)), false);
});
