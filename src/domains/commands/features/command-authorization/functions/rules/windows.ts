import type {
  CommandRiskLexicalScan,
  CommandRiskRule,
  CommandRiskRuleCatalog,
  CommandRiskRuleMatcher,
} from '../../definitions/commandRiskRule';
import { COMMAND_AUTHORIZATION_MATCHER_REVISION } from '../../definitions/simpleCommand';
import {
  allCommandFacts,
  commandSegmentFacts,
  extractGitSubcommand,
  findOptionValue,
  hasFlag,
  hasPowerShellWhatIf,
  isRemotePath,
  nonOptionArguments,
} from './commandRiskLexicalFacts';

const rules = [
  { id: 'windows.system-or-disk-impact.disk', platform: 'windows', category: 'system_or_disk_impact', priority: 595, matcher: 'system_disk' },
  { id: 'windows.system-or-disk-impact.power', platform: 'windows', category: 'system_or_disk_impact', priority: 585, matcher: 'system_power' },
  { id: 'windows.system-or-disk-impact.elevation', platform: 'windows', category: 'system_or_disk_impact', priority: 575, matcher: 'system_elevation' },
  { id: 'windows.system-or-disk-impact.service', platform: 'windows', category: 'system_or_disk_impact', priority: 565, matcher: 'system_service' },
  { id: 'windows.delete.remove-item', platform: 'windows', category: 'delete', priority: 495, matcher: 'delete_powershell' },
  { id: 'windows.delete.cmd', platform: 'windows', category: 'delete', priority: 485, matcher: 'delete_cmd' },
  { id: 'windows.delete.git-clean', platform: 'windows', category: 'delete', priority: 475, matcher: 'delete_git_clean' },
  { id: 'windows.download-and-execute.remote', platform: 'windows', category: 'download_and_execute', priority: 395, matcher: 'download_execute_remote' },
  { id: 'windows.download-and-execute.package-runner', platform: 'windows', category: 'download_and_execute', priority: 385, matcher: 'download_execute_package_runner' },
  { id: 'windows.external-upload.git-push-force', platform: 'windows', category: 'external_upload', priority: 295, matcher: 'upload_git_push_force' },
  { id: 'windows.external-upload.web-request-file', platform: 'windows', category: 'external_upload', priority: 285, matcher: 'upload_powershell_web' },
  { id: 'windows.external-upload.curl-file', platform: 'windows', category: 'external_upload', priority: 275, matcher: 'upload_curl_file' },
  { id: 'windows.external-upload.remote-copy', platform: 'windows', category: 'external_upload', priority: 265, matcher: 'upload_remote_copy' },
  { id: 'windows.external-upload.git-push', platform: 'windows', category: 'external_upload', priority: 255, matcher: 'upload_git_push' },
  { id: 'windows.move-overwrite-rename.move-rename', platform: 'windows', category: 'move_overwrite_rename', priority: 195, matcher: 'move_powershell' },
  { id: 'windows.move-overwrite-rename.force-copy', platform: 'windows', category: 'move_overwrite_rename', priority: 185, matcher: 'overwrite_copy_force' },
] as const satisfies readonly CommandRiskRule[];

export const WINDOWS_COMMAND_RISK_CATALOG: CommandRiskRuleCatalog = {
  revision: COMMAND_AUTHORIZATION_MATCHER_REVISION,
  platform: 'windows',
  shell_semantics_ids: ['powershell-5.1', 'powershell-7'],
  rules: [...rules],
};

function isCurlFileUpload(tokens: readonly string[]): boolean {
  if (
    findOptionValue({ tokens, shortName: '-T', longName: '--upload-file' })
    || findOptionValue({ tokens, shortName: '-F', longName: '--form' })
  ) return true;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLocaleLowerCase('en-US');
    if (
      lower === '--data-binary' || lower === '--data' || lower === '-d'
      || lower === '--data-urlencode'
    ) {
      if (tokens[index + 1]?.startsWith('@')) return true;
    }
    if (/^(?:-d|--(?:data|data-binary|data-urlencode)=)@/u.test(token)) return true;
  }
  return false;
}

