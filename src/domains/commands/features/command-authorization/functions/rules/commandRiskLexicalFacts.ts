import type {
  CommandRiskLexicalScan,
  CommandRiskLexicalSegment,
} from '../../definitions/commandRiskRule';

const ZSH_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/u;
const WINDOWS_EXECUTABLE_SUFFIX = /\.(?:exe|cmd|bat|com)$/iu;
const RISK_RELEVANT_EXECUTABLES = new Set([
  'bash', 'bunx', 'clear-disk', 'cmd', 'cmd.exe', 'cp', 'curl', 'curl.exe', 'dd',
  'del', 'diskutil', 'doas', 'erase', 'find', 'format', 'format-volume', 'git',
  'initialize-disk', 'invoke-expression', 'invoke-restmethod', 'invoke-webrequest',
  'irm', 'iwr', 'launchctl', 'mkfs', 'move-item', 'mv', 'npx', 'npx.cmd',
  'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'rd', 'reboot',
  'remove-item', 'remove-partition', 'rename-item', 'restart-computer', 'ri',
  'rm', 'rmdir', 'rsync', 'scp', 'scp.exe', 'shutdown', 'shutdown.exe', 'sh',
  'start-bitstransfer', 'start-process', 'stop-computer', 'stop-service', 'sudo',
  'unlink', 'uvx', 'wget', 'zsh',
]);
const MAX_KNOWN_WRAPPER_DEPTH = 8;

function isKnownWrapper(params: {
  readonly executable: string;
  readonly platform: 'macos' | 'windows';
  readonly shellSemantics: CommandRiskLexicalSegment['shellSemantics'];
}): boolean {
  if (params.platform === 'windows') {
    return params.executable === 'cmd'
      || (params.shellSemantics === 'cmd' && params.executable === 'call');
  }
  return [
    'env', 'sudo', 'doas', 'command', 'builtin', 'nohup', 'exec', 'time',
    'noglob', 'nice', 'xargs',
  ].includes(params.executable);
}

function executableLookupKey(
  token: string,
  platform: 'macos' | 'windows',
  shellSemantics?: CommandRiskLexicalSegment['shellSemantics'],
): string {
  const pathParts = token.split(platform === 'windows' ? /[\\/]/u : '/');
  const rawBase = pathParts[pathParts.length - 1] ?? token;
  // cmd 的 @ 只关闭当前命令回显，不改变实际 executable；不剥离其他 Shell 的 @。
  const base = (shellSemantics === 'cmd' ? rawBase.replace(/^@+/u, '') : rawBase)
    .toLocaleLowerCase('en-US');
  return platform === 'windows' ? base.replace(WINDOWS_EXECUTABLE_SUFFIX, '') : base;
}

function skipOptionsWithoutValues(tokens: readonly string[], start: number): number {
  let index = start;
  while (index < tokens.length && tokens[index].startsWith('-')) index += 1;
  return index;
}

function skipExecOptions(tokens: readonly string[], start: number): number {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--') return index + 1;
    if (!token.startsWith('-')) return index;
    index += token === '-a' ? 2 : 1;
  }
  return index;
}

function skipSudoOptions(tokens: readonly string[], start: number): number {
  const optionsWithValue = new Set([
    '-C', '--close-from', '-D', '--chdir', '-g', '--group', '-h', '--host',
    '-p', '--prompt', '-R', '--chroot', '-r', '--role', '-t', '--type', '-u',
    '--user',
  ]);
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--') return index + 1;
    if (!token.startsWith('-')) return index;
    if (optionsWithValue.has(token)) index += 1;
    index += 1;
  }
  return index;
}

function skipEnvPrefix(tokens: readonly string[], start: number): number {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--') return index + 1;
    if (token === '-u' || token === '--unset' || token === '-S' || token === '--split-string') {
      index += 2;
      continue;
    }
    if (token.startsWith('-') || ZSH_ASSIGNMENT.test(token)) {
      index += 1;
      continue;
    }
    return index;
  }
  return index;
}

