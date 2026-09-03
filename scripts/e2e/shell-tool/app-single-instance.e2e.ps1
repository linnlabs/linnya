param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedElectronVersion
)

$ErrorActionPreference = 'Stop'

function Wait-Until {
  param(
    [Parameter(Mandatory = $true)] [scriptblock]$Condition,
    [Parameter(Mandatory = $true)] [string]$Label,
    [int]$TimeoutMs = 20000
  )
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 25
  }
  throw "$Label timed out"
}

function Start-ValidationApp {
  param(
    [Parameter(Mandatory = $true)] [string]$ExecutablePath,
    [Parameter(Mandatory = $true)] [string]$ScenarioRoot
  )
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ExecutablePath
  $startInfo.UseShellExecute = $false
  $startInfo.EnvironmentVariables['LINNYA_SINGLE_INSTANCE_RUN_ROOT'] = $ScenarioRoot
  return [System.Diagnostics.Process]::Start($startInfo)
}

function Wait-CleanExit {
  param(
    [Parameter(Mandatory = $true)] [System.Diagnostics.Process]$Process,
    [Parameter(Mandatory = $true)] [string]$Label
  )
  if (-not $Process.WaitForExit(20000)) {
    try { $Process.Kill() } catch {}
    throw "$Label did not exit"
  }
  if ($Process.ExitCode -ne 0) {
    throw "$Label exit code was $($Process.ExitCode)"
  }
}

$remoteTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$resolvedArchive = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $resolvedArchive -PathType Leaf)) {
  throw "archive does not exist: $resolvedArchive"
}
$runRoot = Join-Path $remoteTemp ('linnya-app-instance-' + [Guid]::NewGuid().ToString('N'))
$resolvedRunRoot = [IO.Path]::GetFullPath($runRoot)
if (-not $resolvedRunRoot.StartsWith($remoteTemp + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "run root escaped Windows temp: $resolvedRunRoot"
}

$primary = $null
$secondaries = @()
$summary = $null
$completed = $false
try {
  New-Item -ItemType Directory -Path $resolvedRunRoot | Out-Null
  & tar.exe -xzf $resolvedArchive -C $resolvedRunRoot
  if ($LASTEXITCODE -ne 0) { throw "tar failed: $LASTEXITCODE" }

  $appPath = Join-Path $resolvedRunRoot 'win-unpacked\Linnya App Instance Validation.exe'
  $scenarioRoot = Join-Path $resolvedRunRoot 'scenario'
  New-Item -ItemType Directory -Path $scenarioRoot | Out-Null
  $eventLogPath = Join-Path $scenarioRoot 'events.log'
  $writerPath = Join-Path $scenarioRoot 'primary-writers.log'
  $backendReadyPath = Join-Path $scenarioRoot 'backend-ready'
  $stopPath = Join-Path $scenarioRoot 'stop'
  $runtimeIdentityPath = Join-Path $scenarioRoot 'runtime-identity.json'

  $primary = Start-ValidationApp -ExecutablePath $appPath -ScenarioRoot $scenarioRoot
  Wait-Until -Label 'primary owner readiness' -Condition {
    (Test-Path -LiteralPath $eventLogPath) -and
      ((Get-Content -Raw -LiteralPath $eventLogPath).Contains('primary-owner-ready'))
  }

  $beforeReady = Start-ValidationApp -ExecutablePath $appPath -ScenarioRoot $scenarioRoot
  $secondaries += $beforeReady
  Wait-CleanExit -Process $beforeReady -Label 'pre-backend secondary'
  Wait-Until -Label 'pre-backend second-instance delivery' -Condition {
    (Get-Content -Raw -LiteralPath $eventLogPath).Contains('second-instance-window-count=0')
  }

  New-Item -ItemType File -Path $backendReadyPath | Out-Null
  Wait-Until -Label 'primary window readiness' -Condition {
    (Get-Content -Raw -LiteralPath $eventLogPath).Contains('primary-ready')
  }

  for ($index = 0; $index -lt 3; $index += 1) {
    $secondary = Start-ValidationApp -ExecutablePath $appPath -ScenarioRoot $scenarioRoot
    $secondaries += $secondary
    Wait-CleanExit -Process $secondary -Label "ready secondary $index"
  }
  Wait-Until -Label 'ready second-instance delivery' -Condition {
    $log = Get-Content -Raw -LiteralPath $eventLogPath
    ([regex]::Matches($log, 'second-instance-window-count=1')).Count -ge 3
  }

  $eventLog = Get-Content -Raw -LiteralPath $eventLogPath
  $runtimeIdentity = Get-Content -Raw -LiteralPath $runtimeIdentityPath | ConvertFrom-Json
  if (
    $runtimeIdentity.platform -ne 'win32' -or
    $runtimeIdentity.architecture -ne 'x64' -or
    -not $runtimeIdentity.packaged -or
    $runtimeIdentity.electron -ne $ExpectedElectronVersion
  ) {
    throw "runtime identity mismatch: $($runtimeIdentity | ConvertTo-Json -Compress)"
  }
  $writers = @((Get-Content -LiteralPath $writerPath) | Where-Object { $_ -ne '' })
  if ($writers.Count -ne 1 -or [int]$writers[0] -ne $primary.Id) {
    throw "single writer mismatch: writers=$($writers -join ',') primary=$($primary.Id)"
  }
  if ($primary.HasExited) { throw 'primary exited after secondary launch' }
  if (-not $eventLog.Contains('primary-window-count=1')) {
    throw "primary window ownership mismatch: $eventLog"
  }

  New-Item -ItemType File -Path $stopPath | Out-Null
  Wait-CleanExit -Process $primary -Label 'primary'
  $summary = [ordered]@{
    success = $true
    platform = 'win32'
    architecture = $runtimeIdentity.architecture
    hostArchitecture = $env:PROCESSOR_ARCHITECTURE.ToLowerInvariant()
    packaged = $runtimeIdentity.packaged
    electron = $runtimeIdentity.electron
    primaryWriters = $writers.Count
    secondaryLaunches = $secondaries.Count
    preBackendWindowCount = 0
    primaryWindowCount = 1
    readySecondInstanceWindowCount = 1
    primaryStayedAlive = $true
    primaryCleanExit = $true
  }
  $completed = $true
} finally {
  foreach ($process in $secondaries) {
    if ($null -ne $process -and -not $process.HasExited) {
      try { $process.Kill() } catch {}
    }
  }
  if ($null -ne $primary -and -not $primary.HasExited) {
    try { $primary.Kill() } catch {}
  }
  for ($attempt = 0; $attempt -lt 40 -and (Test-Path -LiteralPath $resolvedRunRoot); $attempt += 1) {
    try { Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force } catch {}
    if (Test-Path -LiteralPath $resolvedRunRoot) { Start-Sleep -Milliseconds 100 }
  }
}

if (-not $completed) { throw 'Windows packaged app instance validation did not complete' }
$summary.runRootRemoved = -not (Test-Path -LiteralPath $resolvedRunRoot)
if (-not $summary.runRootRemoved) { throw "run root remains: $resolvedRunRoot" }
$summary | ConvertTo-Json -Compress
