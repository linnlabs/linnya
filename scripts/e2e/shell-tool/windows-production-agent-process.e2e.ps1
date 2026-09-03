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
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class LinnyaProcessObservation
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
        out ProcessBasicInformation processInformation,
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
        ProcessBasicInformation information;
        int returnLength;
        int status = NtQueryInformationProcess(
            process.Handle,
            0,
            out information,
            Marshal.SizeOf(typeof(ProcessBasicInformation)),
            out returnLength);
        if (status != 0)
        {
            throw new InvalidOperationException("NtQueryInformationProcess failed: " + status);
        }
        return information.InheritedFromUniqueProcessId.ToInt32();
    }

    public static bool ReadInAnyJob(Process process)
    {
        bool result;
        if (!IsProcessInJob(process.Handle, IntPtr.Zero, out result))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        return result;
    }
}
'@

function ConvertTo-ExtendedFileSystemPath {
  param([string]$Path)

  $fullPath = [IO.Path]::GetFullPath($Path)
  if ($fullPath.StartsWith('\\?\')) { return $fullPath }
  if ($fullPath.StartsWith('\\')) {
    return '\\?\UNC\' + $fullPath.TrimStart('\')
  }
  return '\\?\' + $fullPath
}

function Wait-JsonFile {
  param(
    [string]$Path,
    [int]$TimeoutSeconds,
    [Diagnostics.Process]$OwnerProcess
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastReadError = $null
  $fullPath = [IO.Path]::GetFullPath($Path)
  $extendedPath = ConvertTo-ExtendedFileSystemPath -Path $fullPath
  do {
    if ([IO.File]::Exists($extendedPath)) {
      try {
        if ($fullPath.Length -lt 248) {
          $jsonText = Get-Content -Raw -Encoding UTF8 -LiteralPath $fullPath
        } else {
          # PowerShell 5.1 的文件 cmdlet 不能可靠遍历长路径，长路径改用 .NET byte API。
          $jsonBytes = [byte[]][IO.File]::ReadAllBytes($extendedPath)
          $jsonText = [Text.Encoding]::UTF8.GetString([byte[]]$jsonBytes)
        }
        if ([string]::IsNullOrWhiteSpace($jsonText)) {
          Start-Sleep -Milliseconds 25
          continue
        }
        $parsedJson = ConvertFrom-Json -InputObject $jsonText
        return $parsedJson
      } catch [System.ArgumentException] {
        $lastReadError = $_.Exception
      } catch [System.IO.IOException] {
        $lastReadError = $_.Exception
      } catch [System.Management.Automation.RuntimeException] {
        # 文件发布和读取之间可能出现短暂的空内容或不完整 JSON；只在截止时间前重试。
        $lastReadError = $_.Exception
      }
    }
    if ($OwnerProcess -and $OwnerProcess.HasExited) {
      throw "owner process exited before publishing JSON: $Path"
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  $exists = [IO.File]::Exists($extendedPath)
  $length = if ($exists) { (New-Object IO.FileInfo($extendedPath)).Length } else { -1 }
  $lastMessage = if ($lastReadError) { $lastReadError.Message } else { 'none' }
  $ownerState = 'none'
  if ($OwnerProcess -and -not $OwnerProcess.HasExited) {
    $OwnerProcess.Refresh()
    $children = @()
    foreach ($candidate in [Diagnostics.Process]::GetProcesses()) {
      try {
        if ([LinnyaProcessObservation]::ReadParentProcessId($candidate) -eq $OwnerProcess.Id) {
          $children += "$($candidate.Id):$($candidate.ProcessName)"
        }
      } catch {
        # 普通用户无法读取部分系统进程；这里只扩充失败诊断，不参与被测 owner 判定。
      } finally {
        $candidate.Dispose()
      }
    }
    $ownerState = "pid=$($OwnerProcess.Id),cpuMs=$([int64]$OwnerProcess.TotalProcessorTime.TotalMilliseconds),workingSet=$($OwnerProcess.WorkingSet64),threads=$($OwnerProcess.Threads.Count),responding=$($OwnerProcess.Responding),windowHandle=$($OwnerProcess.MainWindowHandle),windowTitle=$($OwnerProcess.MainWindowTitle),children=$($children -join ',')"
  }
  throw "timed out waiting for JSON: $Path; exists=$exists; length=$length; lastReadError=$lastMessage; owner=$ownerState"
}

function Find-ProcessEvidenceRootAfterExit {
  param([string]$ScenarioRoot)

  $parentFiles = @([IO.Directory]::GetFiles($ScenarioRoot, 'parent.json', [IO.SearchOption]::AllDirectories))
  if ($parentFiles.Count -ne 1) {
    throw "expected one process evidence root after Electron exit, found $($parentFiles.Count)"
  }
  return [IO.Path]::GetDirectoryName($parentFiles[0])
}

function Wait-File {
  param(
    [string]$Path,
    [int]$TimeoutSeconds,
    [Diagnostics.Process]$OwnerProcess
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return }
    if ($OwnerProcess -and $OwnerProcess.HasExited) {
      throw "owner process exited before publishing file: $Path"
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "timed out waiting for file: $Path"
}

function Wait-FrozenAgentProcessTree {
  param(
    [int]$TimeoutSeconds,
    [Diagnostics.Process]$OwnerProcess
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ($OwnerProcess.HasExited) {
      throw 'owner process exited before the three-level PowerShell tree was observable'
    }

    $parentByProcessId = @{}
    $powershellProcessIds = @()
    foreach ($candidate in [Diagnostics.Process]::GetProcesses()) {
      try {
        $parentByProcessId[$candidate.Id] = [LinnyaProcessObservation]::ReadParentProcessId($candidate)
        if ($candidate.ProcessName -ieq 'powershell') {
          $powershellProcessIds += $candidate.Id
        }
      } catch {
        # 普通用户无法读取部分系统进程；它们不可能成为本次 Electron 的可控后代。
      } finally {
        $candidate.Dispose()
      }
    }

    $descendantPowerShellIds = @()
    foreach ($processId in $powershellProcessIds) {
      $cursor = $processId
      $visited = @{}
      while ($parentByProcessId.ContainsKey($cursor) -and -not $visited.ContainsKey($cursor)) {
        $visited[$cursor] = $true
        $cursor = [int]$parentByProcessId[$cursor]
        if ($cursor -eq $OwnerProcess.Id) {
          $descendantPowerShellIds += $processId
          break
        }
      }
    }

    $chains = @()
    foreach ($grandchildId in $descendantPowerShellIds) {
      $childId = [int]$parentByProcessId[$grandchildId]
      if ($descendantPowerShellIds -notcontains $childId) { continue }
      $parentId = [int]$parentByProcessId[$childId]
      if ($descendantPowerShellIds -notcontains $parentId) { continue }
      $chains += [pscustomobject]@{
        ParentId = $parentId
        ChildId = $childId
        GrandchildId = $grandchildId
      }
    }
    if ($chains.Count -gt 1) {
      throw "multiple three-level PowerShell trees were observed under Electron: $($chains -join ';')"
    }
    if ($chains.Count -eq 1) {
      $chain = $chains[0]
      return @(
        Get-FrozenProcessInstance -ProcessId $chain.ParentId -Role 'parent'
        Get-FrozenProcessInstance -ProcessId $chain.ChildId -Role 'child'
        Get-FrozenProcessInstance -ProcessId $chain.GrandchildId -Role 'grandchild'
      )
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'timed out waiting for the three-level PowerShell tree under Electron'
}

function Get-FrozenProcessInstance {
  param(
    [int]$ProcessId,
    [string]$Role,
    [string]$HeartbeatPath = '',
    [string]$RunToken = ''
  )

  $candidate = [Diagnostics.Process]::GetProcessById($ProcessId)
  try {
    return [pscustomobject]@{
      ProcessId = $ProcessId
      ParentProcessId = [LinnyaProcessObservation]::ReadParentProcessId($candidate)
      StartTimeUtcTicks = $candidate.StartTime.ToUniversalTime().Ticks
      ExecutablePath = $candidate.MainModule.FileName
      InAnyJob = [LinnyaProcessObservation]::ReadInAnyJob($candidate)
      Role = $Role
      HeartbeatPath = $HeartbeatPath
      RunToken = $RunToken
    }
  } finally {
    $candidate.Dispose()
  }
}

function Test-FrozenProcessInstance {
  param([object]$Instance)

  if (-not $Instance) { return $false }
  try {
    $candidate = [Diagnostics.Process]::GetProcessById([int]$Instance.ProcessId)
    try {
      return $candidate.StartTime.ToUniversalTime().Ticks -eq [int64]$Instance.StartTimeUtcTicks
    } finally {
      $candidate.Dispose()
    }
  } catch [ArgumentException] {
    return $false
  } catch [InvalidOperationException] {
    return $false
  }
}

function Wait-HeartbeatProgress {
  param(
    [object]$Instance,
    [int]$TimeoutSeconds = 10
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $extendedHeartbeatPath = ConvertTo-ExtendedFileSystemPath -Path $Instance.HeartbeatPath
  $lastReadError = $null
  do {
    if ([IO.File]::Exists($extendedHeartbeatPath)) {
      try {
        $lines = @([IO.File]::ReadAllLines($extendedHeartbeatPath) | Where-Object { $_ })
        if ($lines.Count -ge 2) {
          $previous = $lines[$lines.Count - 2].Split("`t")
          $latest = $lines[$lines.Count - 1].Split("`t")
          if (
            $latest.Count -ne 5 -or
            $latest[0] -ne $Instance.RunToken -or
            $latest[1] -ne $Instance.Role -or
            [int]$latest[2] -ne $Instance.ProcessId -or
            [int64]$latest[3] -le [int64]$previous[3]
          ) {
            throw "heartbeat identity mismatch for $($Instance.Role)"
          }
          return
        }
      } catch [System.IO.IOException] {
        # 心跳写入与读取可能短暂交错；保留最后错误，只有超时才判定失败。
        $lastReadError = $_.Exception
      }
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  $lastMessage = if ($lastReadError) { $lastReadError.Message } else { 'none' }
  throw "timed out waiting for heartbeat: $($Instance.Role); lastReadError=$lastMessage"
}

function Wait-FrozenProcessesExited {
  param(
    [object[]]$Instances,
    [int]$TimeoutSeconds = 15
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $remaining = @($Instances | Where-Object { Test-FrozenProcessInstance -Instance $_ })
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "process instances remained alive: $(@($remaining.ProcessId) -join ',')"
}

function Assert-HeartbeatsStopped {
  param([object[]]$Instances)

  foreach ($instance in $Instances) {
    $extendedHeartbeatPath = ConvertTo-ExtendedFileSystemPath -Path $instance.HeartbeatPath
    $beforeBytes = [IO.File]::ReadAllBytes($extendedHeartbeatPath)
    $before = [Text.Encoding]::UTF8.GetString($beforeBytes)
    Start-Sleep -Milliseconds 300
    $afterBytes = [IO.File]::ReadAllBytes($extendedHeartbeatPath)
    $after = [Text.Encoding]::UTF8.GetString($afterBytes)
    if ($after -ne $before) {
      throw "heartbeat continued after cancellation: $($instance.Role)"
    }
  }
}

function Stop-FrozenProcessInstance {
  param([object]$Instance)

  if (-not (Test-FrozenProcessInstance -Instance $Instance)) { return }
  $candidate = [Diagnostics.Process]::GetProcessById([int]$Instance.ProcessId)
  try {
    $candidate.Kill()
    $candidate.WaitForExit(5000) | Out-Null
  } finally {
    $candidate.Dispose()
  }
}

function Remove-RunRootWhenUnlocked {
  param([string]$RunRoot)

  if (-not (Test-Path -LiteralPath $RunRoot)) { return }
  # Electron 可以创建超过 260 字符的 artifact 路径；PowerShell 5.1 的 Remove-Item 不能可靠遍历它。
  $TempRoot = [IO.Directory]::GetParent($RunRoot).FullName
  $emptyRoot = $TempRoot + '\linnya-empty-' + [Guid]::NewGuid().ToString('N')
  [IO.Directory]::CreateDirectory($emptyRoot) | Out-Null
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  $lastError = $null
  try {
    do {
      & robocopy.exe $emptyRoot $RunRoot /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
      $robocopyExitCode = $LASTEXITCODE
      if ($robocopyExitCode -lt 8) {
        try {
          [IO.Directory]::Delete($RunRoot, $false)
          return
        } catch [System.IO.IOException] {
          $lastError = $_.Exception
        } catch [System.UnauthorizedAccessException] {
          $lastError = $_.Exception
        }
      } else {
        $lastError = New-Object System.IO.IOException("robocopy failed with exit code $robocopyExitCode")
      }
      Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "run root remained locked: $RunRoot; $($lastError.Message)"
  } finally {
    [IO.Directory]::Delete($emptyRoot, $false)
  }
}

$remoteTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$resolvedArchive = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $resolvedArchive -PathType Leaf)) {
  throw "archive does not exist: $resolvedArchive"
}
$unicodePrefix = ([string][char]0x6797) + ([string][char]0x82BD) + ' command '
$runRoot = Join-Path $remoteTemp ($unicodePrefix + [Guid]::NewGuid().ToString('N'))
$resolvedRunRoot = [IO.Path]::GetFullPath($runRoot)
if (-not $resolvedRunRoot.StartsWith($remoteTemp + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "run root escaped Windows temp: $resolvedRunRoot"
}
$packageRoot = Join-Path $remoteTemp ('linnya-agent-package-' + [Guid]::NewGuid().ToString('N'))
$resolvedPackageRoot = [IO.Path]::GetFullPath($packageRoot)
if (-not $resolvedPackageRoot.StartsWith($remoteTemp + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "package root escaped Windows temp: $resolvedPackageRoot"
}

$appProcess = $null
$instances = @()
$completed = $false
try {
  New-Item -ItemType Directory -Path $resolvedRunRoot | Out-Null
  New-Item -ItemType Directory -Path $resolvedPackageRoot | Out-Null
  & tar.exe -xzf $resolvedArchive -C $resolvedPackageRoot
  if ($LASTEXITCODE -ne 0) { throw "tar extraction failed: $LASTEXITCODE" }

  $applicationRoot = Join-Path $resolvedPackageRoot 'win-unpacked'
  $executablePath = Join-Path $applicationRoot 'Linnya Windows Production Agent Process Validation.exe'
  $fixturePath = Join-Path $applicationRoot 'resources\command-fixtures\production-agent-process-tree.ps1'
  if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw "packaged executable is missing: $executablePath"
  }
  if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
    throw "process tree fixture is missing: $fixturePath"
  }

  $scenarioRoot = $resolvedRunRoot
  $runToken = [Guid]::NewGuid().ToString('N')
  $resultPath = Join-Path $scenarioRoot 'result.json'
  $observationReadyPath = Join-Path $scenarioRoot 'external-observation-ready'
  $workDirectoryHandshakePath = Join-Path $scenarioRoot 'work-directory.json'
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $executablePath
  $startInfo.WorkingDirectory = $applicationRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  # 启动参数隔离 Chromium profile；Electron userData 由 fixture 在 ready 前设置，
  # 并在 ready 后从 App 内部回传验真，不能把 CLI 参数当成 userData 事实。
  $startInfo.Arguments = '--no-error-dialogs --enable-logging=stderr --user-data-dir="' + (Join-Path $scenarioRoot 'electron-user-data') + '"'
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_RESULT_PATH'] = $resultPath
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_RUN_ROOT'] = $scenarioRoot
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_COMMAND'] = '& $env:LINNYA_AGENT_PROCESS_TREE_FIXTURE -EvidenceDirectoryName ev -RunToken $env:LINNYA_AGENT_PROCESS_TREE_TOKEN -Role parent'
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_EXPECTED_START'] = 'production-agent-parent-start'
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_EXPECTED_TICK'] = 'production-agent-parent-tick-'
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_EXPECTED_INTERACTION_PROMPT'] = 'interaction-request: enter value >'
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_EXPECTED_INTERACTION_STDIN'] = 'interaction-stdin:eof'
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_OBSERVATION_READY_PATH'] = $observationReadyPath
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_WORK_DIRECTORY_HANDSHAKE_PATH'] = $workDirectoryHandshakePath
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_REPLAY_TERMINAL_HANDLE'] = '1'
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_TREE_FIXTURE'] = $fixturePath
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_TREE_TOKEN'] = $runToken
  $actualShellCommandText = $startInfo.EnvironmentVariables['LINNYA_AGENT_PROCESS_COMMAND']
  if ([string]::IsNullOrWhiteSpace($actualShellCommandText)) {
    throw 'shell command environment was not preserved by ProcessStartInfo'
  }

  $appProcess = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $appProcess) { throw 'failed to start packaged Electron fixture' }
  $stdoutTask = $appProcess.StandardOutput.ReadToEndAsync()
  $stderrTask = $appProcess.StandardError.ReadToEndAsync()

  try {
    $instances = @(Wait-FrozenAgentProcessTree -TimeoutSeconds 60 -OwnerProcess $appProcess)
  } catch {
    if (-not $appProcess.HasExited) {
      $appProcess.Kill()
      $appProcess.WaitForExit(5000) | Out-Null
    }
    $earlyStdout = $stdoutTask.Result
    $earlyStderr = $stderrTask.Result
    throw "packaged Electron did not expose its PowerShell process tree: code=$($appProcess.ExitCode); cause=$($_.Exception.Message); stderr=$earlyStderr; stdout=$earlyStdout"
  }
  foreach ($instance in $instances) {
    if (-not $instance.InAnyJob) { throw "$($instance.Role) is not owned by a Windows Job" }
    if ([IO.Path]::GetFileName($instance.ExecutablePath) -ine 'powershell.exe') {
      throw "$($instance.Role) executable is not PowerShell: $($instance.ExecutablePath)"
    }
  }

  $parent = $instances | Where-Object { $_.Role -eq 'parent' }
  $child = $instances | Where-Object { $_.Role -eq 'child' }
  $grandchild = $instances | Where-Object { $_.Role -eq 'grandchild' }
  if ($child.ParentProcessId -ne $parent.ProcessId) { throw 'child is not a direct descendant of parent' }
  if ($grandchild.ParentProcessId -ne $child.ProcessId) { throw 'grandchild is not a direct descendant of child' }

  [IO.File]::WriteAllText($observationReadyPath, "ready`n", (New-Object Text.UTF8Encoding($false)))
  # 长 Unicode 路径中的文件在 PowerShell 5.1 控制端可能直到 Electron 退出后才可见，
  # 因此退出状态是这里的同步信号，result.json 只负责承载最终业务结果。
  if (-not $appProcess.WaitForExit(90000)) { throw 'packaged Electron did not exit after scenario completion' }
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  $result = Wait-JsonFile -Path $resultPath -TimeoutSeconds 30
  if ($result.success -eq $false) { throw "packaged fixture failed: $($result.error)" }
  if ($appProcess.ExitCode -ne 0) {
    throw "packaged Electron failed: code=$($appProcess.ExitCode); stderr=$stderr; stdout=$stdout"
  }

  $evidenceRoot = Find-ProcessEvidenceRootAfterExit -ScenarioRoot $scenarioRoot
  $workDirectory = [IO.Path]::GetFullPath([IO.Directory]::GetParent($evidenceRoot).FullName)
  $scenarioBoundary = [IO.Path]::GetFullPath($scenarioRoot).TrimEnd('\')
  if (-not $workDirectory.StartsWith($scenarioBoundary + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "conversation work directory escaped scenario root: $workDirectory"
  }
  foreach ($instance in $instances) {
    $identityPath = Join-Path $evidenceRoot ($instance.Role + '.json')
    $identity = Wait-JsonFile -Path $identityPath -TimeoutSeconds 1
    if (
      $identity.version -ne 1 -or
      $identity.runToken -ne $runToken -or
      $identity.role -ne $instance.Role -or
      [int]$identity.pid -ne $instance.ProcessId -or
      [int]$identity.parentPid -ne $instance.ParentProcessId
    ) {
      throw "process identity did not match the externally frozen instance: $($instance.Role)"
    }
    $instance.HeartbeatPath = Join-Path $evidenceRoot ($instance.Role + '.heartbeat.log')
    $instance.RunToken = $runToken
    Wait-HeartbeatProgress -Instance $instance -TimeoutSeconds 1
  }

  if ($result.success -ne $true) { throw 'production Agent scenario did not succeed' }
  if ($result.version -ne 1 -or $result.platform -ne 'win32' -or $result.architecture -ne 'x64') {
    throw 'production Agent result platform identity mismatch'
  }
  if ($result.electron -ne $ExpectedElectronVersion) { throw "unexpected Electron version: $($result.electron)" }
  $reportedUserDataPath = ([string]$result.userDataPath).TrimEnd('\').Replace('/', '\')
  $expectedUserDataPath = ([IO.Path]::Combine(
    [string]$scenarioRoot,
    'electron-user-data'
  )).TrimEnd('\').Replace('/', '\')
  if (-not [string]::Equals(
    $reportedUserDataPath,
    $expectedUserDataPath,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Electron userData was not isolated: expected=$expectedUserDataPath actual=$($result.userDataPath)"
  }
  if ($result.durableCommandRows -ne 5) { throw "unexpected durable row count: $($result.durableCommandRows)" }
  if ($result.commandCardState -ne 'completed') { throw 'command card did not complete' }
  if ($result.terminalOutcome -ne 'terminated' -or $result.terminalReason -ne 'cancelled') {
    throw 'cancel terminal did not remain stable'
  }
  if ($result.lastProcessAction -ne 'poll' -or $result.terminalHandleReplayed -ne $true) {
    throw 'terminal handle poll replay was not preserved'
  }
  if (
    $result.promptLikeOutputObserved -ne $true -or
    $result.childStdinEofObserved -ne $true -or
    $result.silentWaitReturnedRunning -ne $true -or
    $result.automaticInputActions -ne 0
  ) {
    throw 'brand-neutral interaction waiting contract was not preserved'
  }

  Wait-FrozenProcessesExited -Instances $instances
  Assert-HeartbeatsStopped -Instances $instances
  $completed = $true
  $summary = [ordered]@{
    success = $true
    version = 1
    platform = [string]$result.platform
    architecture = [string]$result.architecture
    electron = [string]$result.electron
    graphSteps = [int]$result.graphSteps
    durableCommandRows = [int]$result.durableCommandRows
    terminalOutcome = [string]$result.terminalOutcome
    terminalReason = [string]$result.terminalReason
    lastProcessAction = [string]$result.lastProcessAction
    terminalHandleReplayed = [bool]$result.terminalHandleReplayed
    promptLikeOutputObserved = [bool]$result.promptLikeOutputObserved
    childStdinEofObserved = [bool]$result.childStdinEofObserved
    silentWaitReturnedRunning = [bool]$result.silentWaitReturnedRunning
    automaticInputActions = [int]$result.automaticInputActions
    userDataIsolated = $true
    externallyObservedProcesses = $instances.Count
    externallyExitedProcesses = $instances.Count
    allObservedProcessesInJob = (@($instances | Where-Object { -not $_.InAnyJob }).Count -eq 0)
    childParentVerified = ($child.ParentProcessId -eq $parent.ProcessId)
    grandchildParentVerified = ($grandchild.ParentProcessId -eq $child.ProcessId)
    heartbeatStopped = $true
  }
} catch {
  [Console]::Error.WriteLine(
    "LINNYA_WINDOWS_AGENT_PROCESS_CONTROLLER_ERROR={0}; POSITION={1}; STACK={2}",
    $_.Exception.Message,
    $_.InvocationInfo.PositionMessage,
    $_.ScriptStackTrace)
  throw
} finally {
  $cleanupFailures = @()
  if (-not $completed) {
    foreach ($instance in $instances) {
      try {
        Stop-FrozenProcessInstance -Instance $instance
      } catch {
        [Console]::Error.WriteLine(
          "LINNYA_WINDOWS_AGENT_PROCESS_CLEANUP_ERROR=role={0}; pid={1}; error={2}",
          $instance.Role,
          $instance.ProcessId,
          $_.Exception.Message)
      }
    }
    if ($appProcess -and -not $appProcess.HasExited) {
      try {
        $appProcess.Kill()
        $appProcess.WaitForExit(5000) | Out-Null
      } catch {
        [Console]::Error.WriteLine(
          "LINNYA_WINDOWS_AGENT_PROCESS_CLEANUP_ERROR=role=electron; pid={0}; error={1}",
          $appProcess.Id,
          $_.Exception.Message)
      }
    }
  }
  if ($appProcess) {
    $appProcessIdForCleanup = $appProcess.Id
    try {
      $appProcess.Dispose()
    } catch {
      [Console]::Error.WriteLine(
        "LINNYA_WINDOWS_AGENT_PROCESS_CLEANUP_ERROR=role=electron-dispose; pid={0}; error={1}",
        $appProcessIdForCleanup,
        $_.Exception.Message)
      if ($completed) {
        $cleanupFailures += "role=electron-dispose pid=$appProcessIdForCleanup error=$($_.Exception.Message)"
      }
    }
  }
  try {
    if ($workDirectoryHandshakePath -and (Test-Path -LiteralPath $workDirectoryHandshakePath -PathType Leaf)) {
      Remove-Item -LiteralPath $workDirectoryHandshakePath -Force
    }
  } catch {
    [Console]::Error.WriteLine(
      "LINNYA_WINDOWS_AGENT_PROCESS_CLEANUP_ERROR=role=work-directory-handshake; path={0}; error={1}",
      $workDirectoryHandshakePath,
      $_.Exception.Message)
    if ($completed) {
      $cleanupFailures += "role=work-directory-handshake path=$workDirectoryHandshakePath error=$($_.Exception.Message)"
    }
  }
  foreach ($cleanupRoot in @($resolvedRunRoot, $resolvedPackageRoot)) {
    try {
      Remove-RunRootWhenUnlocked -RunRoot $cleanupRoot
    } catch {
      [Console]::Error.WriteLine(
        "LINNYA_WINDOWS_AGENT_PROCESS_CLEANUP_ERROR=role=run-root; root={0}; error={1}",
        $cleanupRoot,
        $_.Exception.Message)
      if ($completed) {
        $cleanupFailures += "role=run-root root=$cleanupRoot error=$($_.Exception.Message)"
      }
    }
  }
  if ($completed -and $cleanupFailures.Count -gt 0) {
    throw "successful scenario cleanup failed: $($cleanupFailures -join '; ')"
  }
}

$summary | ConvertTo-Json -Compress
