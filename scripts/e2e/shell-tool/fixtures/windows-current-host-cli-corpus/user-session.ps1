param(
  [Parameter(Mandatory = $true)][string]$RunRoot,
  [switch]$CleanupUser
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$unpackedRoot = Join-Path $RunRoot 'application\win-unpacked'
$isolationHelper = Join-Path $unpackedRoot 'resources\command-runtime\windows\x64\linnyaCommandIsolation.exe'
$reportPath = Join-Path $RunRoot $(if ($CleanupUser) { 'cleanup.json' } else { 'session.json' })
$appProcess = $null
function Wait-JsonResult {
  param([string]$Path, [Diagnostics.Process]$Owner)
  $deadline = [DateTime]::UtcNow.AddSeconds(480)
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
  if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'This fixture requires a logged-in desktop session' }
  if ($CleanupUser) {
    & $isolationHelper cleanup-user
    if ($LASTEXITCODE -ne 0) { throw 'fixture user permission recovery failed' }
    $report = @{ success = $true }
  } else {
    & $isolationHelper configure-user
    if ($LASTEXITCODE -ne 0) { throw 'fixture user filesystem setup failed' }
    $runRoot = $RunRoot
    $resultPath = Join-Path $RunRoot 'result.json'
    $executablePath = Join-Path $unpackedRoot 'Linnya Windows Current Host CLI Corpus.exe'
    $fixtureRoot = Join-Path $unpackedRoot 'resources\host-cli-fixtures'
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
    $report = @{ success = $true; appProcessId = [int]$appProcess.Id; result = $result }
  }
} catch {
  $report = @{ success = $false; error = $_.Exception.Message }
} finally {
  if ($appProcess) {
    if (-not $appProcess.HasExited) { $appProcess.Kill(); $appProcess.WaitForExit(5000) | Out-Null }
    $appProcess.Dispose()
  }
}
# 写完再发布，SSH controller 不读取半个 JSON。
[IO.File]::WriteAllText("$reportPath.tmp", ($report | ConvertTo-Json -Depth 12 -Compress), (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath "$reportPath.tmp" -Destination $reportPath
if (-not $report.success) { exit 1 }
