param(
  [Parameter(Mandatory = $true)][string]$ValidationRoot,
  [Parameter(Mandatory = $true)][string]$NodeArm64Path,
  [Parameter(Mandatory = $true)][string]$NodeX64Path,
  [switch]$OwnerCrashMode,
  [string]$OwnerCrashArchitecture,
  [string]$OwnerCrashRoot
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$fixtureRoot = Join-Path $ValidationRoot 'fixture'
$moduleRoot = Join-Path $ValidationRoot 'node_modules'
$probeSource = Join-Path $fixtureRoot 'WindowsPtyJobProbe.cs'
$runnerScript = Join-Path $fixtureRoot 'pty-runner.cjs'
Add-Type -Path $probeSource

function ConvertTo-WindowsArgument {
  param([AllowEmptyString()][string]$Value)
  $backslash = [char]92
  $quote = [char]34
  if ($Value.Length -gt 0 -and $Value -notmatch '\s' -and $Value.IndexOf($quote) -lt 0) {
    return $Value
  }
  $result = New-Object Text.StringBuilder
  [void]$result.Append($quote)
  $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq $backslash) { $slashes += 1; continue }
    if ($character -eq $quote) {
      [void]$result.Append($backslash, ($slashes * 2 + 1))
      [void]$result.Append($quote)
      $slashes = 0
      continue
    }
    if ($slashes -gt 0) { [void]$result.Append($backslash, $slashes); $slashes = 0 }
    [void]$result.Append($character)
  }
  if ($slashes -gt 0) { [void]$result.Append($backslash, ($slashes * 2)) }
  [void]$result.Append($quote)
  return $result.ToString()
}

function Wait-Until {
  param([scriptblock]$Condition, [string]$Description, [int]$TimeoutMilliseconds = 20000)
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $value = & $Condition
    if ($null -ne $value -and $value -ne $false) { return $value }
    Start-Sleep -Milliseconds 20
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for $Description"
}

function Write-TextAtomically {
  param([string]$Path, [string]$Value)
  [IO.File]::WriteAllText($Path + '.pending', $Value)
  [IO.File]::Move($Path + '.pending', $Path)
}

function Write-JsonAtomically {
  param([string]$Path, [object]$Value)
  Write-TextAtomically -Path $Path -Value ($Value | ConvertTo-Json -Compress -Depth 10)
}

function Get-ProcessIdentity {
  param([int]$ProcessId)
  $process = [Diagnostics.Process]::GetProcessById($ProcessId)
  try {
    return [pscustomobject]@{
      processId = $ProcessId
      startTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks.ToString()
    }
  } finally { $process.Dispose() }
}

function Test-ExactProcess {
  param([object]$Identity)
  try {
    $process = [Diagnostics.Process]::GetProcessById([int]$Identity.processId)
    try {
      return (-not $process.HasExited) -and
        $process.StartTime.ToUniversalTime().Ticks.ToString() -eq [string]$Identity.startTimeUtcTicks
    } finally { $process.Dispose() }
  } catch [ArgumentException] { return $false }
}

function Wait-ExactProcessesGone {
  param([object[]]$Identities, [string]$Description)
  Wait-Until -Description $Description -Condition {
    $alive = @($Identities | Where-Object { Test-ExactProcess $_ })
    if ($alive.Count -eq 0) { return $true }
    return $false
  } | Out-Null
}

function Wait-JobEmpty {
  param([WindowsPtyJobProbe]$Job, [string]$Description)
  Wait-Until -Description $Description -Condition {
    if ($Job.ActiveProcessCount() -eq 0) { return $true }
    return $false
  } | Out-Null
}

function Assert-HeartbeatAdvances {
  param([string]$Path)
  Wait-Until -Description 'initial heartbeat' -Condition {
    if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -gt 0) {
      return (Get-Item -LiteralPath $Path).Length
    }
    return $false
  } | Out-Null
  $before = (Get-Item -LiteralPath $Path).Length
  Wait-Until -Description 'heartbeat advance' -Condition {
    if ((Get-Item -LiteralPath $Path).Length -gt $before) { return $true }
    return $false
  } | Out-Null
}

function Assert-HeartbeatStops {
  param([string]$Path)
  $before = (Get-Item -LiteralPath $Path).Length
  Start-Sleep -Milliseconds 500
  $after = (Get-Item -LiteralPath $Path).Length
  if ($before -ne $after) { throw "Heartbeat continued after tree cleanup: $Path" }
}

