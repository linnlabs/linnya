param(
  [Parameter(Mandatory = $true)]
  [string]$RunToken,
  [Parameter(Mandatory = $true)]
  [string]$IdentityPath
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$identity = [ordered]@{
  version = 1
  runToken = $RunToken
  pid = $PID
}
$pendingIdentityPath = $IdentityPath + '.' + $PID + '.pending'
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($IdentityPath)) | Out-Null
[IO.File]::WriteAllText(
  $pendingIdentityPath,
  ($identity | ConvertTo-Json -Compress),
  (New-Object Text.UTF8Encoding($false)))
[IO.File]::Move($pendingIdentityPath, $IdentityPath)

# 明确晚于 shell 的 250ms initial wait，防止快速机器把异步启动偶然性写成合同。
Start-Sleep -Milliseconds 350
[Console]::Write("PTY_READY:true:true`r`nPTY_PROMPT> ")

while ($true) {
  $line = [Console]::ReadLine()
  if ($null -eq $line) {
    [Console]::Write('PTY_EOF_RECEIVED_STILL_RUNNING')
    while ($true) { Start-Sleep -Seconds 1 }
  }
  if ($line -eq 'size') {
    [Console]::Write(("PTY_SIZE:{0}x{1}" -f [Console]::WindowWidth, [Console]::WindowHeight))
    continue
  }
  [Console]::Write(('SUBMIT_OK:' + $line))
}
