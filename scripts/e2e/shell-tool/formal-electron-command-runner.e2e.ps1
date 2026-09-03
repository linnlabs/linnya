param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

function New-ValidationProcess {
  param(
    [string]$ExecutablePath,
    [string]$ResultPath,
    [string]$RunRoot,
    [string]$Mode = 'settlement',
    [string]$CrashToken = ''
  )

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ExecutablePath
  $startInfo.WorkingDirectory = Split-Path -Parent $ExecutablePath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $userDataPath = Join-Path $RunRoot ('electron-user-data-' + $Mode)
  New-Item -ItemType Directory -Path $userDataPath -Force | Out-Null
  $startInfo.Arguments = '--no-error-dialogs --enable-logging=stderr --user-data-dir="' + $userDataPath + '"'
  $startInfo.EnvironmentVariables['LINNYA_FORMAL_RUNNER_RESULT_PATH'] = $ResultPath
  $startInfo.EnvironmentVariables['LINNYA_FORMAL_RUNNER_CWD'] = $RunRoot
  $startInfo.EnvironmentVariables['LINNYA_FORMAL_RUNNER_MODE'] = $Mode
  if ($CrashToken) {
    $startInfo.EnvironmentVariables['LINNYA_FORMAL_RUNNER_CRASH_TOKEN'] = $CrashToken
  }
  return [Diagnostics.Process]::Start($startInfo)
}

