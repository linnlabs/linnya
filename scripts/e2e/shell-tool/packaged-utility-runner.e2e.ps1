param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class LinnyaUtilityJobProbe {
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    public static bool IsInJob(int processId) {
        IntPtr handle = OpenProcess(0x1000, false, processId);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            bool result;
            if (!IsProcessInJob(handle, IntPtr.Zero, out result)) {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            return result;
        } finally {
            CloseHandle(handle);
        }
    }
}
'@

function New-ValidationProcess {
  param(
    [string]$ExecutablePath,
    [string]$ResultPath,
    [string]$Mode
  )

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ExecutablePath
  $startInfo.WorkingDirectory = Split-Path -Parent $ExecutablePath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables['LINNYA_UTILITY_RUNNER_RESULT_PATH'] = $ResultPath
  if ($Mode -ne 'suite') {
    $startInfo.EnvironmentVariables['LINNYA_UTILITY_RUNNER_MODE'] = $Mode
  }
  return [Diagnostics.Process]::Start($startInfo)
}

function Test-SameProcess {
  param(
    [int]$ProcessId,
    [Int64]$StartTimeUtcTicks
  )

  try {
    $candidate = [Diagnostics.Process]::GetProcessById($ProcessId)
    try {
      return -not $candidate.HasExited -and $candidate.StartTime.ToUniversalTime().Ticks -eq $StartTimeUtcTicks
    } finally {
      $candidate.Dispose()
    }
  } catch [ArgumentException] {
    return $false
  } catch [InvalidOperationException] {
    return $false
  }
}

