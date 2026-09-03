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

function Wait-FrozenPtyProcess {
  param(
    [int]$TimeoutSeconds,
    [Diagnostics.Process]$OwnerProcess,
    [int]$ExpectedProcessId
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ($OwnerProcess.HasExited) {
      throw 'owner process exited before the PTY PowerShell process was observable'
    }

    $parentByProcessId = @{}
    $expectedProcessIsPowerShell = $false
    foreach ($candidate in [Diagnostics.Process]::GetProcesses()) {
      try {
        $parentByProcessId[$candidate.Id] = [LinnyaProcessObservation]::ReadParentProcessId($candidate)
        if ($candidate.Id -eq $ExpectedProcessId -and $candidate.ProcessName -ieq 'powershell') {
          $expectedProcessIsPowerShell = $true
        }
      } catch {
        # 普通用户无法读取部分系统进程；它们不可能成为本次 Electron 的可控后代。
      } finally {
        $candidate.Dispose()
      }
    }

    if ($expectedProcessIsPowerShell) {
      $cursor = $ExpectedProcessId
      $visited = @{}
      while ($parentByProcessId.ContainsKey($cursor) -and -not $visited.ContainsKey($cursor)) {
        $visited[$cursor] = $true
        $cursor = [int]$parentByProcessId[$cursor]
        if ($cursor -eq $OwnerProcess.Id) {
          return Get-FrozenProcessInstance -ProcessId $ExpectedProcessId -Role 'pty-cli'
        }
      }
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "timed out waiting for PTY PowerShell PID $ExpectedProcessId under Electron"
}

function Get-FrozenProcessInstance {
  param(
    [int]$ProcessId,
    [string]$Role
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
  $executablePath = Join-Path $applicationRoot 'Linnya Windows Production Agent Pty Validation.exe'
  $fixturePath = Join-Path $applicationRoot 'resources\command-fixtures\interactive-cli.ps1'
  if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw "packaged executable is missing: $executablePath"
  }
  if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
    throw "PTY fixture is missing: $fixturePath"
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
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PTY_RESULT_PATH'] = $resultPath
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PTY_RUN_ROOT'] = $scenarioRoot
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PTY_COMMAND'] = '& $env:LINNYA_AGENT_PTY_FIXTURE -RunToken $env:LINNYA_AGENT_PTY_RUN_TOKEN -IdentityPath .\pty-cli-identity.json'
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PTY_OBSERVATION_READY_PATH'] = $observationReadyPath
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PTY_WORK_DIRECTORY_HANDSHAKE_PATH'] = $workDirectoryHandshakePath
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PTY_FIXTURE'] = $fixturePath
  $startInfo.EnvironmentVariables['LINNYA_AGENT_PTY_RUN_TOKEN'] = $runToken
  $actualShellCommandText = $startInfo.EnvironmentVariables['LINNYA_AGENT_PTY_COMMAND']
  if ([string]::IsNullOrWhiteSpace($actualShellCommandText)) {
    throw 'shell command environment was not preserved by ProcessStartInfo'
  }

  $appProcess = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $appProcess) { throw 'failed to start packaged Electron fixture' }
  $stdoutTask = $appProcess.StandardOutput.ReadToEndAsync()
  $stderrTask = $appProcess.StandardError.ReadToEndAsync()

  try {
    $handshake = Wait-JsonFile -Path $workDirectoryHandshakePath -TimeoutSeconds 60 -OwnerProcess $appProcess
    if ($handshake.version -ne 1 -or $handshake.conversationId -ne 'conversation-agent-pty-e2e') {
      throw 'conversation work-directory handshake is invalid'
    }
    $workDirectory = [IO.Path]::GetFullPath([string]$handshake.absolutePath)
    $scenarioBoundary = [IO.Path]::GetFullPath($scenarioRoot).TrimEnd('\')
    if (-not $workDirectory.StartsWith($scenarioBoundary + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw "conversation work directory escaped scenario root: $workDirectory"
    }
    $identityPath = Join-Path $workDirectory 'pty-cli-identity.json'
    $identity = Wait-JsonFile -Path $identityPath -TimeoutSeconds 60 -OwnerProcess $appProcess
    if ($identity.version -ne 1 -or $identity.runToken -ne $runToken) {
      throw 'PTY identity payload is invalid'
    }
    $instances = @(
      Wait-FrozenPtyProcess `
        -TimeoutSeconds 60 `
        -OwnerProcess $appProcess `
        -ExpectedProcessId ([int]$identity.pid)
    )
  } catch {
    if (-not $appProcess.HasExited) {
      $appProcess.Kill()
      $appProcess.WaitForExit(5000) | Out-Null
    }
    $earlyStdout = $stdoutTask.Result
    $earlyStderr = $stderrTask.Result
    throw "packaged Electron did not expose its PTY PowerShell process: code=$($appProcess.ExitCode); cause=$($_.Exception.Message); stderr=$earlyStderr; stdout=$earlyStdout"
  }
  foreach ($instance in $instances) {
    if (-not $instance.InAnyJob) { throw "$($instance.Role) is not owned by a Windows Job" }
    if ([IO.Path]::GetFileName($instance.ExecutablePath) -ine 'powershell.exe') {
      throw "$($instance.Role) executable is not PowerShell: $($instance.ExecutablePath)"
    }
  }

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

  if (
    $identity.version -ne 1 -or
    $identity.runToken -ne $runToken -or
    [int]$identity.pid -ne $instances[0].ProcessId
  ) {
    throw 'PTY identity did not match the externally frozen instance'
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
  if ($result.durableCommandRows -lt 11 -or $result.durableCommandRows -gt 24) {
    throw "unexpected durable row count: $($result.durableCommandRows)"
  }
  if ($result.commandCardState -ne 'completed') { throw 'command card did not complete' }
  if ($result.terminalOutcome -ne 'terminated' -or $result.terminalReason -ne 'cancelled') {
    throw 'explicit cancel did not remain distinct from Windows EOF'
  }
  if ($result.lastProcessAction -ne 'poll') {
    throw 'terminal handle poll replay was not preserved'
  }

  Wait-FrozenProcessesExited -Instances $instances
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
    screenColumns = [int]$result.screenColumns
    screenRows = [int]$result.screenRows
    rawTerminalBytes = [int64]$result.rawTerminalBytes
    userDataIsolated = $true
    externallyObservedProcesses = $instances.Count
    externallyExitedProcesses = $instances.Count
    allObservedProcessesInJob = (@($instances | Where-Object { -not $_.InAnyJob }).Count -eq 0)
    terminalHandleReplayed = ($result.lastProcessAction -eq 'poll')
  }
} catch {
  [Console]::Error.WriteLine(
    "LINNYA_WINDOWS_AGENT_PTY_CONTROLLER_ERROR={0}; POSITION={1}; STACK={2}",
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
          "LINNYA_WINDOWS_AGENT_PTY_CLEANUP_ERROR=role={0}; pid={1}; error={2}",
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
          "LINNYA_WINDOWS_AGENT_PTY_CLEANUP_ERROR=role=electron; pid={0}; error={1}",
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
        "LINNYA_WINDOWS_AGENT_PTY_CLEANUP_ERROR=role=electron-dispose; pid={0}; error={1}",
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
      "LINNYA_WINDOWS_AGENT_PTY_CLEANUP_ERROR=role=work-directory-handshake; path={0}; error={1}",
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
        "LINNYA_WINDOWS_AGENT_PTY_CLEANUP_ERROR=role=run-root; root={0}; error={1}",
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
