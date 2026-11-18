param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$RunRoot,
  [Parameter(Mandatory = $true)][string]$InteractiveUser,
  [Parameter(Mandatory = $true)][string]$TaskName
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$taskOwned = $false
$report = $null
try {
  $ownerSid = (Get-LocalUser -Name $InteractiveUser).SID.Value
  New-Item -ItemType Directory -Path $RunRoot | Out-Null
  & icacls.exe $RunRoot /grant "*$($ownerSid):(OI)(CI)M" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot grant the ordinary test user access to the isolated run' }
  & tar.exe -xzf $ArchivePath -C $RunRoot
  if ($LASTEXITCODE -ne 0) { throw 'Candidate extraction failed' }
  $script = Join-Path $RunRoot 'user-session.ps1'
  $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script + '" -RunRoot "' + $RunRoot + '"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
  $principal = New-ScheduledTaskPrincipal -UserId $ownerSid -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 22)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings | Out-Null
  $taskOwned = $true
  Start-ScheduledTask -TaskName $TaskName
  $sessionPath = Join-Path $RunRoot 'session.json'
  $deadline = [DateTime]::UtcNow.AddMinutes(21)
  while (-not (Test-Path -LiteralPath $sessionPath)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Ordinary desktop session did not finish the acceptance' }
    Start-Sleep -Milliseconds 200
  }
  $report = ConvertFrom-Json ([IO.File]::ReadAllText($sessionPath, [Text.Encoding]::UTF8))
} catch {
  $report = @{ success = $false; error = $_.Exception.Message }
} finally {
  if ($taskOwned) {
    Stop-ScheduledTask -TaskName $TaskName
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
}
$report | ConvertTo-Json -Depth 12 -Compress