function Start-RunnerInJob {
  param(
    [string]$NodePath,
    [string]$Architecture,
    [string]$ScenarioRoot,
    [string]$Mode,
    [WindowsPtyJobProbe]$OuterJob
  )
  New-Item -ItemType Directory -Path $ScenarioRoot -Force | Out-Null
  $token = [Guid]::NewGuid().ToString('N')
  $arguments = @($runnerScript, $moduleRoot, $fixtureRoot, $ScenarioRoot, $Mode, $token) |
    ForEach-Object { ConvertTo-WindowsArgument $_ }
  $job = [WindowsPtyJobProbe]::Create($true)
  try {
    # Job List 让 runner 在 CreateProcess 成功时已经归属 Job；gate 只用于在
    # node-pty 创建用户树前从外部复核，避免把测试重新退回 spawn 后追赶 PID。
    if ([string]::IsNullOrWhiteSpace($NodePath)) { throw 'PTY runner Node path was empty' }
    $nativeNodePath = [IO.Path]::GetFullPath($NodePath)
    if (-not (Test-Path -LiteralPath $nativeNodePath -PathType Leaf)) {
      throw "PTY runner Node path did not resolve: $nativeNodePath"
    }
    $commandLine = (ConvertTo-WindowsArgument $nativeNodePath) + ' ' + ($arguments -join ' ')
    $process = $job.StartProcess($nativeNodePath, $commandLine, $ScenarioRoot)
    $inInnerByHandleBeforeGate = $job.ContainsProcess($process)
    $inInnerBeforeGate = $job.Contains($process.Id)
    $inOuterBeforeGate = $OuterJob.Contains($process.Id)
    if (-not $inInnerByHandleBeforeGate -or -not $inInnerBeforeGate -or -not $inOuterBeforeGate) {
      throw "Runner Job membership was incomplete before the gate opened: innerHandle=$inInnerByHandleBeforeGate innerPid=$inInnerBeforeGate outer=$inOuterBeforeGate active=$($job.ActiveProcessCount()) exited=$($process.HasExited)"
    }
    Write-TextAtomically -Path (Join-Path $ScenarioRoot 'assigned-to-job.gate') -Value $token
    return [pscustomobject]@{
      architecture = $Architecture
      token = $token
      process = $process
      job = $job
      scenarioRoot = $ScenarioRoot
      inInnerBeforeGate = $inInnerBeforeGate
      inOuterBeforeGate = $inOuterBeforeGate
    }
  } catch {
    $job.Dispose()
    if ($null -ne $process) {
      if (-not $process.HasExited) { $process.Kill() }
      $process.Dispose()
    }
    throw
  }
}

function Read-RunnerReady {
  param([object]$Run)
  $readyPath = Join-Path $Run.scenarioRoot 'runner-ready.json'
  Wait-Until -Description "$($Run.architecture) runner ready" -Condition {
    if ((Test-Path -LiteralPath $readyPath) -and (Get-Item -LiteralPath $readyPath).Length -gt 0) {
      return Get-Content -Raw -LiteralPath $readyPath | ConvertFrom-Json
    }
    return $false
  }
}

function Get-ReadyIdentities {
  param([object]$Run, [object]$Ready)
  try { $runner = Get-ProcessIdentity -ProcessId $Run.process.Id }
  catch { throw "Runner identity disappeared before observation: $($Run.process.Id): $($_.Exception.Message)" }
  try { $ptyRoot = Get-ProcessIdentity -ProcessId ([int]$Ready.ptyRootProcessId) }
  catch { throw "PTY root identity disappeared before observation: $($Ready.ptyRootProcessId): $($_.Exception.Message)" }
  try { $background = Get-ProcessIdentity -ProcessId ([int]$Ready.backgroundProcessId) }
  catch { throw "Background identity disappeared before observation: $($Ready.backgroundProcessId): $($_.Exception.Message)" }
  return @($runner, $ptyRoot, $background)
}

function Assert-HoldMembership {
  param([object]$Run, [object]$Ready, [WindowsPtyJobProbe]$OuterJob)
  foreach ($processId in @($Run.process.Id, [int]$Ready.ptyRootProcessId, [int]$Ready.backgroundProcessId)) {
    if (-not $Run.job.Contains($processId)) { throw "PID $processId is outside the command Job" }
    if (-not $OuterJob.Contains($processId)) { throw "PID $processId is outside the nested outer Job" }
  }
  $active = $Run.job.ActiveProcessCount()
  if ($active -lt 3) { throw "Expected at least runner/root/background in Job, active=$active" }
  return $active
}

