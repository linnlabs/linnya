param([Parameter(Mandatory = $true)][string]$RunRoot)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$owner = $null
$report = $null
try {
  $sessionId = (Get-Process -Id $PID).SessionId
  if ($sessionId -eq 0) { throw 'The real Desktop acceptance requires the ordinary interactive user session' }
  $node = Join-Path $RunRoot 'win-unpacked\resources\headless-node-runtime\win32\x64\node.exe'
  $scenario = Join-Path $RunRoot 'scenario.mjs'
  # 保持与现有 Windows corpus 相同的 ProcessStartInfo 生命周期，读取真实进程退出码。
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $node
  $start.Arguments = '"' + $scenario + '" "' + $RunRoot + '"'
  $start.WorkingDirectory = $RunRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $owner = [Diagnostics.Process]::Start($start)
  $stdout = $owner.StandardOutput.ReadToEndAsync()
  $stderr = $owner.StandardError.ReadToEndAsync()
  if (-not $owner.WaitForExit(1200000)) { throw 'Windows knowledge scenario timed out' }
  [IO.File]::WriteAllText((Join-Path $RunRoot 'scenario.stdout.log'), $stdout.Result, (New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText((Join-Path $RunRoot 'scenario.stderr.log'), $stderr.Result, (New-Object Text.UTF8Encoding($false)))
  $report = @{ success = $owner.ExitCode -eq 0; exitCode = $owner.ExitCode; sessionId = $sessionId; user = [Environment]::UserName; runnerPid = $owner.Id }
} catch {
  $report = @{ success = $false; error = $_.Exception.Message }
} finally {
  if ($owner -and -not $owner.HasExited) { & taskkill.exe /PID $owner.Id /T /F | Out-Null }
  if ($owner) { $owner.Dispose() }
}
$destination = Join-Path $RunRoot 'session.json'
[IO.File]::WriteAllText("$destination.tmp", ($report | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath "$destination.tmp" -Destination $destination
if (-not $report.success) { exit 1 }
