#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  assertWindowsVcRuntimeAuthenticode,
  prepareWindowsAppLocalRuntime,
  resolveWindowsVcRuntimeSource,
} = require('./functions/production-package-contract.cjs');

function readOption(optionName) {
  const optionIndex = process.argv.indexOf(optionName);
  const value = optionIndex < 0 ? undefined : process.argv[optionIndex + 1];
  if (!value || value.startsWith('--')) throw new Error(`${optionName} requires a value`);
  return value;
}

function inspectAuthenticodeSignature(filePath) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    "$securityModule = Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
    'Import-Module -Name $securityModule -Force -ErrorAction Stop',
    '$signature = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:LINNYA_WINDOWS_RUNTIME_FILE',
    '$result = [pscustomobject]@{ status = [string]$signature.Status; subject = $signature.SignerCertificate.Subject }',
    '$result | ConvertTo-Json -Compress',
  ].join('; ');
  // 与 afterSign 保持一致：PowerShell 7 的模块搜索路径不能带进系统 Windows PowerShell。
  const environment = { ...process.env, LINNYA_WINDOWS_RUNTIME_FILE: filePath };
  delete environment.PSModulePath;
  delete environment.PSMODULEPATH;
  return JSON.parse(execFileSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      env: environment,
    },
  ));
}

function prepareRuntime() {
  if (process.platform !== 'win32') {
    throw new Error('Windows app-local VC runtime must be prepared on the Windows packaging host');
  }
  const projectDirectory = path.resolve(readOption('--project-dir'));
  const architecture = readOption('--arch');
  const sourceDirectory = resolveWindowsVcRuntimeSource({
    environment: process.env,
    architecture,
  });
  const targetDirectory = path.join(
    projectDirectory,
    'build',
    'windows-app-local-runtime',
    architecture,
  );
  const runtimeFiles = prepareWindowsAppLocalRuntime({
    sourceDirectory,
    targetDirectory,
    architecture,
    verifySourceFile: filePath => assertWindowsVcRuntimeAuthenticode({
      filePath,
      ...inspectAuthenticodeSignature(filePath),
    }),
  });
  console.log(
    `[windows-app-local-runtime] verified and copied ${runtimeFiles.length} ${architecture} DLLs`,
  );
}

try {
  prepareRuntime();
} catch (error) {
  console.error(
    `[windows-app-local-runtime] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