function Invoke-NaturalScenario {
  param([string]$NodePath, [string]$Architecture, [string]$Root, [WindowsPtyJobProbe]$OuterJob)
  $run = Start-RunnerInJob $NodePath $Architecture $Root 'natural' $OuterJob
  try {
    $ready = Read-RunnerReady $run
    if ([int]$ready.ptyExit.exitCode -ne 23) { throw 'PTY root did not preserve natural exit 23' }
    $runnerIdentity = Get-ProcessIdentity $run.process.Id
    $backgroundIdentity = Get-ProcessIdentity ([int]$ready.backgroundProcessId)
    if (-not $run.job.Contains($run.process.Id) -or -not $run.job.Contains([int]$ready.backgroundProcessId)) {
      throw 'Natural-exit survivor is outside the command Job'
    }
    $activeAfterPtyExit = $run.job.ActiveProcessCount()
    if ($activeAfterPtyExit -lt 2) { throw "Natural exit lost runner/background accounting: $activeAfterPtyExit" }
    $heartbeat = Join-Path $Root 'heartbeat.log'
    Assert-HeartbeatAdvances $heartbeat
    Write-TextAtomically -Path (Join-Path $Root 'runner-command.txt') -Value 'exit'
    if (-not $run.process.WaitForExit(10000)) { throw 'Natural runner did not exit' }
    $activeAfterRunnerExit = $run.job.ActiveProcessCount()
    if ($activeAfterRunnerExit -lt 1) { throw 'Background descendant was not retained after runner exit' }
    $run.job.Terminate(91)
    Wait-JobEmpty $run.job 'natural scenario tree empty'
    Wait-ExactProcessesGone @($runnerIdentity, $backgroundIdentity) 'natural scenario exact identities gone'
    Assert-HeartbeatStops $heartbeat
    return [pscustomobject]@{
      architecture = $Architecture
      activeAfterPtyExit = $activeAfterPtyExit
      activeAfterRunnerExit = $activeAfterRunnerExit
      treeEmpty = $true
      heartbeatStopped = $true
    }
  } finally {
    if (-not $run.process.HasExited) { $run.job.Terminate(92) }
    $run.process.Dispose()
    $run.job.Dispose()
  }
}

function Invoke-CancelScenario {
  param([string]$NodePath, [string]$Architecture, [string]$Root, [WindowsPtyJobProbe]$OuterJob)
  $run = Start-RunnerInJob $NodePath $Architecture $Root 'hold' $OuterJob
  try {
    $ready = Read-RunnerReady $run
    $identities = Get-ReadyIdentities $run $ready
    $activeBeforeCancel = Assert-HoldMembership $run $ready $OuterJob
    $heartbeat = Join-Path $Root 'heartbeat.log'
    Assert-HeartbeatAdvances $heartbeat
    $run.job.Terminate(93)
    Wait-JobEmpty $run.job 'cancel tree empty'
    Wait-ExactProcessesGone $identities 'cancel exact identities gone'
    Assert-HeartbeatStops $heartbeat
    return [pscustomobject]@{
      architecture = $Architecture
      activeBeforeCancel = $activeBeforeCancel
      treeEmpty = $true
      heartbeatStopped = $true
    }
  } finally {
    if (-not $run.process.HasExited) { $run.job.Terminate(94) }
    $run.process.Dispose()
    $run.job.Dispose()
  }
}

