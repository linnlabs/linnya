import type {
  CommandRiskExecutionScope,
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
  isRemotePath,
  nonOptionArguments,
} from './commandRiskLexicalFacts';

import { isLinnyaScheduleMutation } from './linnyaScheduleMutation';

const rules = [
  { id: 'macos.persistent-automation.linnya-schedules', platform: 'macos', category: 'persistent_automation', priority: 610, matcher: 'linnya_schedules' },
  { id: 'macos.system-or-disk-impact.disk', platform: 'macos', category: 'system_or_disk_impact', priority: 590, matcher: 'system_disk' },
  { id: 'macos.system-or-disk-impact.power', platform: 'macos', category: 'system_or_disk_impact', priority: 580, matcher: 'system_power' },
  { id: 'macos.system-or-disk-impact.elevation', platform: 'macos', category: 'system_or_disk_impact', priority: 570, matcher: 'system_elevation' },
  { id: 'macos.system-or-disk-impact.service', platform: 'macos', category: 'system_or_disk_impact', priority: 560, matcher: 'system_service' },
  { id: 'macos.delete.rm', platform: 'macos', category: 'delete', priority: 490, matcher: 'delete_rm' },
  { id: 'macos.delete.find-delete', platform: 'macos', category: 'delete', priority: 480, matcher: 'delete_find' },
  { id: 'macos.delete.git-clean', platform: 'macos', category: 'delete', priority: 470, matcher: 'delete_git_clean' },
  { id: 'macos.download-and-execute.remote', platform: 'macos', category: 'download_and_execute', priority: 390, matcher: 'download_execute_remote' },
  { id: 'macos.download-and-execute.package-runner', platform: 'macos', category: 'download_and_execute', priority: 380, matcher: 'download_execute_package_runner' },
  { id: 'macos.external-upload.git-push-force', platform: 'macos', category: 'external_upload', priority: 290, matcher: 'upload_git_push_force' },
  { id: 'macos.external-upload.curl-file', platform: 'macos', category: 'external_upload', priority: 280, matcher: 'upload_curl_file' },
  { id: 'macos.external-upload.remote-copy', platform: 'macos', category: 'external_upload', priority: 270, matcher: 'upload_remote_copy' },
  { id: 'macos.external-upload.git-push', platform: 'macos', category: 'external_upload', priority: 260, matcher: 'upload_git_push' },
  { id: 'macos.move-overwrite-rename.move', platform: 'macos', category: 'move_overwrite_rename', priority: 190, matcher: 'move_macos' },
  { id: 'macos.move-overwrite-rename.force-copy', platform: 'macos', category: 'move_overwrite_rename', priority: 180, matcher: 'overwrite_copy_force' },
] as const satisfies readonly CommandRiskRule[];

export const MACOS_COMMAND_RISK_CATALOG: CommandRiskRuleCatalog = {
  revision: COMMAND_AUTHORIZATION_MATCHER_REVISION,
  platform: 'macos',
  shell_semantics_ids: ['zsh'],
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
      const value = tokens[index + 1];
      if (value?.startsWith('@')) return true;
    }
    if (/^(?:-d|--(?:data|data-binary|data-urlencode)=)@/u.test(token)) return true;
  }
  return false;
}

function isRemoteDownloadExecutable(executable: string): boolean {
  return executable === 'curl' || executable === 'wget';
}

function isShellExecutable(executable: string): boolean {
  return executable === 'sh' || executable === 'bash' || executable === 'zsh';
}

function matchesRemoteDownloadAndExecute(scan: CommandRiskLexicalScan): boolean {
  for (let index = 0; index < scan.segments.length; index += 1) {
    const source = commandSegmentFacts(scan.segments[index], 'macos');
    if (!isRemoteDownloadExecutable(source.executable)) continue;

    const targetSegment = scan.segments[index + 1];
    if (!targetSegment) continue;
    const target = commandSegmentFacts(targetSegment, 'macos');
    if (targetSegment.separatorBefore === 'pipe' && isShellExecutable(target.executable)) {
      return true;
    }

    const outputPath = findOptionValue(source.executable === 'wget'
      ? {
          tokens: source.executableTokens,
          shortName: '-O',
          longName: '--output-document',
        }
      : {
          tokens: source.executableTokens,
          shortName: '-o',
          longName: '--output',
        });
    if (
      targetSegment.separatorBefore === 'chain'
      && outputPath
      && target.executableTokens.includes(outputPath)
      && (
        isShellExecutable(target.executable)
        || target.executableTokens[0] === outputPath
      )
    ) return true;
  }
  return false;
}

const DIRECTORY_CHANGERS = new Set(['cd', 'pushd', 'popd', 'chdir']);
const CONVERSATION_LOCAL_PATH = /^[\p{L}\p{N}._@+=,*?/-]+$/u;

function isConversationLocalPathLiteral(token: string): boolean {
  if (!CONVERSATION_LOCAL_PATH.test(token)) return false;
  if (token.startsWith('/') || token.startsWith('-') || token.endsWith('/')) return false;
  return token.split('/').every(part => part !== '' && part !== '..');
}