function Test-ProcessFromRunRoot {
  param(
    [int]$ProcessId,
    [string]$RunRoot
  )

  try {
    $candidate = [Diagnostics.Process]::GetProcessById($ProcessId)
    try {
      $executablePath = $candidate.MainModule.FileName
      return $executablePath.StartsWith($RunRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    } finally {
      $candidate.Dispose()
    }
  } catch [ArgumentException] {
    return $false
  } catch [InvalidOperationException] {
    return $false
  } catch [System.ComponentModel.Win32Exception] {
    return $false
  }
}

function Get-ElectronProcessIdentities {
  param(
    [object[]]$Metrics,
    [int]$OwnerProcessId
  )

  $known = @()
  foreach ($metric in $Metrics) {
    $processId = [int]$metric.pid
    if ($processId -eq $OwnerProcessId) { continue }
    try {
      $process = [Diagnostics.Process]::GetProcessById($processId)
      try {
        $known += [pscustomobject]@{
          processId = $processId
          startTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks
          type = [string]$metric.type
        }
      } finally {
        $process.Dispose()
      }
    } catch [ArgumentException] {
    }
  }
  return @($known)
}

function Remove-RunRootWhenUnlocked {
  param([string]$RunRoot)

  if (-not (Test-Path -LiteralPath $RunRoot)) { return }
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    try {
      Remove-Item -LiteralPath $RunRoot -Recurse -Force -ErrorAction Stop
      return
    } catch [System.UnauthorizedAccessException] {
      Start-Sleep -Milliseconds 50
    } catch [System.IO.IOException] {
      Start-Sleep -Milliseconds 50
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "run root remained locked: $RunRoot"
}

function Wait-ForResultFile {
  param(
    [Diagnostics.Process]$Process,
    [string]$ResultPath,
    [int]$TimeoutMilliseconds
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    if ($Process.HasExited) {
      throw "process exited before publishing result: $($Process.ExitCode)"
    }
    if (Test-Path -LiteralPath $ResultPath) {
      return Get-Content -Raw -LiteralPath $ResultPath | ConvertFrom-Json
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "result file timed out: $ResultPath"
}

$remoteTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$resolvedArchive = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $resolvedArchive -PathType Leaf)) {
  throw "archive does not exist: $resolvedArchive"
}
$runRoot = Join-Path $remoteTemp ('linnya-utility-runner-' + [Guid]::NewGuid().ToString('N'))
$resolvedRunRoot = [IO.Path]::GetFullPath($runRoot)
if (-not $resolvedRunRoot.StartsWith($remoteTemp + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "run root escaped Windows temp: $resolvedRunRoot"
}

$suiteProcess = $null
$ownerProcess = $null
$ownerDescendants = @()
$summary = $null
$completed = $false
try {
  New-Item -ItemType Directory -Path $resolvedRunRoot | Out-Null
  & tar.exe -xzf $resolvedArchive -C $resolvedRunRoot
  if ($LASTEXITCODE -ne 0) {
    throw "tar failed: $LASTEXITCODE"
  }

  $appPath = Join-Path $resolvedRunRoot 'win-unpacked\Linnya Utility Runner Validation.exe'
  $suiteResultPath = Join-Path $resolvedRunRoot 'suite-result.json'
  $suiteProcess = New-ValidationProcess -ExecutablePath $appPath -ResultPath $suiteResultPath -Mode 'suite'
  $suiteMainPid = $suiteProcess.Id
  if (-not $suiteProcess.WaitForExit(60000)) {
    $suiteProcess.Kill()
    throw 'packaged utility suite timed out'
  }
  $suiteStdout = $suiteProcess.StandardOutput.ReadToEnd()
  $suiteStderr = $suiteProcess.StandardError.ReadToEnd()
  $suiteExitCode = $suiteProcess.ExitCode
  if ($suiteExitCode -ne 0) {
    throw "suite exit=$suiteExitCode stderr=$suiteStderr stdout=$suiteStdout"
  }
  if (-not (Test-Path -LiteralPath $suiteResultPath)) {
    throw 'suite did not publish result'
  }
  $suiteResult = Get-Content -Raw -LiteralPath $suiteResultPath | ConvertFrom-Json
  if (-not $suiteResult.success -or -not $suiteResult.packaged -or $suiteResult.platform -ne 'win32') {
    throw 'suite result identity mismatch'
  }
  if ($suiteResult.transport.outputBytes -ne 8388608 -or $suiteResult.transport.maxInFlightEvents -ne 1) {
    throw 'suite transport byte or in-flight result mismatch'
  }

  if (-not $suiteProcess.HasExited) {
    throw 'suite main remained active after WaitForExit'
  }
  $suiteUtilityPids = @(
    [int]$suiteResult.transport.utilityPid,
    [int]$suiteResult.acknowledgementTimeout.utilityPid,
    [int]$suiteResult.killDuringOutput.utilityPid
  )
  foreach ($suiteUtilityPid in $suiteUtilityPids) {
    if (Test-ProcessFromRunRoot -ProcessId $suiteUtilityPid -RunRoot $resolvedRunRoot) {
      throw "utility from this run remains after suite: $suiteUtilityPid"
    }
  }

  $ownerResultPath = Join-Path $resolvedRunRoot 'owner-result.json'
  $ownerProcess = New-ValidationProcess -ExecutablePath $appPath -ResultPath $ownerResultPath -Mode 'owner-crash'
  $ownerPid = $ownerProcess.Id
  $ownerStartTimeUtcTicks = $ownerProcess.StartTime.ToUniversalTime().Ticks
  $ownerResult = Wait-ForResultFile -Process $ownerProcess -ResultPath $ownerResultPath -TimeoutMilliseconds 20000
  if ($ownerResult.status -ne 'ready_for_owner_crash' -or [int]$ownerResult.mainPid -ne $ownerPid) {
    throw 'owner-crash result identity mismatch'
  }

  $utilityPid = [int]$ownerResult.utilityPid
  $utility = [Diagnostics.Process]::GetProcessById($utilityPid)
  try {
    $utilityStartTimeUtcTicks = $utility.StartTime.ToUniversalTime().Ticks
  } finally {
    $utility.Dispose()
  }
  $ownerInJob = [LinnyaUtilityJobProbe]::IsInJob($ownerPid)
  $utilityInJob = [LinnyaUtilityJobProbe]::IsInJob($utilityPid)
  $ownerDescendants = @(
    Get-ElectronProcessIdentities `
      -Metrics @($ownerResult.electronProcesses) `
      -OwnerProcessId $ownerPid
  )

  if (-not (Test-SameProcess -ProcessId $ownerPid -StartTimeUtcTicks $ownerStartTimeUtcTicks)) {
    throw 'Electron main identity changed before owner crash injection'
  }
  Stop-Process -Id $ownerPid -Force
  $ownerProcess.WaitForExit()

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $remaining = @($ownerDescendants | Where-Object {
      Test-SameProcess -ProcessId $_.processId -StartTimeUtcTicks $_.startTimeUtcTicks
    })
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($remaining.Count -gt 0) {
    throw "Electron descendants remain after main crash: $($remaining | ConvertTo-Json -Compress -Depth 5)"
  }
  if (Test-SameProcess -ProcessId $utilityPid -StartTimeUtcTicks $utilityStartTimeUtcTicks) {
    throw 'utility remains after Electron main crash'
  }

  $summary = [pscustomobject]@{
    success = $true
    platform = $suiteResult.platform
    architecture = $suiteResult.architecture
    electron = $suiteResult.electron
    outputBytes = $suiteResult.transport.outputBytes
    maxInFlightEvents = $suiteResult.transport.maxInFlightEvents
    exitBeforeReady = $suiteResult.exitBeforeReady
    acknowledgementTimeout = $suiteResult.acknowledgementTimeout
    killDuringOutput = $suiteResult.killDuringOutput
    suiteMainDiagnosticObserved = $suiteStderr.Length -gt 0
    ownerPid = $ownerPid
    utilityPid = $utilityPid
    ownerInJob = $ownerInJob
    utilityInJob = $utilityInJob
    descendantsBeforeKill = $ownerDescendants
    descendantsAfterKill = 0
  }
  $completed = $true
} finally {
  if ($suiteProcess) {
    if (-not $suiteProcess.HasExited) { $suiteProcess.Kill() }
    $suiteProcess.Dispose()
  }
  if ($ownerProcess) {
    if (-not $ownerProcess.HasExited) { $ownerProcess.Kill() }
    if (-not $ownerProcess.HasExited) { $ownerProcess.WaitForExit(5000) | Out-Null }
    $ownerProcess.Dispose()
  }
  foreach ($identity in $ownerDescendants) {
    if (Test-SameProcess -ProcessId $identity.processId -StartTimeUtcTicks $identity.startTimeUtcTicks) {
      Stop-Process -Id $identity.processId -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-RunRootWhenUnlocked -RunRoot $resolvedRunRoot
}

if (-not $completed -or (Test-Path -LiteralPath $resolvedRunRoot)) {
  throw 'Windows packaged utility harness did not reach clean completion'
}
$summary | ConvertTo-Json -Compress -Depth 8
