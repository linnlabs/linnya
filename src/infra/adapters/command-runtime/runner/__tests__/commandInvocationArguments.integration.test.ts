import { CommandResolvedShellV1Schema } from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import { resolveCommandInvocationArguments } from '../functions/resolveCommandInvocationArguments';

function createShell(
  platform: 'macos' | 'windows',
  profile: 'plain-v1' | 'powershell-utf8-v1',
  outputEncoding: 'utf-8' | 'windows-936' = 'utf-8',
) {
  return CommandResolvedShellV1Schema.parse({
    platform,
    shell_semantics_id: platform === 'macos' ? 'zsh' : 'powershell-5.1',
    shell_version: platform === 'macos' ? '5.9' : '5.1',
    snapshot_revision: 'invocation-profile-test',
    output_text_encoding: outputEncoding,
    command_invocation_profile_id: profile,
    executable_path: platform === 'macos'
      ? '/bin/zsh'
      : 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    argv_prefix: platform === 'macos'
      ? ['-f', '-c']
      : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
  });
}

describe('command invocation profile', () => {
  it('plain-v1 只交付已审批原命令', () => {
    const command = 'printf "中文\\n"';
    const args = resolveCommandInvocationArguments({
      shell: createShell('macos', 'plain-v1'),
      approvedCommand: command,
    });

    expect(args).toEqual([command]);
    expect(Object.isFrozen(args)).toBe(true);
  });

  it('PowerShell profile 使用固定前置设置并让注释命令从新行开始', () => {
    const command = '# comment\nWrite-Output "中文"';
    const [invocation] = resolveCommandInvocationArguments({
      shell: createShell('windows', 'powershell-utf8-v1'),
      approvedCommand: command,
    });

    expect(invocation).toContain('[Console]::InputEncoding = $linnyaUtf8');
    expect(invocation).toContain('[Console]::OutputEncoding = $linnyaUtf8');
    expect(invocation).toContain('$OutputEncoding = $linnyaUtf8');
    expect(invocation).toContain('LINNYA_RUNTIME_UTF8_INITIALIZATION_FAILED');
    expect(invocation?.endsWith(`\n${command}`)).toBe(true);
  });

  it('拒绝平台/profile 错配及 UTF-8 profile 搭配其他 decoder', () => {
    expect(() => createShell('macos', 'powershell-utf8-v1')).toThrow(
      'command invocation profile must match the frozen platform',
    );
    expect(() => createShell('windows', 'plain-v1')).toThrow(
      'command invocation profile must match the frozen platform',
    );
    expect(() => createShell(
      'windows',
      'powershell-utf8-v1',
      'windows-936',
    )).toThrow('PowerShell UTF-8 invocation profile requires UTF-8 output decoding');
  });
});
