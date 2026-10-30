import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  parseLocalProcessPlatformRuntime,
  type LocalProcessPlatformRuntime,
} from '../../platform-runtime';
import {
  WindowsApplicationSignatureSchema,
  type WindowsApplicationSignatureProbePort,
} from '../definitions/windowsApplicationSignature';

const WINDOWS_LOCAL_PROCESS_RUNTIME_VERSION = '0.1.0';

const nodeWindowsApplicationSignatureProbe: WindowsApplicationSignatureProbePort = Object.freeze({
  readAuthenticodeSignature(input: {
    readonly executablePath: string;
    readonly environment: Readonly<Record<string, string>>;
  }) {
    if (process.platform !== 'win32') return undefined;
    const windowsRoot = Object.entries(input.environment).find(
      ([name]) => name.toLowerCase() === 'systemroot',
    )?.[1];
    if (!windowsRoot) return undefined;
    const powershellPath = path.win32.join(
      windowsRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const inspectionPathKey = 'LINNYA_APPLICATION_AUTHENTICODE_INSPECTION_PATH';
    const inspectionEnvironment: Record<string, string> = {
      ...input.environment,
      [inspectionPathKey]: input.executablePath,
    };
    delete inspectionEnvironment.PSModulePath;
    delete inspectionEnvironment.PSMODULEPATH;
    const source = [
      "$ErrorActionPreference = 'Stop'",
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      "$securityModule = Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
      'Import-Module -Name $securityModule -Force -ErrorAction Stop',
      `$signature = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:${inspectionPathKey}`,
      '$publisher = if ($null -eq $signature.SignerCertificate) { $null } else { [string]$signature.SignerCertificate.Subject }',
      '@{ status = [string]$signature.Status; publisher = $publisher } | ConvertTo-Json -Compress',
    ].join('\n');
    const result = spawnSync(powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      source,
    ], {
      encoding: 'utf8',
      env: inspectionEnvironment,
      timeout: 3_000,
      windowsHide: true,
    });
    if (result.status !== 0) return undefined;
    const signature = WindowsApplicationSignatureSchema.safeParse(JSON.parse(result.stdout));
    return signature.success ? signature.data : undefined;
  },
});

/**
 * Electron host 只在 App owner 启动时验证一次本地进程 owner 的发布事实。后续
 * Commands、Sandbox 与 Qdrant 共享同一个 data-only DTO，不各自猜 manifest 或信任来源。
 */
export function resolveLocalProcessPlatformRuntime(input: {
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  readonly applicationVersion: string;
  readonly applicationExecutablePath: string;
  readonly resourcesPath: string;
  readonly packaged: boolean;
  readonly hostEnvironment: Readonly<Record<string, string>>;
  readonly signatureProbe?: WindowsApplicationSignatureProbePort;
}): LocalProcessPlatformRuntime {
  if (input.platform === 'darwin') {
    return parseLocalProcessPlatformRuntime({ schema_version: 1, platform: 'darwin' });
  }
  if (input.platform !== 'win32') {
    throw new Error(`local process runtime does not support platform ${input.platform}`);
  }
  if (input.architecture !== 'x64' && input.architecture !== 'arm64') {
    throw new Error(`Windows local process runtime does not support architecture ${input.architecture}`);
  }

  const trust = input.packaged
    ? resolveReleaseTrust(input)
    : { kind: 'development' as const };
  return parseLocalProcessPlatformRuntime({
    schema_version: 1,
    platform: 'win32',
    manifest_path: path.win32.join(
      input.resourcesPath,
      'command-runtime',
      'windows',
      input.architecture,
      'linnyaCommandProcessOwner.manifest.json',
    ),
    expected_runtime_version: WINDOWS_LOCAL_PROCESS_RUNTIME_VERSION,
    expected_application_version: input.applicationVersion,
    trust,
  });
}

function resolveReleaseTrust(input: {
  readonly applicationExecutablePath: string;
  readonly hostEnvironment: Readonly<Record<string, string>>;
  readonly signatureProbe?: WindowsApplicationSignatureProbePort;
}): { readonly kind: 'release'; readonly expected_publisher_identity: string }
  | { readonly kind: 'release_unsigned' } {
  // expected publisher 必须来自已签名 App 自身，而不是同目录可改 manifest 或普通环境变量。
  const signature = (input.signatureProbe ?? nodeWindowsApplicationSignatureProbe)
    .readAuthenticodeSignature({
      executablePath: input.applicationExecutablePath,
      environment: input.hostEnvironment,
    });
  if (!signature) {
    throw new Error('Packaged Windows local process runtime requires a valid signature or explicit NotSigned status');
  }
  if (signature.status === 'NotSigned') {
    // loader 仍必须匹配发布管线的 release_unsigned 证据并复核全部字节；不能接受开发清单。
    return { kind: 'release_unsigned' };
  }
  return { kind: 'release', expected_publisher_identity: signature.publisher };
}
