param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$RunRoot
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$runRoot = [IO.Path]::GetFullPath($RunRoot)
$applicationRoot = Join-Path $runRoot 'application'
$resultPath = Join-Path $runRoot 'result.json'
$appProcess = $null
$completed = $false

function Wait-JsonResult {
  param([string]$Path, [Diagnostics.Process]$Owner)
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  do {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      try {
        $text = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
        if (-not [string]::IsNullOrWhiteSpace($text)) { return ConvertFrom-Json $text }
      } catch [System.IO.IOException] {
      } catch [System.Management.Automation.RuntimeException] {
      }
    }
    if ($Owner.HasExited) { throw 'packaged Electron exited before publishing its result' }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'timed out waiting for packaged Windows host CLI corpus result'
}

try {
  New-Item -ItemType Directory -Path $applicationRoot -Force | Out-Null
  tar.exe -xzf $ArchivePath -C $applicationRoot
  if ($LASTEXITCODE -ne 0) { throw "archive extraction failed: $LASTEXITCODE" }
  $unpackedRoot = Join-Path $applicationRoot 'win-unpacked'
  $executablePath = Join-Path $unpackedRoot 'Linnya Windows Current Host CLI Corpus.exe'
  $fixtureRoot = Join-Path $unpackedRoot 'resources\host-cli-fixtures'
  if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw "packaged executable is missing: $executablePath"
  }
  foreach ($fixtureName in @('host-cli-cmd.cmd', 'host-cli-bat.bat')) {
    if (-not (Test-Path -LiteralPath (Join-Path $fixtureRoot $fixtureName) -PathType Leaf)) {
      throw "host CLI fixture is missing: $fixtureName"
    }
  }

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $executablePath
  $startInfo.WorkingDirectory = $unpackedRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.Arguments = '--no-error-dialogs --enable-logging=stderr'
  $startInfo.EnvironmentVariables['LINNYA_WINDOWS_HOST_CLI_RESULT_PATH'] = $resultPath
  $startInfo.EnvironmentVariables['LINNYA_WINDOWS_HOST_CLI_RUN_ROOT'] = $runRoot
  $startInfo.EnvironmentVariables['Path'] = $fixtureRoot + ';' + $env:Path
  $startInfo.EnvironmentVariables['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'
  $appProcess = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $appProcess) { throw 'failed to start packaged Electron' }
  $stdoutTask = $appProcess.StandardOutput.ReadToEndAsync()
  $stderrTask = $appProcess.StandardError.ReadToEndAsync()
  $result = Wait-JsonResult -Path $resultPath -Owner $appProcess
  if (-not $appProcess.WaitForExit(30000)) { throw 'packaged Electron did not exit' }
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  if ($appProcess.ExitCode -ne 0) {
    throw "packaged Electron failed: code=$($appProcess.ExitCode); stderr=$stderr; stdout=$stdout"
  }
  if ($result.success -ne $true) { throw "scenario failed: $($result.error)" }
  $completed = $true
  [ordered]@{
    success = $true
    appProcessId = [int]$appProcess.Id
    version = [int]$result.version
    platform = [string]$result.platform
    architecture = [string]$result.architecture
    electron = [string]$result.electron
    shell = [string]$result.shell
    packagedElectronDevelopmentTrust = [bool]$result.packagedElectronDevelopmentTrust
    windowsNativeJobRuntimeConfigured = [bool]$result.windowsNativeJobRuntimeConfigured
    pythonAliasExecuted = [bool]$result.pythonAliasExecuted
    cases = @($result.cases)
  } | ConvertTo-Json -Depth 6 -Compress
} finally {
  if (-not $completed -and $appProcess -and -not $appProcess.HasExited) {
    $appProcess.Kill()
    $appProcess.WaitForExit(5000) | Out-Null
  }
  if ($appProcess) { $appProcess.Dispose() }
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
}
