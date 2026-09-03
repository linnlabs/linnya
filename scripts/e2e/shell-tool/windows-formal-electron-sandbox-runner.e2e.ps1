param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedElectronVersion
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class LinnyaSandboxProcessObservation
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasicInformation
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int processInformationClass,
        IntPtr processInformation,
        int processInformationLength,
        out int returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsProcessInJob(
        IntPtr processHandle,
        IntPtr jobHandle,
        [MarshalAs(UnmanagedType.Bool)] out bool result);

    public static int ReadParentProcessId(Process process)
    {
        int size = Marshal.SizeOf(typeof(ProcessBasicInformation));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            int returnLength;
            int status = NtQueryInformationProcess(process.Handle, 0, buffer, size, out returnLength);
            if (status != 0) {
                throw new InvalidOperationException("NtQueryInformationProcess basic failed: " + status);
            }
            ProcessBasicInformation information = (ProcessBasicInformation)Marshal.PtrToStructure(
                buffer,
                typeof(ProcessBasicInformation));
            return information.InheritedFromUniqueProcessId.ToInt32();
        } finally {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public static string ReadCommandLine(Process process)
    {
        int requiredLength;
        NtQueryInformationProcess(process.Handle, 60, IntPtr.Zero, 0, out requiredLength);
        if (requiredLength <= 0 || requiredLength > 1024 * 1024) {
            throw new InvalidOperationException("Process command line size is invalid: " + requiredLength);
        }
        IntPtr buffer = Marshal.AllocHGlobal(requiredLength);
        try {
            int returnedLength;
            int status = NtQueryInformationProcess(
                process.Handle,
                60,
                buffer,
                requiredLength,
                out returnedLength);
            if (status != 0) {
                throw new InvalidOperationException("NtQueryInformationProcess command line failed: " + status);
            }
            ushort byteLength = (ushort)Marshal.ReadInt16(buffer, 0);
            IntPtr text = Marshal.ReadIntPtr(buffer, IntPtr.Size == 8 ? 8 : 4);
            return Marshal.PtrToStringUni(text, byteLength / 2) ?? String.Empty;
        } finally {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public static bool ReadInAnyJob(Process process)
    {
        bool result;
        if (!IsProcessInJob(process.Handle, IntPtr.Zero, out result)) {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        return result;
    }
}
'@

function New-ProcessSnapshot {
  param([int]$ProcessId)

  $candidate = [Diagnostics.Process]::GetProcessById($ProcessId)
  try {
    if ($candidate.HasExited) { throw "process already exited: $ProcessId" }
    $snapshot = [ordered]@{
      ProcessId = $candidate.Id
      ParentProcessId = [LinnyaSandboxProcessObservation]::ReadParentProcessId($candidate)
      StartTimeUtcTicks = $candidate.StartTime.ToUniversalTime().Ticks
      ProcessName = $candidate.ProcessName
      MainWindowHandle = $candidate.MainWindowHandle.ToInt64()
      ExecutablePath = $null
      ExecutablePathError = $null
      CommandLine = $null
      CommandLineError = $null
      InAnyJob = $null
      InAnyJobError = $null
    }
    try {
      $snapshot.ExecutablePath = $candidate.MainModule.FileName
    } catch [System.ComponentModel.Win32Exception] {
      $snapshot.ExecutablePathError = $_.Exception.Message
    }
    try {
      $snapshot.CommandLine = [LinnyaSandboxProcessObservation]::ReadCommandLine($candidate)
    } catch [System.ComponentModel.Win32Exception] {
      $snapshot.CommandLineError = $_.Exception.Message
    } catch [System.InvalidOperationException] {
      $snapshot.CommandLineError = $_.Exception.Message
    }
    try {
      $snapshot.InAnyJob = [LinnyaSandboxProcessObservation]::ReadInAnyJob($candidate)
    } catch [System.ComponentModel.Win32Exception] {
      $snapshot.InAnyJobError = $_.Exception.Message
    }
    return [pscustomobject]$snapshot
  } finally {
    $candidate.Dispose()
  }
}

function Test-SameProcessInstanceAlive {
  param([pscustomobject]$Instance)

  try {
    $candidate = [Diagnostics.Process]::GetProcessById([int]$Instance.ProcessId)
    try {
      return -not $candidate.HasExited `
        -and $candidate.StartTime.ToUniversalTime().Ticks -eq [int64]$Instance.StartTimeUtcTicks
    } finally {
      $candidate.Dispose()
    }
  } catch [ArgumentException] {
    return $false
  } catch [InvalidOperationException] {
    return $false
  }
}

function Get-ReadableProcessSnapshots {
  $snapshots = @()
  foreach ($candidate in [Diagnostics.Process]::GetProcesses()) {
    try {
      $snapshots += New-ProcessSnapshot -ProcessId $candidate.Id
    } catch [System.ComponentModel.Win32Exception] {
      # 普通用户不可读取的系统进程与本轮同用户 Electron 树无关。
    } catch [System.InvalidOperationException] {
      # 枚举和读取之间自然退出的进程不构成本轮身份。
    } catch [System.ArgumentException] {
    } finally {
      $candidate.Dispose()
    }
  }
  return @($snapshots)
}

function Test-AncestorChainContains {
  param(
    [pscustomobject]$Instance,
    [int]$ExpectedAncestorProcessId,
    [hashtable]$ByProcessId
  )

  $visited = @{}
  $parentId = [int]$Instance.ParentProcessId
  while ($parentId -gt 0 -and -not $visited.ContainsKey($parentId)) {
    if ($parentId -eq $ExpectedAncestorProcessId) { return $true }
    $visited[$parentId] = $true
    $parent = $ByProcessId[$parentId]
    if ($null -eq $parent) { return $false }
    $parentId = [int]$parent.ParentProcessId
  }
  return $false
}

function Format-ProcessObservation {
  param([pscustomobject]$Snapshot)

  $commandLine = if ($null -ne $Snapshot.CommandLine) {
    [string]$Snapshot.CommandLine
  } else {
    "<unreadable:$($Snapshot.CommandLineError)>"
  }
  $executablePath = if ($null -ne $Snapshot.ExecutablePath) {
    [string]$Snapshot.ExecutablePath
  } else {
    "<unreadable:$($Snapshot.ExecutablePathError)>"
  }
  $inAnyJob = if ($null -ne $Snapshot.InAnyJob) {
    [string]$Snapshot.InAnyJob
  } else {
    "<unreadable:$($Snapshot.InAnyJobError)>"
  }
  return "pid=$($Snapshot.ProcessId),ppid=$($Snapshot.ParentProcessId),name=$($Snapshot.ProcessName),path=$executablePath,inJob=$inAnyJob,argv=$commandLine"
}

function Wait-JsonPhase {
  param(
    [string]$Path,
    [string]$Phase,
    [Diagnostics.Process]$Owner,
    [int]$TimeoutSeconds
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $value = $null
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      try {
        $value = [IO.File]::ReadAllText($Path, (New-Object Text.UTF8Encoding($false))) |
          ConvertFrom-Json
      } catch [System.IO.IOException] {
      } catch [System.ArgumentException] {
      } catch [System.Management.Automation.RuntimeException] {
      }
      if ($value -and $value.success -eq $false) {
        throw "packaged fixture failed: $($value.error)"
      }
      if ($value -and $value.phase -eq $Phase) { return $value }
    }
    if ($Owner.HasExited) {
      throw "packaged Electron exited before publishing phase $Phase"
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "timed out waiting for phase $Phase at $Path"
}

function Wait-ProcessExit {
  param(
    [Diagnostics.Process]$Process,
    [Threading.Tasks.Task[string]]$StdoutTask,
    [Threading.Tasks.Task[string]]$StderrTask,
    [int]$TimeoutMilliseconds
  )

  if (-not $Process.WaitForExit($TimeoutMilliseconds)) {
    throw "packaged Electron did not exit within $TimeoutMilliseconds ms"
  }
  return [pscustomobject]@{
    ExitCode = $Process.ExitCode
    Stdout = $StdoutTask.Result
    Stderr = $StderrTask.Result
  }
}

function New-ValidationProcess {
  param(
    [string]$ExecutablePath,
    [string]$ApplicationRoot,
    [string]$ResultPath,
    [string]$StorageRoot,
    [string]$Mode,
    [string]$UserDataRoot
  )

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ExecutablePath
  $startInfo.WorkingDirectory = $ApplicationRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.Arguments = '--no-error-dialogs --enable-logging=stderr --user-data-dir="' + $UserDataRoot + '"'
  $startInfo.EnvironmentVariables['LINNYA_FORMAL_SANDBOX_RESULT_PATH'] = $ResultPath
  $startInfo.EnvironmentVariables['LINNYA_FORMAL_SANDBOX_STORAGE_ROOT'] = $StorageRoot
  $startInfo.EnvironmentVariables['LINNYA_FORMAL_SANDBOX_MODE'] = $Mode
  $process = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) { throw 'failed to start packaged Electron fixture' }
  return [pscustomobject]@{
    Process = $process
    StdoutTask = $process.StandardOutput.ReadToEndAsync()
    StderrTask = $process.StandardError.ReadToEndAsync()
  }
}

function Wait-EvaluatorTree {
  param(
    [int]$MainProcessId,
    [int]$TimeoutSeconds
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastSnapshots = @()
  $lastByProcessId = @{}
  do {
    $snapshots = @(Get-ReadableProcessSnapshots)
    $byProcessId = @{}
    foreach ($snapshot in $snapshots) { $byProcessId[[int]$snapshot.ProcessId] = $snapshot }
    $lastSnapshots = $snapshots
    $lastByProcessId = $byProcessId
    $evaluators = @($snapshots | Where-Object {
      $null -ne $_.CommandLine `
        -and $_.CommandLine.Contains('sandboxEvaluatorProcess.cjs') `
        -and (Test-AncestorChainContains `
          -Instance $_ `
          -ExpectedAncestorProcessId $MainProcessId `
          -ByProcessId $byProcessId)
    })
    if ($evaluators.Count -eq 1) {
      $evaluator = $evaluators[0]
      $utility = $byProcessId[[int]$evaluator.ParentProcessId]
      if ($utility -and (Test-AncestorChainContains `
        -Instance $utility `
        -ExpectedAncestorProcessId $MainProcessId `
        -ByProcessId $byProcessId)) {
        $tree = @($evaluator)
        $frontier = @([int]$evaluator.ProcessId)
        while ($frontier.Count -gt 0) {
          $next = @($snapshots | Where-Object { $frontier -contains [int]$_.ParentProcessId })
          $tree += $next
          $frontier = @($next | ForEach-Object { [int]$_.ProcessId })
        }
        return [pscustomobject]@{
          Utility = $utility
          Evaluator = $evaluator
          EvaluatorTree = @($tree)
        }
      }
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)

  $descendants = @($lastSnapshots | Where-Object {
    Test-AncestorChainContains `
      -Instance $_ `
      -ExpectedAncestorProcessId $MainProcessId `
      -ByProcessId $lastByProcessId
  })
  $descendantObservations = if ($descendants.Count -eq 0) {
    '<none>'
  } else {
    ($descendants | ForEach-Object { Format-ProcessObservation -Snapshot $_ }) -join ' || '
  }
  throw "timed out observing the production Evaluator below Electron $MainProcessId; descendants=[$descendantObservations]"
}

function Wait-FrozenProcessesExited {
  param([pscustomobject[]]$Instances)

  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $alive = @($Instances | Where-Object { Test-SameProcessInstanceAlive -Instance $_ })
    if ($alive.Count -eq 0) { return }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "frozen Sandbox processes remained alive: $($alive.ProcessId -join ',')"
}

function Stop-FrozenProcess {
  param([pscustomobject]$Instance)
  if (-not (Test-SameProcessInstanceAlive -Instance $Instance)) { return }
  $candidate = [Diagnostics.Process]::GetProcessById([int]$Instance.ProcessId)
  try { $candidate.Kill() } finally { $candidate.Dispose() }
}

function Remove-RunRootWhenUnlocked {
  param([string]$RunRoot)
  if (-not (Test-Path -LiteralPath $RunRoot)) { return }
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  $lastError = $null
  do {
    try {
      Remove-Item -LiteralPath $RunRoot -Recurse -Force -ErrorAction Stop
      return
    } catch [System.IO.IOException] {
      $lastError = $_.Exception
    } catch [System.UnauthorizedAccessException] {
      $lastError = $_.Exception
    }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "run root remained locked: $RunRoot; $($lastError.Message)"
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$isUser = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::User)
if ($isAdministrator -or -not $isUser) {
  throw 'Windows formal Sandbox validation must run as a standard Users-group account'
}

$remoteTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$resolvedArchive = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $resolvedArchive -PathType Leaf)) {
  throw "archive does not exist: $resolvedArchive"
}
$runRoot = Join-Path $remoteTemp ('Linnya Sandbox ' + [Guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $remoteTemp ('linnya-formal-sandbox-package-' + [Guid]::NewGuid().ToString('N'))
$applications = @()
$frozen = @()
$completed = $false
try {
  New-Item -ItemType Directory -Path $runRoot | Out-Null
  New-Item -ItemType Directory -Path $packageRoot | Out-Null
  & tar.exe -xzf $resolvedArchive -C $packageRoot
  if ($LASTEXITCODE -ne 0) { throw "tar extraction failed: $LASTEXITCODE" }

  $applicationRoot = Join-Path $packageRoot 'win-unpacked'
  $executablePath = Join-Path $applicationRoot 'Linnya Formal Sandbox Runner Windows Validation.exe'
  if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw "packaged executable is missing: $executablePath"
  }
  $sandboxNodePath = Join-Path $applicationRoot 'resources\headless-node-runtime\win32\x64\node.exe'
  if (-not (Test-Path -LiteralPath $sandboxNodePath -PathType Leaf)) {
    throw "packaged Headless Node runtime is missing: $sandboxNodePath"
  }
  $sandboxNodeVersion = (& $sandboxNodePath --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $sandboxNodeVersion -ne 'v24.18.1') {
    throw "packaged Sandbox Node version mismatch: $sandboxNodeVersion"
  }
  $sandboxNodeSignature = Get-AuthenticodeSignature -LiteralPath $sandboxNodePath
  if ($sandboxNodeSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "packaged Sandbox Node Authenticode is invalid: $($sandboxNodeSignature.Status)"
  }

  $suiteResultPath = Join-Path $runRoot 'suite-result.json'
  $suiteStorageRoot = Join-Path $runRoot 'suite-storage'
  $suiteApp = New-ValidationProcess `
    -ExecutablePath $executablePath `
    -ApplicationRoot $applicationRoot `
    -ResultPath $suiteResultPath `
    -StorageRoot $suiteStorageRoot `
    -Mode 'suite' `
    -UserDataRoot (Join-Path $runRoot 'suite-user-data')
  $applications += $suiteApp
  $suite = Wait-JsonPhase `
    -Path $suiteResultPath `
    -Phase 'suite_closed' `
    -Owner $suiteApp.Process `
    -TimeoutSeconds 120
  $suiteExit = Wait-ProcessExit `
    -Process $suiteApp.Process `
    -StdoutTask $suiteApp.StdoutTask `
    -StderrTask $suiteApp.StderrTask `
    -TimeoutMilliseconds 30000
  if ($suiteExit.ExitCode -ne 0) {
    throw "suite failed: code=$($suiteExit.ExitCode); stderr=$($suiteExit.Stderr); stdout=$($suiteExit.Stdout)"
  }
  if (
    $suite.packaged -ne $true `
      -or $suite.platform -ne 'win32' `
      -or $suite.architecture -ne 'x64' `
      -or $suite.electron -ne $ExpectedElectronVersion `
      -or $suite.normal.success -ne $true `
      -or $suite.pptCompose.success -ne $true `
      -or $suite.heapPositive.success -ne $true `
      -or $suite.heapNegative.success -ne $false `
      -or $suite.vmHardTimeout.error.type -ne 'timeout' `
      -or $suite.idleOnly.diagnostics.idleTimeoutTriggered -ne $true `
      -or $suite.cancelled.success -ne $false
  ) {
    throw 'Windows formal Sandbox suite result mismatch'
  }
  if ((Get-ChildItem -LiteralPath $suiteStorageRoot -Force).Count -ne 0) {
    throw 'suite storage root was not empty after settlement'
  }

  $crashResultPath = Join-Path $runRoot 'crash-result.json'
  $crashStorageRoot = Join-Path $runRoot 'crash-storage'
  $crashApp = New-ValidationProcess `
    -ExecutablePath $executablePath `
    -ApplicationRoot $applicationRoot `
    -ResultPath $crashResultPath `
    -StorageRoot $crashStorageRoot `
    -Mode 'utility-crash' `
    -UserDataRoot (Join-Path $runRoot 'crash-user-data')
  $applications += $crashApp
  $ready = Wait-JsonPhase `
    -Path $crashResultPath `
    -Phase 'utility_crash_ready' `
    -Owner $crashApp.Process `
    -TimeoutSeconds 45
  $tree = Wait-EvaluatorTree `
    -MainProcessId $crashApp.Process.Id `
    -TimeoutSeconds 15
  $frozen = @($tree.Utility) + @($tree.EvaluatorTree)
  if ($tree.Evaluator.ParentProcessId -ne $tree.Utility.ProcessId) {
    throw 'production Evaluator is not a direct child of the reported Utility'
  }
  if (-not $tree.Evaluator.CommandLine.Contains('sandboxEvaluatorProcess.cjs')) {
    throw 'production Evaluator command line is missing its dedicated bundle'
  }
  if (
    $null -eq $tree.Evaluator.ExecutablePath `
      -or -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetFullPath([string]$tree.Evaluator.ExecutablePath),
        [IO.Path]::GetFullPath($sandboxNodePath))
  ) {
    throw 'production Evaluator did not use the packaged Headless Node runtime'
  }
  if ([int64]$tree.Evaluator.MainWindowHandle -ne 0) {
    throw 'production Evaluator created a visible top-level window'
  }
  if (
    $tree.Evaluator.CommandLine.Contains([string]$ready.sourceSentinel) `
      -or $tree.Evaluator.CommandLine.Contains([string]$ready.storageRoot)
  ) {
    throw 'production Evaluator argv leaked source or storage identity'
  }
  $notInJob = @($tree.EvaluatorTree | Where-Object { -not $_.InAnyJob })
  if ($notInJob.Count -ne 0) {
    throw "Evaluator tree contains processes outside a Job: $($notInJob.ProcessId -join ',')"
  }

  $runDirectories = @(Get-ChildItem -LiteralPath $crashStorageRoot -Directory -Force)
  if ($runDirectories.Count -ne 1) {
    throw "expected one active Sandbox run directory, found $($runDirectories.Count)"
  }
  $activeRunDirectory = $runDirectories[0].FullName
  $requestPath = Join-Path $activeRunDirectory 'request.json'
  $requestText = [IO.File]::ReadAllText($requestPath, (New-Object Text.UTF8Encoding($false)))
  $sourceInMailbox = $requestText.Contains([string]$ready.sourceSentinel)
  if (-not $sourceInMailbox) { throw 'request mailbox did not contain the source sentinel' }
  $acl = Get-Acl -LiteralPath $activeRunDirectory
  $everyoneWrite = @($acl.Access | Where-Object {
    $sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    $sid -eq 'S-1-1-0' `
      -and $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow `
      -and ($_.FileSystemRights.ToString() -match 'Write|Modify|FullControl')
  }).Count -gt 0
  if ($everyoneWrite) { throw 'active Sandbox run directory grants write access to Everyone' }

  Stop-FrozenProcess -Instance $tree.Utility
  Wait-FrozenProcessesExited -Instances @($tree.EvaluatorTree)
  $closed = Wait-JsonPhase `
    -Path $crashResultPath `
    -Phase 'utility_crash_closed' `
    -Owner $crashApp.Process `
    -TimeoutSeconds 60
  $crashExit = Wait-ProcessExit `
    -Process $crashApp.Process `
    -StdoutTask $crashApp.StdoutTask `
    -StderrTask $crashApp.StderrTask `
    -TimeoutMilliseconds 30000
  if ($crashExit.ExitCode -ne 0) {
    throw "crash recovery failed: code=$($crashExit.ExitCode); stderr=$($crashExit.Stderr); stdout=$($crashExit.Stdout)"
  }
  if (
    $closed.crashed.success -ne $false `
      -or $closed.crashed.error.type -ne 'transport' `
      -or $closed.recovered.success -ne $true `
      -or $closed.recovered.value.recovered -ne $true
  ) {
    throw 'Utility crash or next-generation recovery result mismatch'
  }
  Wait-FrozenProcessesExited -Instances @($frozen)
  if ((Get-ChildItem -LiteralPath $crashStorageRoot -Force).Count -ne 0) {
    throw 'crash storage root was not empty after next-generation recovery'
  }

  $summary = [ordered]@{
    success = $true
    version = 1
    platform = [string]$closed.platform
    architecture = [string]$closed.architecture
    electron = [string]$closed.electron
    packaged = [bool]$closed.packaged
    standardUser = $true
    runAsNodeDisabled = $true
    sandboxNodeVersion = $sandboxNodeVersion
    sandboxNodeAuthenticodeVerified = $true
    scenarioCount = 7
    utilityParentChainVerified = $true
    evaluatorParentVerified = $true
    evaluatorWindowHidden = $true
    evaluatorTreeProcessCount = $tree.EvaluatorTree.Count
    allEvaluatorTreeProcessesInJob = $true
    allFrozenProcessesExited = $true
    mailboxAclVerified = $true
    mailboxOwner = [string]$acl.Owner
    everyoneWrite = $everyoneWrite
    sourceInMailbox = $sourceInMailbox
    sourceInArgv = $false
    nextGenerationRecovered = $true
    storageUnlockedAndDeleted = $true
  }
  $completed = $true
} catch {
  [Console]::Error.WriteLine(
    "LINNYA_WINDOWS_FORMAL_SANDBOX_ERROR={0}; POSITION={1}; STACK={2}",
    $_.Exception.Message,
    $_.InvocationInfo.PositionMessage,
    $_.ScriptStackTrace)
  throw
} finally {
  $cleanupFailures = @()
  if (-not $completed) {
    foreach ($instance in $frozen) {
      try { Stop-FrozenProcess -Instance $instance } catch {
        $cleanupFailures += "process=$($instance.ProcessId):$($_.Exception.Message)"
      }
    }
    foreach ($application in $applications) {
      try {
        if (-not $application.Process.HasExited) {
          $application.Process.Kill()
          $application.Process.WaitForExit(5000) | Out-Null
        }
      } catch {
        $cleanupFailures += "electron=$($application.Process.Id):$($_.Exception.Message)"
      }
    }
  }
  foreach ($application in $applications) {
    try { $application.Process.Dispose() } catch {
      $cleanupFailures += "electron-dispose:$($_.Exception.Message)"
    }
  }
  foreach ($cleanupRoot in @($runRoot, $packageRoot)) {
    try { Remove-RunRootWhenUnlocked -RunRoot $cleanupRoot } catch {
      $cleanupFailures += "root=${cleanupRoot}:$($_.Exception.Message)"
    }
  }
  if ($completed -and $cleanupFailures.Count -gt 0) {
    throw "successful Windows Sandbox cleanup failed: $($cleanupFailures -join '; ')"
  }
}

$summary | ConvertTo-Json -Compress -Depth 8
