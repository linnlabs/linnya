param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,
  [Parameter(Mandatory = $true)]
  [string]$NodeArm64Path,
  [Parameter(Mandatory = $true)]
  [string]$NodeX64Path
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

function Stop-ValidationProcessTree {
  param([Diagnostics.Process]$Process)

  if ($null -eq $Process -or $Process.HasExited) { return }
  # 普通用户对本次自己创建的 Node tree 有终止权；这里只负责实验超时收尾，不是生产 owner。
  & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $Process.Id /T /F | Out-Null
}

function Invoke-PtySuite {
  param(
    [string]$NodePath,
    [string]$Architecture,
    [string]$ValidationRoot
  )

  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Node runtime does not exist: $NodePath"
  }
  $resultPath = Join-Path $ValidationRoot ("result-$Architecture.json")
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $NodePath
  $startInfo.WorkingDirectory = $ValidationRoot
  $startInfo.Arguments = '"' + (Join-Path $ValidationRoot 'fixture\validation-suite.cjs') + '"'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables['LINNYA_PTY_VALIDATION_MODULE_ROOT'] = Join-Path $ValidationRoot 'node_modules'
  $startInfo.EnvironmentVariables['LINNYA_PTY_VALIDATION_RESULT_PATH'] = $resultPath
  $startInfo.EnvironmentVariables['LINNYA_PTY_VALIDATION_RUNTIME_KIND'] = "windows-node-$Architecture"
  $process = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) { throw "failed to start $Architecture Node suite" }
  try {
    # 必须先并发排空输出；node-pty 诊断或断言失败不能与控制器 pipe 互锁。
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(90000)) {
      Stop-ValidationProcessTree -Process $process
      throw "$Architecture Node suite timed out"
    }
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      throw "$Architecture Node suite exit=$($process.ExitCode) stderr=$stderr stdout=$stdout"
    }
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
      throw "$Architecture Node suite did not publish a result"
    }
    $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
    if (-not $result.success -or $result.runtime.architecture -ne $Architecture) {
      throw "$Architecture Node suite identity mismatch"
    }
    return $result
  } finally {
    Stop-ValidationProcessTree -Process $process
    $process.Dispose()
  }
}

function Remove-RunRootWhenUnlocked {
  param([string]$RunRoot)

  $deadline = [DateTime]::UtcNow.AddSeconds(15)
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
  throw "PTY validation directory remained locked: $($lastError.Message)"
}

$resolvedArchive = [IO.Path]::GetFullPath($ArchivePath)
$unicodeSegment = [string]([char]0x7EC8) + [char]0x7AEF + [char]0x9A8C + [char]0x8BC1
$runRoot = Join-Path ([IO.Path]::GetTempPath()) ("linnya $unicodeSegment " + [Guid]::NewGuid().ToString('N'))
$completed = $false
try {
  New-Item -ItemType Directory -Path $runRoot | Out-Null
  & tar.exe -xzf $resolvedArchive -C $runRoot
  if ($LASTEXITCODE -ne 0) { throw "tar failed: $LASTEXITCODE" }
  $validationRoot = Join-Path $runRoot 'validation'
  $arm64 = Invoke-PtySuite -NodePath $NodeArm64Path -Architecture 'arm64' -ValidationRoot $validationRoot
  $x64 = Invoke-PtySuite -NodePath $NodeX64Path -Architecture 'x64' -ValidationRoot $validationRoot
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  $summary = [pscustomobject]@{
    success = $true
    os = [Environment]::OSVersion.VersionString
    user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    userIsAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    arm64 = $arm64
    x64 = $x64
    runDirectoryRemoved = $true
  }
  $completed = $true
} finally {
  if (Test-Path -LiteralPath $runRoot) {
    Remove-RunRootWhenUnlocked -RunRoot $runRoot
  }
}

if (-not $completed -or (Test-Path -LiteralPath $runRoot)) {
  throw 'PTY dependency capability harness did not cleanly complete'
}
$summary | ConvertTo-Json -Compress -Depth 12