function Invoke-RunnerCrashScenario {
  param([string]$NodePath, [string]$Architecture, [string]$Root, [WindowsPtyJobProbe]$OuterJob)
  $run = Start-RunnerInJob $NodePath $Architecture $Root 'hold' $OuterJob
  $jobDisposed = $false
  try {
    $ready = Read-RunnerReady $run
    $identities = Get-ReadyIdentities $run $ready
    $activeBeforeCrash = Assert-HoldMembership $run $ready $OuterJob
    $heartbeat = Join-Path $Root 'heartbeat.log'
    Assert-HeartbeatAdvances $heartbeat
    $run.process.Kill()
    if (-not $run.process.WaitForExit(10000)) { throw 'Runner crash injection did not exit' }
    Assert-HeartbeatAdvances $heartbeat
    $activeAfterRunnerCrash = $run.job.ActiveProcessCount()
    if ($activeAfterRunnerCrash -lt 1) { throw 'Detached background escaped after runner crash' }
    if (-not $run.job.Contains([int]$ready.backgroundProcessId)) {
      throw 'Detached background left command Job after runner crash'
    }
    $ptyRootAliveAfterRunnerCrash = Test-ExactProcess $identities[1]
    if ($ptyRootAliveAfterRunnerCrash -and -not $run.job.Contains([int]$ready.ptyRootProcessId)) {
      throw 'Live ConPTY root left command Job after runner crash'
    }
    $run.job.Dispose()
    $jobDisposed = $true
    Wait-ExactProcessesGone $identities 'KILL_ON_JOB_CLOSE exact identities gone'
    Assert-HeartbeatStops $heartbeat
    return [pscustomobject]@{
      architecture = $Architecture
      activeBeforeCrash = $activeBeforeCrash
      activeAfterRunnerCrash = $activeAfterRunnerCrash
      ptyRootAliveAfterRunnerCrash = $ptyRootAliveAfterRunnerCrash
      ownerHandleCloseKilledTree = $true
      heartbeatStopped = $true
    }
  } finally {
    if (-not $jobDisposed) {
      if (-not $run.process.HasExited) { $run.job.Terminate(95) }
      $run.job.Dispose()
    }
    $run.process.Dispose()
  }
}

function Invoke-StressScenario {
  param([string]$NodePath, [string]$Architecture, [string]$Root, [WindowsPtyJobProbe]$OuterJob)
  $baseline = [Diagnostics.Process]::GetCurrentProcess().HandleCount
  $rounds = 20
  for ($index = 0; $index -lt $rounds; $index += 1) {
    $roundRoot = Join-Path $Root ("round-" + $index)
    $run = Start-RunnerInJob $NodePath $Architecture $roundRoot 'quick' $OuterJob
    try {
      if (-not $run.process.WaitForExit(15000)) { throw "Stress runner $index did not exit" }
      $run.job.Terminate(96)
      Wait-JobEmpty $run.job "stress round $index tree empty"
    } finally {
      if (-not $run.process.HasExited) { $run.job.Terminate(97) }
      $run.process.Dispose()
      $run.job.Dispose()
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  [GC]::Collect()
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $current = [Diagnostics.Process]::GetCurrentProcess().HandleCount
    if ($current -le $baseline + 8) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($current -gt $baseline + 8) {
    throw "Controller handles did not recover: baseline=$baseline current=$current"
  }
  return [pscustomobject]@{
    architecture = $Architecture
    rounds = $rounds
    handleBaseline = $baseline
    handleAfter = $current
  }
}

function Resolve-NodePath {
  param([string]$Architecture)
  if ($Architecture -eq 'arm64') { return $NodeArm64Path }
  if ($Architecture -eq 'x64') { return $NodeX64Path }
  throw "Unsupported architecture: $Architecture"
}

if ($OwnerCrashMode) {
  $nodePath = Resolve-NodePath $OwnerCrashArchitecture
  $outerJob = [WindowsPtyJobProbe]::Create($false)
  try {
    $current = [Diagnostics.Process]::GetCurrentProcess()
    try { $outerJob.Assign($current) } finally { $current.Dispose() }
    $run = Start-RunnerInJob $nodePath $OwnerCrashArchitecture $OwnerCrashRoot 'hold' $outerJob
    $ready = Read-RunnerReady $run
    $active = Assert-HoldMembership $run $ready $outerJob
    $identities = Get-ReadyIdentities $run $ready
    Write-JsonAtomically -Path (Join-Path $OwnerCrashRoot 'owner-ready.json') -Value ([pscustomobject]@{
      version = 1
      owner = Get-ProcessIdentity $PID
      runner = $identities[0]
      ptyRoot = $identities[1]
      background = $identities[2]
      activeBeforeOwnerCrash = $active
    })
    while ($true) { Start-Sleep -Seconds 1 }
  } finally {
    $outerJob.Dispose()
  }
}

function Invoke-OwnerCrashScenario {
  param([string]$Architecture, [string]$Root)
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
  $arguments = @(
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', $PSCommandPath,
    '-ValidationRoot', $ValidationRoot,
    '-NodeArm64Path', $NodeArm64Path,
    '-NodeX64Path', $NodeX64Path,
    '-OwnerCrashMode',
    '-OwnerCrashArchitecture', $Architecture,
    '-OwnerCrashRoot', $Root
  ) | ForEach-Object { ConvertTo-WindowsArgument $_ }
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $startInfo.Arguments = $arguments -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $owner = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $owner) { throw 'Failed to start owner crash fixture' }
  try {
    $readyPath = Join-Path $Root 'owner-ready.json'
    $ready = Wait-Until -Description "$Architecture owner crash ready" -Condition {
      if ((Test-Path -LiteralPath $readyPath) -and (Get-Item -LiteralPath $readyPath).Length -gt 0) {
        return Get-Content -Raw -LiteralPath $readyPath | ConvertFrom-Json
      }
      if ($owner.HasExited) { throw "Owner fixture exited before ready: $($owner.ExitCode)" }
      return $false
    }
    $heartbeat = Join-Path $Root 'heartbeat.log'
    Assert-HeartbeatAdvances $heartbeat
    $owner.Kill()
    if (-not $owner.WaitForExit(10000)) { throw 'Owner crash injection did not exit' }
    $identities = @($ready.owner, $ready.runner, $ready.ptyRoot, $ready.background)
    Wait-ExactProcessesGone $identities 'owner crash exact identities gone'
    Assert-HeartbeatStops $heartbeat
    return [pscustomobject]@{
      architecture = $Architecture
      activeBeforeOwnerCrash = [int]$ready.activeBeforeOwnerCrash
      ownerHandleCloseKilledTree = $true
      heartbeatStopped = $true
    }
  } finally {
    if (-not $owner.HasExited) { $owner.Kill(); $owner.WaitForExit() }
    $owner.Dispose()
  }
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdministrator) { throw 'Validation 89 must run as a standard user' }
foreach ($nodePath in @($NodeArm64Path, $NodeX64Path)) {
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw "Node runtime missing: $nodePath" }
}