function isWebDownloadExecutable(executable: string): boolean {
  return executable === 'iwr' || executable === 'irm'
    || executable === 'invoke-webrequest' || executable === 'invoke-restmethod'
    || executable === 'curl' || executable === 'wget';
}

function isExpressionExecutable(executable: string): boolean {
  return executable === 'iex' || executable === 'invoke-expression'
    || executable === 'powershell' || executable === 'pwsh';
}

function matchesRemoteDownloadAndExecute(scan: CommandRiskLexicalScan): boolean {
  for (let index = 0; index < scan.segments.length; index += 1) {
    const source = commandSegmentFacts(scan.segments[index], 'windows');
    if (!isWebDownloadExecutable(source.executable)) continue;
    const targetSegment = scan.segments[index + 1];
    if (targetSegment) {
      const target = commandSegmentFacts(targetSegment, 'windows');
      if (targetSegment.separatorBefore === 'pipe' && isExpressionExecutable(target.executable)) {
        return true;
      }
      const outputPath = findOptionValue({
        tokens: source.executableTokens,
        shortName: '-o',
        longName: '-OutFile',
        caseInsensitive: true,
      });
      if (
        targetSegment.separatorBefore === 'chain'
        && outputPath
        && target.executableTokens.includes(outputPath)
        && (
          isExpressionExecutable(target.executable)
          || target.executableTokens[0] === outputPath
        )
      ) return true;
    }
  }
  return false;
}

function isBarePowerShellWebAlias(params: {
  readonly executable: string;
  readonly originalTokens: readonly string[];
  readonly shellSemanticsId: string;
}): boolean {
  if (params.shellSemanticsId !== 'powershell-5.1') return false;
  if (params.executable !== 'curl' && params.executable !== 'wget') return false;
  const originalExecutable = params.originalTokens[0] ?? '';
  return !/\.(?:exe|cmd|bat|com)$/iu.test(originalExecutable);
}