function findXargsCommand(tokens: readonly string[], start: number): number {
  for (let index = start; index < tokens.length; index += 1) {
    if (RISK_RELEVANT_EXECUTABLES.has(executableLookupKey(tokens[index], 'macos'))) {
      return index;
    }
  }
  return tokens.length;
}

/**
 * wrapper 只影响“真正执行的是哪个字面量命令”，不能抹掉原 segment。系统提权等
 * 规则仍会检查 originalTokens，其他规则使用 executableTokens 看穿常见 wrapper。
 */
export function commandSegmentFacts(
  segment: CommandRiskLexicalSegment,
  platform: 'macos' | 'windows',
): {
  readonly originalTokens: readonly string[];
  readonly executableTokens: readonly string[];
  readonly executable: string;
  readonly wrappers: readonly string[];
  readonly shellSemantics: CommandRiskLexicalSegment['shellSemantics'];
  readonly analysisStatus: 'complete' | 'known_wrapper_depth_exceeded';
} {
  const tokens = segment.tokens;
  const wrappers: string[] = [];
  let index = 0;
  let shellSemantics = segment.shellSemantics;
  if (platform === 'macos') {
    while (index < tokens.length && ZSH_ASSIGNMENT.test(tokens[index])) index += 1;
  }

  for (let depth = 0; depth < MAX_KNOWN_WRAPPER_DEPTH && index < tokens.length; depth += 1) {
    const executable = executableLookupKey(tokens[index], platform, shellSemantics);
    if (platform === 'windows' && executable === 'cmd') {
      wrappers.push(executable);
      shellSemantics = 'cmd';
      const commandSwitch = tokens.findIndex(
        (token, currentIndex) => currentIndex > index && /^\/(?:c|k)$/iu.test(token),
      );
      if (commandSwitch < 0 || commandSwitch + 1 >= tokens.length) break;
      index = commandSwitch + 1;
      continue;
    }
    if (platform === 'windows' && shellSemantics === 'cmd' && executable === 'call') {
      wrappers.push(executable);
      index += 1;
      continue;
    }
    if (platform === 'macos' && executable === 'env') {
      wrappers.push(executable);
      index = skipEnvPrefix(tokens, index + 1);
      continue;
    }
    if (platform === 'macos' && (executable === 'sudo' || executable === 'doas')) {
      wrappers.push(executable);
      index = skipSudoOptions(tokens, index + 1);
      continue;
    }
    if (
      platform === 'macos'
      && (executable === 'command' || executable === 'builtin' || executable === 'nohup')
    ) {
      wrappers.push(executable);
      index = skipOptionsWithoutValues(tokens, index + 1);
      continue;
    }
    if (platform === 'macos' && executable === 'exec') {
      wrappers.push(executable);
      index = skipExecOptions(tokens, index + 1);
      continue;
    }
    if (platform === 'macos' && (executable === 'time' || executable === 'noglob')) {
      wrappers.push(executable);
      index = skipOptionsWithoutValues(tokens, index + 1);
      continue;
    }
    if (platform === 'macos' && executable === 'nice') {
      wrappers.push(executable);
      index += 1;
      if (tokens[index] === '-n') index += 2;
      else if (tokens[index] && /^-\d+$/u.test(tokens[index])) index += 1;
      continue;
    }
    if (platform === 'macos' && executable === 'xargs') {
      wrappers.push(executable);
      index = findXargsCommand(tokens, index + 1);
      continue;
    }
    break;
  }

  const nextExecutable = index < tokens.length
    ? executableLookupKey(tokens[index], platform, shellSemantics)
    : '';
  // 深度上限用于约束分析成本，不能把仍待展开的已知 wrapper 当成普通命令放行。
  // 只有封闭列表里的 wrapper 才触发失败关闭，未知 CLI 仍按自己的字面语义参与规则判断。
  const analysisStatus = wrappers.length >= MAX_KNOWN_WRAPPER_DEPTH && isKnownWrapper({
    executable: nextExecutable,
    platform,
    shellSemantics,
  })
    ? 'known_wrapper_depth_exceeded' as const
    : 'complete' as const;
  const executableTokens = tokens.slice(index);
  return {
    originalTokens: tokens,
    executableTokens,
    executable: executableTokens.length > 0
      ? executableLookupKey(executableTokens[0], platform, shellSemantics)
      : '',
    wrappers,
    shellSemantics,
    analysisStatus,
  };
}

