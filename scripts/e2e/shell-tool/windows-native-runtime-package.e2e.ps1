param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

function Remove-RunRootWhenUnlocked {
  param([string]$RunRoot)

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  $lastError = $null
  do {
    try {
      Remove-Item -LiteralPath $RunRoot -Recurse -Force -ErrorAction Stop
      return
    } catch [System.UnauthorizedAccessException] {
      $lastError = $_.Exception
    } catch [System.IO.IOException] {
      $lastError = $_.Exception
    }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "packaged runtime directory remained locked: $($lastError.Message)"
}

function Stop-ValidationProcessTree {
  param([Diagnostics.Process]$Process)

  if ($null -eq $Process -or $Process.HasExited) { return }
  $taskkillPath = Join-Path $env:SystemRoot 'System32\taskkill.exe'
  & $taskkillPath /PID $Process.Id /T /F | Out-Null
}

function Invoke-DevelopmentAfterSign {
  param(
    [string]$AppPath,
    [string]$AppOutDir
  )

  $driverPath = Join-Path $AppOutDir 'resources\command-runtime-validation\after-sign-driver.mjs'
  if (-not (Test-Path -LiteralPath $driverPath -PathType Leaf)) {
    throw "afterSign validation driver does not exist: $driverPath"
  }
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $AppPath
  $startInfo.WorkingDirectory = $AppOutDir
  $startInfo.Arguments = '"' + $driverPath + '" "' + $AppOutDir + '"'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
  $startInfo.EnvironmentVariables['LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST'] = 'development'
  $hookProcess = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $hookProcess) { throw 'afterSign validation process did not start' }
  try {
    $stdoutTask = $hookProcess.StandardOutput.ReadToEndAsync()
    $stderrTask = $hookProcess.StandardError.ReadToEndAsync()
    if (-not $hookProcess.WaitForExit(30000)) {
      Stop-ValidationProcessTree -Process $hookProcess
      throw 'development afterSign validation timed out'
    }
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    if ($hookProcess.ExitCode -ne 0) {
      throw "development afterSign failed: exit=$($hookProcess.ExitCode) stderr=$stderr stdout=$stdout"
    }
    $result = $stdout.Trim() | ConvertFrom-Json
    if (-not $result.success) { throw 'development afterSign did not publish success' }
  } finally {
    Stop-ValidationProcessTree -Process $hookProcess
    $hookProcess.Dispose()
  }
}

$remoteTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$resolvedArchive = [IO.Path]::GetFullPath($ArchivePath)
$unicodeSegment = [string]([char]0x539F) + [char]0x751F + [char]0x8FD0 + [char]0x884C + [char]0x65F6
$runRoot = Join-Path $remoteTemp ('linnya ' + $unicodeSegment + ' ' + [Guid]::NewGuid().ToString('N'))
$process = $null
$completed = $false
$summary = $null
try {
  New-Item -ItemType Directory -Path $runRoot | Out-Null
  & tar.exe -xzf $resolvedArchive -C $runRoot
  if ($LASTEXITCODE -ne 0) { throw "tar failed: $LASTEXITCODE" }

  $appPath = Join-Path $runRoot 'win-unpacked\Linnya Windows Native Runtime Validation.exe'
  $resultPath = Join-Path $runRoot 'runtime-result.json'
  if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) {
    throw "packaged executable does not exist: $appPath"
  }
  Invoke-DevelopmentAfterSign -AppPath $appPath -AppOutDir (Split-Path -Parent $appPath)
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $appPath
  $startInfo.WorkingDirectory = Split-Path -Parent $appPath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables['LINNYA_WINDOWS_NATIVE_RUNTIME_RESULT_PATH'] = $resultPath
  $startInfo.EnvironmentVariables['LINNYA_WINDOWS_NATIVE_RUNTIME_RUN_ROOT'] = $runRoot
  $process = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) { throw 'packaged process did not start' }
  # 必须在等待退出前并发排空两个 pipe；否则诊断输出填满时主进程和控制器会互等。
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(60000)) {
    Stop-ValidationProcessTree -Process $process
    throw 'packaged Windows native runtime suite timed out'
  }
  # Windows PowerShell 5.1 在空字符串 Task 上会错误投影 GetAwaiter 链；
  # 直接读取 Result 仍保持前面已开始的并发 drain，并等待最后的 EOF。
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  if ($process.ExitCode -ne 0) {
    throw "suite exit=$($process.ExitCode) stderr=$stderr stdout=$stdout"
  }
  if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
    throw 'packaged suite did not publish a result'
  }
  $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
  if (-not $result.success -or -not $result.packaged) { throw 'suite identity mismatch' }
  if ($result.normal.output -ne 'packaged-native-runtime-ok' -or $result.normal.exitCode -ne 0) {
    throw 'normal native command failed'
  }
  if ($result.repaired.output -ne 'packaged-native-runtime-ok' -or $result.repaired.exitCode -ne 0) {
    throw 'repaired native command failed'
  }
  if ($result.failures.missingCurrentArtifact -ne 'artifact_unavailable') {
    throw 'missing artifact did not fail closed'
  }
  if ($result.failures.changedByte -ne 'artifact_hash_mismatch') {
    throw 'changed byte did not fail hash verification'
  }
  if (
    $result.failures.wrongArchitecture -ne 'runtime_mismatch' -or
    $result.failures.oldApplication -ne 'runtime_mismatch' -or
    $result.failures.oldRuntime -ne 'runtime_mismatch'
  ) {
    throw 'runtime identity mismatch was accepted'
  }
  $summary = [pscustomobject]@{
    success = $true
    platform = $result.platform
    architecture = $result.architecture
    electron = $result.electron
    appVersion = $result.appVersion
    artifactSize = $result.artifactSize
    artifactSha256 = $result.artifactSha256
    runtimeRealPath = $result.runtimeRealPath
    normalOutput = $result.normal.output
    repairedOutput = $result.repaired.output
    failures = $result.failures
    developmentAfterSignVerified = $true
    directoryUnlockedAfterExit = $true
  }
  $completed = $true
} catch {
  $position = $_.InvocationInfo.PositionMessage
  $stack = $_.ScriptStackTrace
  throw "controller failure: $($_.Exception.Message); position=$position; stack=$stack"
} finally {
  if ($process) {
    Stop-ValidationProcessTree -Process $process
    $process.Dispose()
  }
  if (Test-Path -LiteralPath $runRoot) {
    Remove-RunRootWhenUnlocked -RunRoot $runRoot
  }
}

if (-not $completed -or (Test-Path -LiteralPath $runRoot)) {
  throw 'packaged Windows native runtime harness did not cleanly complete'
}
$summary | ConvertTo-Json -Compress -Depth 6
