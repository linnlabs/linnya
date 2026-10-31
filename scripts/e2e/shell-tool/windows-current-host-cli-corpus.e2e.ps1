param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$RunRoot,
  [Parameter(Mandatory = $true)][string]$InteractiveUser
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$runRoot = [IO.Path]::GetFullPath($RunRoot)
$applicationRoot = Join-Path $runRoot 'application'
$ownerSid = (Get-LocalUser -Name $InteractiveUser).SID.Value
$taskName = 'Linnya-Host-Cli-' + [Guid]::NewGuid().ToString('N')
$isolationOwned = $false
$taskOwned = $false

function Invoke-UserSession {
  param([switch]$CleanupUser)
  $reportPath = Join-Path $runRoot $(if ($CleanupUser) { 'cleanup.json' } else { 'session.json' })
  $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $userScript + '" -RunRoot "' + $runRoot + '"'
  if ($CleanupUser) { $arguments += ' -CleanupUser' }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
  $principal = New-ScheduledTaskPrincipal -UserId $ownerSid -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 9)
  Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
  $script:taskOwned = $true
  Start-ScheduledTask -TaskName $taskName
  $deadline = [DateTime]::UtcNow.AddSeconds(540)
  while (-not (Test-Path -LiteralPath $reportPath)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Interactive fixture timed out; confirm the ordinary test user is logged in' }
    Start-Sleep -Milliseconds 100
  }
  $report = ConvertFrom-Json ([IO.File]::ReadAllText($reportPath, [Text.Encoding]::UTF8))
  if (-not $report.success) { throw $report.error }
  return $report
}

try {
  # SSH 只负责管理测试服务。产品必须在普通用户已登录的桌面会话执行，不能以 Session 0 冒充用户验收。
  if (Test-Path -LiteralPath "HKLM:\SOFTWARE\Linnlabs\CommandIsolation\$ownerSid") {
    throw 'Use a dedicated test user without an existing Linnya isolation installation'
  }
  New-Item -ItemType Directory -Path $applicationRoot -Force | Out-Null
  & icacls.exe $runRoot /grant "*$($ownerSid):(OI)(CI)M" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not grant the fixture user access to its run directory' }
  tar.exe -xzf $ArchivePath -C $applicationRoot
  if ($LASTEXITCODE -ne 0) { throw 'Fixture extraction failed' }
  $unpackedRoot = Join-Path $applicationRoot 'win-unpacked'
  $isolationHelper = Join-Path $unpackedRoot 'resources\command-runtime\windows\x64\linnyaCommandIsolation.exe'
  $userScript = Join-Path $unpackedRoot 'resources\user-session.ps1'
  $isolationOwned = $true
  & $isolationHelper install $ownerSid
  if ($LASTEXITCODE -ne 0) { throw 'Fixture isolation installation failed' }
  $report = Invoke-UserSession
  $result = $report.result
  $result | Add-Member -NotePropertyName appProcessId -NotePropertyValue $report.appProcessId
  $result | ConvertTo-Json -Depth 12 -Compress
} finally {
  if ($taskOwned) { Stop-ScheduledTask -TaskName $taskName }
  try {
    if ($isolationOwned) {
      & $isolationHelper uninstall $ownerSid
      if ($LASTEXITCODE -ne 0) { throw 'Fixture isolation uninstall failed' }
      Invoke-UserSession -CleanupUser | Out-Null
    }
  } catch {
    # 保留恢复工具与用户日志，外层清理不能抹去失败证据。
    [IO.File]::WriteAllText((Join-Path $runRoot 'recovery-required'), 'Isolation cleanup incomplete')
    throw
  } finally {
    if ($taskOwned) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
  }
}