export function matchesWindowsRiskRule(
  matcher: CommandRiskRuleMatcher,
  scan: CommandRiskLexicalScan,
  shellSemanticsId: string,
): boolean {
  const facts = allCommandFacts(scan);
  switch (matcher) {
    case 'delete_powershell':
      return facts.some(({
        executable, executableTokens, shellSemantics,
      }) => (
        shellSemantics === 'powershell'
        &&
        ['remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir'].includes(executable)
        && nonOptionArguments(executableTokens).length > 0
        && !hasPowerShellWhatIf(executableTokens)
        && !hasFlag(executableTokens, '-?', '--help')
      ));
    case 'delete_cmd':
      return facts.some(({ executable, executableTokens, shellSemantics }) => (
        shellSemantics === 'cmd'
        &&
        (executable === 'del' || executable === 'erase' || executable === 'rd' || executable === 'rmdir')
        && nonOptionArguments(executableTokens).length > 0
      ));
    case 'delete_git_clean':
      return facts.some(({ executable, executableTokens }) => (
        extractGitSubcommand(executable, executableTokens) === 'clean'
        && hasFlag(executableTokens, '-f', '--force')
        && !hasFlag(executableTokens, '-n', '--dry-run')
      ));
    case 'move_powershell':
      return facts.some(({ executable, executableTokens }) => (
        ['move-item', 'move', 'mi', 'mv', 'rename-item', 'rename', 'ren', 'rni'].includes(executable)
        && nonOptionArguments(executableTokens).length >= 2
        && !hasPowerShellWhatIf(executableTokens)
        && !hasFlag(executableTokens, '-?', '--help')
      ));
    case 'overwrite_copy_force':
      return facts.some(({ executable, executableTokens }) => (
        ['copy-item', 'copy', 'cpi', 'cp'].includes(executable)
        && hasFlag(executableTokens, '-force', '-f')
        && nonOptionArguments(executableTokens).length >= 2
        && !hasPowerShellWhatIf(executableTokens)
      ));
    case 'upload_curl_file':
      return facts.some(({ executable, executableTokens, originalTokens }) => (
        executable === 'curl'
        && !isBarePowerShellWebAlias({ executable, originalTokens, shellSemanticsId })
        && isCurlFileUpload(executableTokens)
      ));
    case 'upload_remote_copy':
      return facts.some(({ executable, executableTokens }) => {
        if (executable !== 'scp' && executable !== 'rsync') return false;
        const argumentsWithoutOptions = nonOptionArguments(executableTokens);
        return isRemotePath(
          argumentsWithoutOptions[argumentsWithoutOptions.length - 1] ?? '',
        );
      });
    case 'upload_git_push':
      return facts.some(({ executable, executableTokens }) => (
        extractGitSubcommand(executable, executableTokens) === 'push'
        && !hasFlag(executableTokens, '-n', '--dry-run')
      ));
    case 'upload_git_push_force':
      return facts.some(({ executable, executableTokens }) => (
        extractGitSubcommand(executable, executableTokens) === 'push'
        && hasFlag(executableTokens, '-f', '--force', '--force-with-lease', '--force-if-includes')
        && !hasFlag(executableTokens, '-n', '--dry-run')
      ));
    case 'upload_powershell_web':
      return facts.some(({ executable, executableTokens, originalTokens }) => {
        if (executable === 'start-bitstransfer') {
          return hasFlag(executableTokens, '-transfertype')
            && executableTokens.some(token => /^upload$/iu.test(token));
        }
        if (
          !['iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod'].includes(executable)
          && !isBarePowerShellWebAlias({ executable, originalTokens, shellSemanticsId })
        ) {
          return false;
        }
        return hasFlag(executableTokens, '-infile')
          && executableTokens.some(token => /^-(?:method)$/iu.test(token))
          && executableTokens.some(token => /^(?:post|put|patch)$/iu.test(token));
      });
    case 'download_execute_remote':
      return matchesRemoteDownloadAndExecute(scan);
    case 'download_execute_package_runner':
      return facts.some(({ executable, executableTokens }) => (
        (executable === 'npx' && hasFlag(executableTokens, '-y', '--yes'))
        || executable === 'bunx' || executable === 'uvx'
      ));
    case 'system_elevation':
      return facts.some(({ executable, executableTokens }) => (
        executable === 'start-process'
        && !hasPowerShellWhatIf(executableTokens)
        && hasFlag(executableTokens, '-verb')
        && executableTokens.some(token => /^runas$/iu.test(token))
      ));
    case 'system_power':
      return facts.some(({ executable, executableTokens }) => (
        (
          (executable === 'stop-computer' || executable === 'restart-computer')
          && !hasPowerShellWhatIf(executableTokens)
        )
        || (
          executable === 'shutdown'
          && !hasFlag(executableTokens, '/a')
          && hasFlag(executableTokens, '/s', '/r', '/p', '/h')
        )
      ));
    case 'system_disk':
      return facts.some(({ executable, executableTokens, originalTokens }) => (
        !hasPowerShellWhatIf(executableTokens)
        && (
          executable === 'format-volume' || executable === 'clear-disk'
          || executable === 'initialize-disk' || executable === 'remove-partition'
          || (
            executable === 'format'
            && /(?:^|[\\/])format\.com$/iu.test(originalTokens[0] ?? '')
            && nonOptionArguments(executableTokens).length > 0
            && !hasFlag(executableTokens, '/?')
          )
        )
      ));
    case 'system_service':
      return facts.some(({ executable, executableTokens, originalTokens }) => (
        (executable === 'stop-service' && !hasPowerShellWhatIf(executableTokens))
        || (
          executable === 'sc'
          && /(?:^|[\\/])sc\.exe$/iu.test(originalTokens[0] ?? '')
          && executableTokens.some(token => /^(?:stop|delete|config)$/iu.test(token))
        )
      ));
    default:
      return false;
  }
}
