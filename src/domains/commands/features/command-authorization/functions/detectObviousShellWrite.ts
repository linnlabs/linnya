import { scanCommandRiskLexemes } from './scanCommandRiskLexemes';
import {
  allCommandFacts,
  extractGitSubcommand,
  hasFlag,
  nonOptionArguments,
} from './rules/commandRiskLexicalFacts';

const DIRECT_WRITE_EXECUTABLES = new Set([
  'add-content', 'copy-item', 'cp', 'dd', 'install', 'ln', 'mkdir', 'mkfifo',
  'move-item', 'mv', 'new-item', 'ni', 'out-file', 'remove-item', 'rm', 'rmdir',
  'set-content', 'tee', 'tee-object', 'touch', 'truncate', 'unzip',
]);
const PACKAGE_WRITE_SUBCOMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  brew: new Set(['install', 'reinstall', 'uninstall', 'update', 'upgrade']),
  bun: new Set(['add', 'install', 'remove', 'update']),
  cargo: new Set(['install', 'uninstall']),
  gem: new Set(['install', 'uninstall', 'update']),
  npm: new Set(['add', 'install', 'remove', 'uninstall', 'update']),
  pip: new Set(['install', 'uninstall']),
  pip3: new Set(['install', 'uninstall']),
  pnpm: new Set(['add', 'install', 'remove', 'update']),
  yarn: new Set(['add', 'install', 'remove', 'upgrade']),
};
const GIT_WRITE_SUBCOMMANDS = new Set([
  'add', 'am', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit',
  'init', 'merge', 'mv', 'rebase', 'reset', 'restore', 'revert', 'stash', 'switch',
  'tag', 'worktree',
]);

function hasOutputRedirection(tokens: readonly string[]): boolean {
  return tokens.includes('>') || tokens.includes('>>');
}

function mutatesThroughPackageManager(
  executable: string,
  tokens: readonly string[],
): boolean {
  const direct = PACKAGE_WRITE_SUBCOMMANDS[executable];
  if (direct?.has(tokens[1]?.toLocaleLowerCase('en-US') ?? '')) return true;
  if (executable === 'uv' && tokens[1]?.toLocaleLowerCase('en-US') === 'pip') {
    return new Set(['install', 'uninstall']).has(
      tokens[2]?.toLocaleLowerCase('en-US') ?? '',
    );
  }
  if (/^(?:python|python3|py)$/u.test(executable)) {
    const moduleIndex = tokens.findIndex(token => token === '-m');
    return moduleIndex >= 0
      && tokens[moduleIndex + 1]?.toLocaleLowerCase('en-US') === 'pip'
      && new Set(['install', 'uninstall']).has(
        tokens[moduleIndex + 2]?.toLocaleLowerCase('en-US') ?? '',
      );
  }
  return false;
}

/**
 * 这是只读档的少量明显写入补充，不是通用 Shell 副作用证明。未知 CLI 仍依赖 Agent
 * 显式声明；macOS 由系统沙箱兜底，Windows 保留 D70/A 已确认的漏判边界。
 */
export function detectObviousShellWrite(input: {
  readonly command: string;
  readonly platform: 'macos' | 'windows';
  readonly shellSemanticsId: string;
}): boolean {
  const scan = scanCommandRiskLexemes({
    command: input.command,
    platform: input.platform,
    shellSemantics: input.platform === 'macos' ? 'zsh' : 'powershell',
  });
  return allCommandFacts(scan).some(({ executable, executableTokens, originalTokens }) => {
    if (hasOutputRedirection(originalTokens)) return true;
    if (DIRECT_WRITE_EXECUTABLES.has(executable)) {
      if (hasFlag(executableTokens, '--help', '--version', '-?', '-whatif')) return false;
      return nonOptionArguments(executableTokens).length > 0;
    }
    if (
      (executable === 'sed' && hasFlag(executableTokens, '-i', '--in-place'))
      || (executable === 'perl' && hasFlag(executableTokens, '-i'))
    ) return true;
    if (mutatesThroughPackageManager(executable, executableTokens)) return true;
    const gitSubcommand = extractGitSubcommand(executable, executableTokens);
    return gitSubcommand !== undefined && GIT_WRITE_SUBCOMMANDS.has(gitSubcommand);
  });
}