function Wait-JsonPhase {
  param(
    [string]$Path,
    [string]$Phase,
    [int]$TimeoutSeconds = 30
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      try {
        $value = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
        if ($value.success -eq $false) {
          throw "packaged fixture failed: $($value.error)"
        }
        if ($value.phase -eq $Phase) { return $value }
      } catch [System.ArgumentException] {
      }
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "timed out waiting for $Phase at $Path"
}

function Wait-PositivePidFile {
  param(
    [string]$Path,
    [int]$TimeoutSeconds = 10
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      try {
        $parsed = 0
        if ([Int32]::TryParse((Get-Content -Raw -LiteralPath $Path).Trim(), [ref]$parsed) -and $parsed -gt 0) {
          return $parsed
        }
      } catch [System.IO.IOException] {
      }
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "timed out waiting for positive PID at $Path"
}

function Wait-HeartbeatProgress {
  param(
    [string]$Path,
    [string]$RunToken,
    [int]$ExpectedPid,
    [int]$TimeoutSeconds = 10
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      try {
        $lines = @(Get-Content -LiteralPath $Path | Where-Object { $_ })
        if ($lines.Count -ge 2) {
          $previous = $lines[$lines.Count - 2].Split("`t")
          $latest = $lines[$lines.Count - 1].Split("`t")
          if (
            $latest.Count -ne 5 -or
            $latest[0] -ne $RunToken -or
            $latest[1] -ne 'root' -or
            [int]$latest[2] -ne $ExpectedPid -or
            [int64]$latest[3] -le [int64]$previous[3]
          ) {
            throw 'utility-crash heartbeat identity or sequence mismatch'
          }
          return $lines[$lines.Count - 1]
        }
      } catch [System.IO.IOException] {
      }
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "timed out waiting for heartbeat progress at $Path"
}

function Wait-ProcessesExited {
  param(
    [object[]]$ProcessIdentities,
    [int]$TimeoutSeconds = 10
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $remaining = @($ProcessIdentities | Where-Object { Test-ProcessIdentity -Identity $_ })
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  $remainingIds = @($remaining | ForEach-Object { $_.ProcessId })
  throw "processes remained after utility crash: $($remainingIds -join ',')"
}

function Get-ProcessIdentity {
  param([int]$ProcessId)

  $candidate = [Diagnostics.Process]::GetProcessById($ProcessId)
  try {
    return [pscustomobject]@{
      ProcessId = $ProcessId
      StartTimeUtcTicks = $candidate.StartTime.ToUniversalTime().Ticks
    }
  } finally {
    $candidate.Dispose()
  }
}

function Test-ProcessIdentity {
  param([object]$Identity)

  if (-not $Identity) { return $false }
  try {
    $candidate = [Diagnostics.Process]::GetProcessById([int]$Identity.ProcessId)
    try {
      return $candidate.StartTime.ToUniversalTime().Ticks -eq [int64]$Identity.StartTimeUtcTicks
    } finally {
      $candidate.Dispose()
    }
  } catch [ArgumentException] {
    return $false
  } catch [InvalidOperationException] {
    return $false
  }
}

function Stop-ProcessIdentity {
  param(
    [object]$Identity,
    [switch]$AllowAlreadyExited
  )

  if (Test-ProcessIdentity -Identity $Identity) {
    Stop-Process -Id ([int]$Identity.ProcessId) -Force -ErrorAction Stop
    return
  }
  if (-not $AllowAlreadyExited) {
    throw "process identity no longer matches PID $($Identity.ProcessId)"
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

function Remove-RunRootWhenUnlocked {
  param([string]$RunRoot)

  if (-not (Test-Path -LiteralPath $RunRoot)) { return }
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  $lastRemovalError = $null
  do {
    try {
      Remove-Item -LiteralPath $RunRoot -Recurse -Force -ErrorAction Stop
      return
    } catch [System.UnauthorizedAccessException] {
      $lastRemovalError = $_.Exception
      Start-Sleep -Milliseconds 50
    } catch [System.IO.IOException] {
      $lastRemovalError = $_.Exception
      Start-Sleep -Milliseconds 50
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  $runRootProcesses = @(Get-Process | ForEach-Object {
      try {
        $executablePath = $_.MainModule.FileName
        if ($executablePath.StartsWith($RunRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
          "$($_.Id):$($_.ProcessName):$executablePath"
        }
      } catch {
      }
    })
  $processEvidence = if ($runRootProcesses.Count -eq 0) {
    'none'
  } else {
    $runRootProcesses -join ','
  }
  throw "run root remained locked: $RunRoot; last error: $($lastRemovalError.Message); processes: $processEvidence"
}

$remoteTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$resolvedArchive = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $resolvedArchive -PathType Leaf)) {
  throw "archive does not exist: $resolvedArchive"
}
$runRoot = Join-Path $remoteTemp ('linnya-formal-command-runner-' + [Guid]::NewGuid().ToString('N'))
$resolvedRunRoot = [IO.Path]::GetFullPath($runRoot)
if (-not $resolvedRunRoot.StartsWith($remoteTemp + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "run root escaped Windows temp: $resolvedRunRoot"
}

$process = $null
$crashProcess = $null
$utilityPid = 0
$businessPid = 0
$utilityIdentity = $null
$businessIdentity = $null
$observedProcessIds = @()
$summary = $null
$completed = $false
try {
  New-Item -ItemType Directory -Path $resolvedRunRoot | Out-Null
  & tar.exe -xzf $resolvedArchive -C $resolvedRunRoot
  if ($LASTEXITCODE -ne 0) {
    throw "tar failed: $LASTEXITCODE"
  }

  $appPath = Join-Path $resolvedRunRoot 'win-unpacked\Linnya Formal Command Runner Validation.exe'
  $resultPath = Join-Path $resolvedRunRoot 'result.json'
  $process = New-ValidationProcess -ExecutablePath $appPath -ResultPath $resultPath -RunRoot $resolvedRunRoot
  if (-not $process.WaitForExit(60000)) {
    $resultEvidence = if (Test-Path -LiteralPath $resultPath -PathType Leaf) {
      Get-Content -Raw -LiteralPath $resultPath
    } else {
      'missing'
    }
    $stagePath = $resultPath + '.stages.log'
    $stageEvidence = if (Test-Path -LiteralPath $stagePath -PathType Leaf) {
      (Get-Content -LiteralPath $stagePath) -join ','
    } else {
      'missing'
    }
    $runRootProcesses = @(Get-Process | ForEach-Object {
        try {
          $executablePath = $_.MainModule.FileName
          if ($executablePath.StartsWith($resolvedRunRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            "$($_.Id):$($_.ProcessName):$executablePath"
          }
        } catch {
        }
      })
    $processEvidence = if ($runRootProcesses.Count -eq 0) {
      'none'
    } else {
      $runRootProcesses -join ','
    }
    $process.Kill()
    throw "formal command runner suite timed out; stages=$stageEvidence; result=$resultEvidence; processes=$processEvidence"
  }
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  if ($process.ExitCode -ne 0) {
    throw "suite exit=$($process.ExitCode) stderr=$stderr stdout=$stdout"
  }
  if (-not (Test-Path -LiteralPath $resultPath)) {
    throw 'suite did not publish result'
  }
  $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
  if (-not $result.success -or -not $result.packaged -or $result.platform -ne 'win32') {
    throw 'suite result identity mismatch'
  }
  if ($result.normal.output -ne 'formal-adapter-output') {
    throw 'normal command output mismatch'
  }
  if ($result.normal.terminationCause -ne 'natural_exit') {
    throw 'normal command terminal mismatch'
  }
  if ($result.ownerEnd.terminationCause -ne 'owner_ended') {
    throw 'owner-end command terminal mismatch'
  }
  if (
    -not $result.ptyInput.output.Contains('pty-input:accepted-value') -or
    $result.ptyInput.terminationCause -ne 'natural_exit' -or
    -not $result.ptyInput.interactionAccepted
  ) {
    throw 'PTY input command mismatch'
  }
  if ($result.ptyOwnerEnd.terminationCause -ne 'owner_ended') {
    throw 'PTY owner-end command terminal mismatch'
  }
  if (
    $result.normal.processExit.status -ne 'observed' -or
    $result.normal.processExit.exit_code -ne 0 -or
    $null -ne $result.normal.processExit.signal -or
    $result.ownerEnd.processExit.status -ne 'observed' -or
    $result.ptyInput.processExit.status -ne 'observed' -or
    $result.ptyInput.processExit.exit_code -ne 0 -or
    $result.ptyOwnerEnd.processExit.status -ne 'observed'
  ) {
    throw 'platform process-exit observation mismatch'
  }
  foreach ($scenario in @($result.normal, $result.ownerEnd, $result.ptyInput, $result.ptyOwnerEnd)) {
    if (
      $scenario.outputDrain.status -ne 'complete' -or
      $scenario.treeCleanup.status -ne 'succeeded' -or
      $scenario.resourceRelease.status -ne 'succeeded'
    ) {
      throw 'platform owner settlement mismatch'
    }
  }

  $crashToken = [Guid]::NewGuid().ToString('N')
  $crashResultPath = Join-Path $resolvedRunRoot 'utility-crash-result.json'
  $crashProcess = New-ValidationProcess `
    -ExecutablePath $appPath `
    -ResultPath $crashResultPath `
    -RunRoot $resolvedRunRoot `
    -Mode 'utility-crash' `
    -CrashToken $crashToken
  $crashReady = Wait-JsonPhase -Path $crashResultPath -Phase 'utility_crash_ready'
  if ($crashReady.runToken -ne $crashToken -or $crashReady.platform -ne 'win32') {
    throw 'utility-crash ready identity mismatch'
  }
  $utilityPid = [int]$crashReady.utilityPid
  $businessPid = Wait-PositivePidFile -Path $crashReady.businessPidPath
  $utilityIdentity = Get-ProcessIdentity -ProcessId $utilityPid
  $businessIdentity = Get-ProcessIdentity -ProcessId $businessPid
  $null = Wait-HeartbeatProgress `
    -Path $crashReady.heartbeatPath `
    -RunToken $crashToken `
    -ExpectedPid $businessPid
  Stop-ProcessIdentity -Identity $utilityIdentity
  Wait-ProcessesExited -ProcessIdentities @($utilityIdentity, $businessIdentity)
  $heartbeatAtExit = @(Get-Content -LiteralPath $crashReady.heartbeatPath | Where-Object { $_ })[-1]
  Start-Sleep -Milliseconds 250
  $heartbeatAfterExit = @(Get-Content -LiteralPath $crashReady.heartbeatPath | Where-Object { $_ })[-1]
  if ($heartbeatAfterExit -ne $heartbeatAtExit) {
    throw 'business heartbeat continued after utility crash'
  }
  $crashClosed = Wait-JsonPhase -Path $crashResultPath -Phase 'utility_crash_closed'
  if ([int]$crashClosed.utilityPid -ne $utilityPid) {
    throw 'utility-crash closed identity mismatch'
  }
  if (-not $crashProcess.WaitForExit(30000)) {
    $crashProcess.Kill()
    throw 'utility-crash fixture app timed out'
  }
  if ($crashProcess.ExitCode -ne 0) {
    $crashStdout = $crashProcess.StandardOutput.ReadToEnd()
    $crashStderr = $crashProcess.StandardError.ReadToEnd()
    throw "utility-crash fixture exit=$($crashProcess.ExitCode) stderr=$crashStderr stdout=$crashStdout"
  }

  $observedProcessIds = @(
    @($result.normal.electronProcesses) +
      @($result.ownerEnd.electronProcesses) +
      @($result.ptyInput.electronProcesses) +
      @($result.ptyOwnerEnd.electronProcesses) |
      ForEach-Object { [int]$_.pid }
    $utilityPid
    $businessPid
  ) | Where-Object { $_ -gt 0 } | Select-Object -Unique
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $remaining = @($observedProcessIds | Where-Object {
      Test-ProcessFromRunRoot -ProcessId $_ -RunRoot $resolvedRunRoot
    })
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($remaining.Count -gt 0) {
    throw "formal command runner processes remain: $($remaining -join ',')"
  }

  $summary = [pscustomobject]@{
    success = $true
    platform = $result.platform
    architecture = $result.architecture
    electron = $result.electron
    normalOutput = $result.normal.output
    normalTerminationCause = $result.normal.terminationCause
    ownerEndTerminationCause = $result.ownerEnd.terminationCause
    ptyInputObserved = $result.ptyInput.output.Contains('pty-input:accepted-value')
    ptyInputTerminationCause = $result.ptyInput.terminationCause
    ptyOwnerEndTerminationCause = $result.ptyOwnerEnd.terminationCause
    utilityCrashProcessesAfterExit = 0
    utilityCrashHeartbeatStopped = $true
    observedProcessesAfterExit = 0
  }
  $completed = $true
} finally {
  if ($process) {
    if (-not $process.HasExited) { $process.Kill() }
    $process.Dispose()
  }
  if ($crashProcess) {
    if (-not $crashProcess.HasExited) { $crashProcess.Kill() }
    $crashProcess.Dispose()
  }
  foreach ($processIdentity in @($utilityIdentity, $businessIdentity)) {
    if ($processIdentity) {
      Stop-ProcessIdentity -Identity $processIdentity -AllowAlreadyExited
    }
  }
  foreach ($processId in $observedProcessIds) {
    if (Test-ProcessFromRunRoot -ProcessId $processId -RunRoot $resolvedRunRoot) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-RunRootWhenUnlocked -RunRoot $resolvedRunRoot
}

if (-not $completed -or (Test-Path -LiteralPath $resolvedRunRoot)) {
  throw 'Windows formal command runner harness did not reach clean completion'
}
$summary | ConvertTo-Json -Compress -Depth 6