export function allCommandFacts(scan: CommandRiskLexicalScan): readonly ReturnType<
  typeof commandSegmentFacts
>[] {
  return scan.segments.map(segment => commandSegmentFacts(segment, scan.platform));
}

export function hasFlag(tokens: readonly string[], ...flags: readonly string[]): boolean {
  const normalizedFlags = new Set(flags.map(flag => flag.toLocaleLowerCase('en-US')));
  return tokens.some(token => {
    const normalized = token.toLocaleLowerCase('en-US');
    return normalizedFlags.has(normalized)
      || [...normalizedFlags].some(flag => {
        if (flag.startsWith('--')) return normalized.startsWith(`${flag}=`);
        return /^-[a-z]$/u.test(flag)
          && /^-[^-]/u.test(normalized)
          && normalized.slice(1).includes(flag.slice(1));
      });
  });
}

export function hasPowerShellWhatIf(tokens: readonly string[]): boolean {
  return tokens.some(token => {
    const normalized = token.toLocaleLowerCase('en-US');
    return normalized === '-whatif'
      || normalized === '-whatif:$true'
      || normalized === '-whatif:true';
  });
}

export function findOptionValue(params: {
  readonly tokens: readonly string[];
  readonly shortName: string;
  readonly longName: string;
  readonly caseInsensitive?: boolean;
}): string | undefined {
  const shortName = params.caseInsensitive
    ? params.shortName.toLocaleLowerCase('en-US')
    : params.shortName;
  const longName = params.caseInsensitive
    ? params.longName.toLocaleLowerCase('en-US')
    : params.longName;
  for (let index = 1; index < params.tokens.length; index += 1) {
    const token = params.tokens[index];
    const comparableToken = params.caseInsensitive
      ? token.toLocaleLowerCase('en-US')
      : token;
    if (comparableToken === shortName || comparableToken === longName) {
      return params.tokens[index + 1];
    }
    if (comparableToken.startsWith(`${longName}=`)) {
      return token.slice(longName.length + 1);
    }
    if (comparableToken.startsWith(shortName) && token.length > shortName.length) {
      return token.slice(shortName.length);
    }
  }
  return undefined;
}

const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-C', '-c', '--config-env', '--exec-path', '--git-dir', '--namespace',
  '--super-prefix', '--work-tree',
]);

export function extractGitSubcommand(
  executable: string,
  executableTokens: readonly string[],
): string | undefined {
  if (executable !== 'git') return undefined;
  for (let index = 1; index < executableTokens.length; index += 1) {
    const token = executableTokens[index];
    if (token === '--') return executableTokens[index + 1]?.toLocaleLowerCase('en-US');
    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (
      /^-(?:C|c).+/u.test(token)
      || /^--(?:config-env|exec-path|git-dir|namespace|super-prefix|work-tree)=/u.test(token)
    ) continue;
    if (token.startsWith('-')) continue;
    return token.toLocaleLowerCase('en-US');
  }
  return undefined;
}

export function nonOptionArguments(tokens: readonly string[]): readonly string[] {
  const redirectionOperators = new Set(['<', '>', '<<', '>>']);
  return tokens.slice(1).filter(token => (
    !token.startsWith('-') && !redirectionOperators.has(token)
  ));
}

export function isRemotePath(token: string): boolean {
  if (/^[A-Za-z]:[\\/]/u.test(token)) return false;
  return /^(?:[^/@:\\s]+@)?[^/\\:\s]+:{1,2}.+/u.test(token);
}
