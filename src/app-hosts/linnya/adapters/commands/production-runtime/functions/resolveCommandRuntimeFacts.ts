import path from 'node:path';

import {
  CommandLaunchEnvironmentV1Schema,
  CommandResolvedShellV1Schema,
} from '@app/schemas/commands';
import type { LocalProcessPlatformRuntime } from 'src/infra/adapters/local-process-runtime/platform-runtime';
import type { CommandRuntimeFacts } from '../definitions/commandRuntimeFacts';
import { probeCommandShell } from './probeCommandShell';

// Windows 冷启动在并发负载下实测超过 4 秒；保留有界探测，两个 Shell 的最坏路径
// 连同 where 仍在 App Server 30 秒 ready 预算内，不把正常冷启动误判成不可用。
const WINDOWS_SHELL_VERSION_TIMEOUT_MS = 10_000;

export interface CommandShellProbePort {
  resolveExecutable(command: string, environment: Readonly<Record<string, string>>): Promise<string | undefined>;
  readVersion(input: {
    readonly executablePath: string;
    readonly argv: readonly string[];
    readonly environment: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
  }): Promise<string | undefined>;
}

const nodeShellProbe: CommandShellProbePort = Object.freeze({
  async resolveExecutable(
    command: string,
    environment: Readonly<Record<string, string>>,
  ) {
    if (process.platform !== 'win32') return command.startsWith('/') ? command : undefined;
    return probeCommandShell({
      executablePath: 'where.exe',
      argv: [command],
      environment,
      timeoutMs: 2_000,
      kind: 'executable',
    });
  },
  readVersion(input: {
    readonly executablePath: string;
    readonly argv: readonly string[];
    readonly environment: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
  }) {
    return probeCommandShell({ ...input, kind: 'version' });
  },
});

function freezeEnvironment(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  const entries = Object.entries(environment).filter((entry): entry is [string, string] => (
    typeof entry[1] === 'string'
  ));
  if (platform !== 'win32') return Object.freeze(Object.fromEntries(entries));

  const windowsEntries = new Map<string, { readonly name: string; readonly value: string }>();
  for (const [name, value] of entries) {
    // Windows 的环境变量名不区分大小写。后出现的值代表 App host 已完成合并后的来源，
    // 必须在 Shell 探针和 native 环境块之前统一，避免二者看见不同的 PATH。
    windowsEntries.set(name.toLowerCase(), { name, value });
  }

  return Object.freeze(Object.fromEntries(
    [...windowsEntries.values()].map(entry => [entry.name, entry.value]),
  ));
}

/**
 * App owner 启动时只解析一次 Shell、版本和环境；单条命令不得重新读取 PATH 或 profile。
 */
export async function resolveCommandRuntimeFacts(input: {
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly revision: string;
  readonly platformRuntime: LocalProcessPlatformRuntime;
  readonly probe?: CommandShellProbePort;
}): Promise<CommandRuntimeFacts> {
  const probe = input.probe ?? nodeShellProbe;
  const environmentEntries = freezeEnvironment(input.platform, input.environment);
  const environment = CommandLaunchEnvironmentV1Schema.parse({
    revision: input.revision,
    entries: environmentEntries,
  });

  if (input.platform === 'darwin') {
    if (input.platformRuntime.platform !== 'darwin') {
      throw new Error('macOS Shell received another local process platform runtime');
    }
    const executablePath = '/bin/zsh';
    const shellVersion = await probe.readVersion({
      executablePath,
      argv: ['--version'],
      environment: environmentEntries,
      timeoutMs: 3_000,
    });
    if (!shellVersion) throw new Error('macOS command runtime could not probe /bin/zsh');
    return Object.freeze({
      shell: CommandResolvedShellV1Schema.parse({
        platform: 'macos',
        shell_semantics_id: 'zsh',
        shell_version: shellVersion,
        snapshot_revision: input.revision,
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'plain-v1',
        executable_path: executablePath,
        argv_prefix: ['-f', '-c'],
      }),
      environment,
      platformRuntime: { schema_version: 1, platform: 'darwin' },
    } satisfies CommandRuntimeFacts);
  }

  if (input.platform !== 'win32') {
    throw new Error(`command runtime does not support platform ${input.platform}`);
  }
  if (input.platformRuntime.platform !== 'win32') {
    throw new Error('Windows Shell received another local process platform runtime');
  }

  const powershell7Path = await probe.resolveExecutable('pwsh.exe', environmentEntries);
  const powershell7Version = powershell7Path
    ? await probe.readVersion({
        executablePath: powershell7Path,
        argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
        environment: environmentEntries,
        timeoutMs: WINDOWS_SHELL_VERSION_TIMEOUT_MS,
      })
    : undefined;
  const windowsRoot = Object.entries(environmentEntries).find(
    ([name]) => name.toLowerCase() === 'systemroot',
  )?.[1];
  if (!windowsRoot) throw new Error('Windows command runtime requires SystemRoot');
  const fallbackPath = path.win32.join(
    windowsRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const executablePath = powershell7Version ? powershell7Path : fallbackPath;
  if (!executablePath) throw new Error('Windows PowerShell 7 path is unavailable');
  const shellVersion = powershell7Version ?? await probe.readVersion({
    executablePath,
    argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
    environment: environmentEntries,
    timeoutMs: WINDOWS_SHELL_VERSION_TIMEOUT_MS,
  });
  if (!shellVersion) throw new Error('Windows command runtime could not probe PowerShell');
  return Object.freeze({
    shell: CommandResolvedShellV1Schema.parse({
      platform: 'windows',
      shell_semantics_id: powershell7Version ? 'powershell-7' : 'powershell-5.1',
      shell_version: shellVersion,
      snapshot_revision: input.revision,
      output_text_encoding: 'utf-8',
      command_invocation_profile_id: 'powershell-utf8-v1',
      executable_path: executablePath,
      argv_prefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
    }),
    environment,
    platformRuntime: input.platformRuntime,
  } satisfies CommandRuntimeFacts);
}
