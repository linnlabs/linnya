import {
  COMMAND_APPROVAL_MAX_TOKEN_COUNT,
  SHELL_COMMAND_MAX_LENGTH,
  countShellCommandCharacters,
} from '@app/schemas/commands';

import type { SimpleCommandOneTimeReason } from '../definitions/simpleCommand';

const EXECUTION_WRAPPER_COMMANDS = new Set([
  '-', '.', 'arch', 'builtin', 'command', 'coproc', 'env', 'eval', 'exec', 'icm',
  'iex', 'invoke-command', 'invoke-expression', 'nice', 'nocorrect', 'noglob',
  'nohup', 'repeat', 'sajb', 'saps', 'source', 'start', 'start-job', 'start-process',
  'start-threadjob', 'sudo', 'time', 'wsl', 'xargs',
]);
const SHELL_COMMAND_NAMES = new Set([
  'bash', 'cmd', 'dash', 'fish', 'ksh', 'powershell', 'pwsh', 'sh', 'zsh',
]);
const SHELL_DYNAMIC_FLAGS = new Set([
  '-c', '-command', '-commandwithargs', '-e', '-ec', '-encodedcommand', '-lc', '/c', '/k',
]);
const INTERPRETER_DYNAMIC_FLAGS = new Set([
  '--eval', '--print', '-e', '-p', '-r', '-c', '-', 'eval',
]);
const INTERPRETER_NAME_PATTERN = /^(?:bun|deno|julia|lua|node|nodejs|osascript|perl|php|py|pypy|python|pythonw|pyw|rscript|ruby)(?:\d+(?:\.\d+)*)?$/u;
const INTERPRETER_ATTACHED_SHORT_FLAGS: Readonly<Record<string, readonly string[]>> = {
  bun: ['-e', '-p'],
  node: ['-e', '-p'],
  nodejs: ['-e', '-p'],
  osascript: ['-e'],
  perl: ['-e'],
  php: ['-r'],
  py: ['-c'],
  pypy: ['-c'],
  python: ['-c'],
  pythonw: ['-c'],
  pyw: ['-c'],
  ruby: ['-e'],
};

export type RememberableSimpleCommandPrefixValidation =
  | {
      readonly status: 'rememberable';
    }
  | {
      readonly status: 'one_time_only';
      readonly reason: Extract<
        SimpleCommandOneTimeReason,
        'candidate_too_large' | 'unsafe_prefix'
      >;
    };

function commandName(token: string): string {
  const normalized = token.replace(/\\/gu, '/');
  return normalized
    .slice(normalized.lastIndexOf('/') + 1)
    .toLowerCase()
    .replace(/\.(?:bat|cmd|exe)$/u, '');
}

function interpreterFamily(executable: string): string {
  return executable.replace(/\d+(?:\.\d+)*$/u, '');
}

function isShellDynamicArgument(executable: string, argument: string): boolean {
  if (SHELL_DYNAMIC_FLAGS.has(argument)) {
    return true;
  }
  if (executable === 'cmd') {
    return /^\/[ck].+/u.test(argument);
  }

  return [...SHELL_DYNAMIC_FLAGS].some(flag => (
    argument.startsWith(`${flag}:`) || argument.startsWith(`${flag}=`)
  ));
}

function isInterpreterDynamicArgument(executable: string, argument: string): boolean {
  if (INTERPRETER_DYNAMIC_FLAGS.has(argument)) {
    return true;
  }
  if (argument.startsWith('--eval=') || argument.startsWith('--print=')) {
    return true;
  }

  const family = interpreterFamily(executable);
  return (INTERPRETER_ATTACHED_SHORT_FLAGS[family] ?? []).some(flag => (
    argument.startsWith(flag) && argument.length > flag.length
  ));
}

/**
 * derive 和持久批准 matcher 必须共享同一条业务门。这样旧版本留下的 schema 合法、
 * 但过宽的 executable-only 前缀不会在重启后重新获得授权能力。
 */
export function validateRememberableSimpleCommandPrefix(
  tokens: readonly string[],
): RememberableSimpleCommandPrefixValidation {
  if (
    tokens.length > COMMAND_APPROVAL_MAX_TOKEN_COUNT
    || tokens.reduce(
      (length, token) => length + countShellCommandCharacters(token),
      0,
    )
      > SHELL_COMMAND_MAX_LENGTH
  ) {
    return { status: 'one_time_only', reason: 'candidate_too_large' };
  }
  if (
    tokens.length < 2
    || tokens[0].length === 0
    || tokens.some(token => token.includes('\0'))
  ) {
    return { status: 'one_time_only', reason: 'unsafe_prefix' };
  }

  const executable = commandName(tokens[0]);
  if (EXECUTION_WRAPPER_COMMANDS.has(executable)) {
    return { status: 'one_time_only', reason: 'unsafe_prefix' };
  }

  const argumentsAfterExecutable = tokens.slice(1).map(token => token.toLowerCase());
  if (
    SHELL_COMMAND_NAMES.has(executable)
    && argumentsAfterExecutable.some(token => isShellDynamicArgument(executable, token))
  ) {
    return { status: 'one_time_only', reason: 'unsafe_prefix' };
  }
  if (
    INTERPRETER_NAME_PATTERN.test(executable)
    && argumentsAfterExecutable.some(token => isInterpreterDynamicArgument(executable, token))
  ) {
    return { status: 'one_time_only', reason: 'unsafe_prefix' };
  }

  return { status: 'rememberable' };
}
