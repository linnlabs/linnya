import type { CommandResolvedShellV1 } from '@app/schemas/commands';

const POWERSHELL_UTF8_PRELUDE_V1 = [
  'try {',
  '  $linnyaUtf8 = New-Object System.Text.UTF8Encoding $false -ErrorAction Stop',
  '  [Console]::InputEncoding = $linnyaUtf8',
  '  [Console]::OutputEncoding = $linnyaUtf8',
  '  $OutputEncoding = $linnyaUtf8',
  '} catch {',
  "  [Console]::Error.WriteLine('LINNYA_RUNTIME_UTF8_INITIALIZATION_FAILED')",
  '  exit 1',
  '}',
  'Remove-Variable linnyaUtf8',
  '',
].join('\n');

/**
 * profile 是 App 启动时冻结并进入 launch wire 的可信事实，不接受调用方提供任意前缀。
 * PowerShell 前缀末尾必须保留换行，避免用户命令以注释开头时吞掉初始化脚本。
 */
export function resolveCommandInvocationArguments(params: {
  readonly shell: CommandResolvedShellV1;
  readonly approvedCommand: string;
}): readonly string[] {
  switch (params.shell.command_invocation_profile_id) {
    case 'plain-v1':
      return Object.freeze([params.approvedCommand]);
    case 'powershell-utf8-v1':
      return Object.freeze([
        `${POWERSHELL_UTF8_PRELUDE_V1}${params.approvedCommand}`,
      ]);
    default: {
      const unsupportedProfile: never = params.shell.command_invocation_profile_id;
      throw new Error(`unsupported command invocation profile: ${String(unsupportedProfile)}`);
    }
  }
}