$suiteRoot = Join-Path $ValidationRoot 'runs'
New-Item -ItemType Directory -Path $suiteRoot -Force | Out-Null
$outerJob = [WindowsPtyJobProbe]::Create($false)
try {
  $current = [Diagnostics.Process]::GetCurrentProcess()
  try { $outerJob.Assign($current) } finally { $current.Dispose() }
  if (-not $outerJob.Contains($PID)) { throw 'Controller did not enter the nested outer Job' }
  $results = @()
  foreach ($architecture in @('arm64', 'x64')) {
    $nodePath = Resolve-NodePath $architecture
    $architectureRoot = Join-Path $suiteRoot $architecture
    try { $natural = Invoke-NaturalScenario $nodePath $architecture (Join-Path $architectureRoot 'natural') $outerJob }
    catch { throw "$architecture natural scenario failed: $($_.Exception.Message)" }
    try { $cancel = Invoke-CancelScenario $nodePath $architecture (Join-Path $architectureRoot 'cancel') $outerJob }
    catch { throw "$architecture cancel scenario failed: $($_.Exception.Message)" }
    try { $runnerCrash = Invoke-RunnerCrashScenario $nodePath $architecture (Join-Path $architectureRoot 'runner-crash') $outerJob }
    catch { throw "$architecture runner-crash scenario failed: $($_.Exception.Message)" }
    try { $stress = Invoke-StressScenario $nodePath $architecture (Join-Path $architectureRoot 'stress') $outerJob }
    catch { throw "$architecture stress scenario failed: $($_.Exception.Message)" }
    $results += [pscustomobject]@{
      architecture = $architecture
      natural = $natural
      cancel = $cancel
      runnerCrash = $runnerCrash
      stress = $stress
    }
  }
} finally {
  $outerJob.Dispose()
}

$ownerCrash = @()
foreach ($architecture in @('arm64', 'x64')) {
  try {
    $ownerCrash += Invoke-OwnerCrashScenario $architecture (Join-Path $suiteRoot ("owner-crash-" + $architecture))
  } catch { throw "$architecture owner-crash scenario failed: $($_.Exception.Message)" }
}

[pscustomobject]@{
  success = $true
  os = [Environment]::OSVersion.VersionString
  user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  userIsAdministrator = $isAdministrator
  controllerArchitecture = $env:PROCESSOR_ARCHITECTURE
  nestedOuterJob = $true
  results = $results
  ownerCrash = $ownerCrash
} | ConvertTo-Json -Compress -Depth 12
