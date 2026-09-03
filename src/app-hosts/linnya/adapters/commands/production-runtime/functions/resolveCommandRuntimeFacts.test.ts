import { describe, expect, it, vi } from 'vitest';

import type { CommandShellProbePort } from './resolveCommandRuntimeFacts';
import { resolveCommandRuntimeFacts } from './resolveCommandRuntimeFacts';

function probe(input: {
  readonly pwshPath?: string;
  readonly versions: Readonly<Record<string, string | undefined>>;
}): CommandShellProbePort {
  return {
    resolveExecutable: vi.fn(() => input.pwshPath),
    readVersion: vi.fn(request => input.versions[request.executablePath]),
  };
}

const MACOS_PLATFORM_RUNTIME = Object.freeze({
  schema_version: 1 as const,
  platform: 'darwin' as const,
});

const WINDOWS_PLATFORM_RUNTIME = Object.freeze({
  schema_version: 1 as const,
  platform: 'win32' as const,
  manifest_path: 'C:\\Linnya\\resources\\command-runtime\\windows\\x64\\linnyaCommandProcessOwner.manifest.json',
  expected_runtime_version: '0.1.0',
  expected_application_version: '0.0.38',
  trust: { kind: 'development' as const },
});

describe('resolveCommandRuntimeFacts', () => {
  it('macOS 启动时只冻结一次 zsh、环境与同一 revision', () => {
    const shellProbe = probe({ versions: { '/bin/zsh': 'zsh 5.9' } });
    const environment = { PATH: '/usr/bin:/bin', OMITTED: undefined };
    const facts = resolveCommandRuntimeFacts({
      platform: 'darwin',
      environment,
      revision: 'app-owner-1',
      platformRuntime: MACOS_PLATFORM_RUNTIME,
      probe: shellProbe,
    });

    environment.PATH = '/mutated';
    expect(facts.shell).toMatchObject({
      platform: 'macos',
      executable_path: '/bin/zsh',
      shell_version: 'zsh 5.9',
      snapshot_revision: 'app-owner-1',
      argv_prefix: ['-f', '-c'],
    });
    expect(facts.environment).toEqual({
      revision: 'app-owner-1',
      entries: { PATH: '/usr/bin:/bin' },
    });
    expect(facts.platformRuntime).toEqual({ schema_version: 1, platform: 'darwin' });
    expect(shellProbe.readVersion).toHaveBeenCalledOnce();
  });

  it('Windows 优先使用能真实启动的 PowerShell 7', () => {
    const shellProbe = probe({
      pwshPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      versions: { 'C:\\Program Files\\PowerShell\\7\\pwsh.exe': '7.5.2' },
    });
    const facts = resolveCommandRuntimeFacts({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
      revision: 'app-owner-2',
      platformRuntime: WINDOWS_PLATFORM_RUNTIME,
      probe: shellProbe,
    });

    expect(facts.shell).toMatchObject({
      shell_semantics_id: 'powershell-7',
      shell_version: '7.5.2',
      executable_path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    });
    expect(facts.platformRuntime).toMatchObject({
      platform: 'win32',
      trust: { kind: 'development' },
    });
  });

  it('PowerShell 7 不可运行时回退系统 Windows PowerShell 5.1', () => {
    const fallbackPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const shellProbe = probe({
      pwshPath: 'C:\\broken\\pwsh.exe',
      versions: {
        'C:\\broken\\pwsh.exe': undefined,
        [fallbackPath]: '5.1.19041.5608',
      },
    });
    const facts = resolveCommandRuntimeFacts({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      revision: 'app-owner-3',
      platformRuntime: WINDOWS_PLATFORM_RUNTIME,
      probe: shellProbe,
    });

    expect(facts.shell).toMatchObject({
      shell_semantics_id: 'powershell-5.1',
      shell_version: '5.1.19041.5608',
      executable_path: fallbackPath,
    });
    expect(shellProbe.readVersion).toHaveBeenCalledTimes(2);
  });

  it('Windows 启动快照按大小写合并环境且不合成缺失变量', () => {
    const fallbackPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const shellProbe = probe({ versions: { [fallbackPath]: '5.1.26100.8875' } });
    const facts = resolveCommandRuntimeFacts({
      platform: 'win32',
      environment: {
        PATH: 'C:\\old',
        Path: 'C:\\new;C:\\工具',
        sYsTeMrOoT: 'C:\\Windows',
      },
      revision: 'app-owner-windows-environment',
      platformRuntime: WINDOWS_PLATFORM_RUNTIME,
      probe: shellProbe,
    });

    expect(facts.environment.entries).toEqual({
      Path: 'C:\\new;C:\\工具',
      sYsTeMrOoT: 'C:\\Windows',
    });
    expect(shellProbe.resolveExecutable).toHaveBeenCalledWith(
      'pwsh.exe',
      facts.environment.entries,
    );
    expect(shellProbe.readVersion).toHaveBeenCalledWith(expect.objectContaining({
      executablePath: fallbackPath,
      environment: facts.environment.entries,
    }));
  });

  it('Windows 启动快照保留显式关键变量且不自行刷新 PATH', () => {
    const fallbackPath = 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const facts = resolveCommandRuntimeFacts({
      platform: 'win32',
      environment: {
        SystemRoot: 'D:\\Windows',
        PATH: 'D:\\frozen',
        COMSPEC: '',
        pathext: '.EXE;.CUSTOM',
      },
      revision: 'app-owner-explicit-windows-environment',
      platformRuntime: WINDOWS_PLATFORM_RUNTIME,
      probe: probe({ versions: { [fallbackPath]: '5.1' } }),
    });

    expect(facts.environment.entries).toMatchObject({
      PATH: 'D:\\frozen',
      COMSPEC: '',
      pathext: '.EXE;.CUSTOM',
    });
  });

  it('拒绝 Shell 与公共平台 owner 事实错配', () => {
    expect(() => resolveCommandRuntimeFacts({
      platform: 'darwin',
      environment: { PATH: '/usr/bin:/bin' },
      revision: 'app-owner-mismatch',
      platformRuntime: WINDOWS_PLATFORM_RUNTIME,
      probe: probe({ versions: { '/bin/zsh': 'zsh 5.9' } }),
    })).toThrow('macOS Shell received another local process platform runtime');
  });
});