/**
 * 本会话工作目录里的普通文件删除不需要审批：Agent 先删后写自己建的过程文件，
 * 无人值守时不能卡在审批上。只有从命令文本与已核对 cwd 能证明“只删本会话目录内的
 * 普通文件”才放行：裸 rm、只带 -f/-v、目标全是不含 .. 的字面相对路径且不以 / 结尾、
 * 整条命令没有切目录和命令替换/嵌套脚本、cwd 真实路径在本会话根之内。不加 -r 时 rm
 * 删不了目录，遇到符号链接只删链接本身。任何一条不满足仍按删除审批。
 */
function isConversationLocalFileRemoval(
  fact: ReturnType<typeof allCommandFacts>[number],
  scan: CommandRiskLexicalScan,
  scope: CommandRiskExecutionScope | undefined,
): boolean {
  if (!scope?.cwdInsideConversationRoot) return false;
  if (fact.executable !== 'rm' || fact.wrappers.length > 0) return false;
  if (fact.originalTokens[0]?.toLocaleLowerCase('en-US') !== 'rm') return false;
  if (scan.segments.some(segment => segment.separatorBefore === 'substitution')) return false;
  if (allCommandFacts(scan).some(({ executable }) => DIRECTORY_CHANGERS.has(executable))) return false;
  const targets: string[] = [];
  let endOfOptions = false;
  for (const token of fact.executableTokens.slice(1)) {
    if (!endOfOptions && token === '--') {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && token.startsWith('-')) {
      if (!/^-[fv]+$/u.test(token)) return false;
      continue;
    }
    targets.push(token);
  }
  return targets.length > 0 && targets.every(isConversationLocalPathLiteral);
}

export function matchesMacosRiskRule(
  matcher: CommandRiskRuleMatcher,
  scan: CommandRiskLexicalScan,
  scope?: CommandRiskExecutionScope,
): boolean {
  const facts = allCommandFacts(scan);
  switch (matcher) {
    case 'linnya_schedules':
      return facts.some(isLinnyaScheduleMutation);
    case 'delete_rm':
      return facts.some((fact, index) => (
        (fact.executable === 'rm' || fact.executable === 'rmdir' || fact.executable === 'unlink')
        && (
          nonOptionArguments(fact.executableTokens).length > 0
          || fact.originalTokens[0]?.toLocaleLowerCase('en-US') === 'xargs'
          // 未加引号的 $(...) / `...` 被扫描成紧随其后的 substitution 段，删除目标在那里。
          || scan.segments[index + 1]?.separatorBefore === 'substitution'
        )
        && !hasFlag(fact.executableTokens, '--help', '--version')
        && !isConversationLocalFileRemoval(fact, scan, scope)
      ));
    case 'delete_find':
      return facts.some(({ executable, executableTokens }) => (
        executable === 'find' && hasFlag(executableTokens, '-delete')
      ));
    case 'delete_git_clean':
      return facts.some(({ executable, executableTokens }) => (
        extractGitSubcommand(executable, executableTokens) === 'clean'
        && hasFlag(executableTokens, '-f', '--force')
        && !hasFlag(executableTokens, '-n', '--dry-run')
      ));
    case 'move_macos':
      return facts.some(({ executable, executableTokens }) => (
        executable === 'mv'
        && nonOptionArguments(executableTokens).length >= 2
        && !hasFlag(executableTokens, '--help', '--version')
      ));
    case 'overwrite_copy_force':
      return facts.some(({ executable, executableTokens }) => (
        executable === 'cp'
        && hasFlag(executableTokens, '-f', '--force')
        && nonOptionArguments(executableTokens).length >= 2
      ));
    case 'upload_curl_file':
      return facts.some(({ executable, executableTokens }) => (
        executable === 'curl' && isCurlFileUpload(executableTokens)
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
    case 'download_execute_remote':
      return matchesRemoteDownloadAndExecute(scan);
    case 'download_execute_package_runner':
      return facts.some(({ executable, executableTokens }) => (
        (executable === 'npx' && hasFlag(executableTokens, '-y', '--yes'))
        || executable === 'bunx' || executable === 'uvx'
      ));
    case 'system_elevation':
      return facts.some(({ executable, wrappers }) => (
        executable.length > 0
        && (wrappers.includes('sudo') || wrappers.includes('doas'))
      ));
    case 'system_power':
      return facts.some(({ executable, executableTokens }) => (
        executable === 'reboot'
        || (executable === 'shutdown' && !hasFlag(executableTokens, '-c'))
      ));
    case 'system_disk':
      return facts.some(({ executable, executableTokens }) => {
        if (executable === 'mkfs') return true;
        if (executable === 'dd') {
          return executableTokens.some(token => /^of=\/dev\//u.test(token));
        }
        if (executable !== 'diskutil') return false;
        return executableTokens.slice(1).some(token => (
          /^(?:eraseDisk|eraseVolume|partitionDisk|zeroDisk|randomDisk)$/iu.test(token)
        ));
      });
    case 'system_service':
      return facts.some(({ executable, executableTokens }) => (
        executable === 'launchctl'
        && executableTokens.slice(1).some(token => (
          /^(?:bootout|disable|remove|unload)$/iu.test(token)
        ))
      ));
    default:
      return false;
  }
}
