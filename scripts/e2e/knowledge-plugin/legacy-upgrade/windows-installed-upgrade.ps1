param(
  [Parameter(Mandatory = $true)][string]$RunRoot,
  [Parameter(Mandatory = $true)][string]$LegacyInstaller,
  [Parameter(Mandatory = $true)][string]$LegacyVersion,
  [Parameter(Mandatory = $true)][string]$CandidateInstaller,
  [Parameter(Mandatory = $true)][string]$CandidateVersion
)
# Windows 旧版升级验收：在没有安装过 Linnya 的普通用户桌面会话里安装已发布旧版，留下真实旧资料，
# 用候选安装包原地覆盖安装（与应用内更新执行的 NSIS 升级相同），再用升级后的 App 打开旧资料，最后卸载。
# 只用 RunRoot 里的隔离 profile 与 Workspace。结果写入 RunRoot\upgrade-session.json；失败时保留安装与资料。
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$utf8 = New-Object Text.UTF8Encoding($false)
$report = [ordered]@{ status = 'failed'; steps = @(); error = $null }
$registryRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$productName = -join @([char]0x6797, [char]0x82BD)
$installRoot = Join-Path $RunRoot 'installed'
$executable = Join-Path $installRoot "$productName.exe"

function Find-Installed {
  if (-not (Test-Path -LiteralPath $registryRoot)) { return @() }
  return @(Get-ChildItem -LiteralPath $registryRoot | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
    Where-Object { [string]$_.DisplayName -like "$productName *" })
}
function Invoke-Installer([string]$File, [string]$Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $RunRoot -PassThru
  if (-not $process.WaitForExit(600000)) { throw "Installer did not exit: $File" }
  if ($process.ExitCode -ne 0) { throw "Installer failed ($($process.ExitCode)): $File" }
}
function Wait-Version([string]$Version) {
  $deadline = [DateTime]::UtcNow.AddSeconds(300)
  do {
    $entries = @(Find-Installed)
    if ($entries.Count -eq 1 -and $entries[0].DisplayVersion -eq $Version -and (Test-Path -LiteralPath $executable)) { return }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Installation did not commit version $Version"
}
function Invoke-Node([string]$Label, [string[]]$Arguments) {
  $quoted = $Arguments | ForEach-Object { '"' + $_ + '"' }
  $process = Start-Process -FilePath $node -ArgumentList $quoted -WorkingDirectory $RunRoot -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput (Join-Path $RunRoot "$Label.stdout.log") -RedirectStandardError (Join-Path $RunRoot "$Label.stderr.log")
  if ($process.ExitCode -ne 0) { throw "$Label failed ($($process.ExitCode))" }
}
function Complete-Step([string]$Name) { $script:report.steps += $Name }

try {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or (Get-Process -Id $PID).SessionId -eq 0) {
    throw 'Run in an ordinary user interactive desktop session'
  }
  if (@(Find-Installed).Count -ne 0) { throw 'Linnya is already installed for this user' }

  Invoke-Installer $LegacyInstaller "/S /currentuser /D=$installRoot"
  Wait-Version $LegacyVersion
  # 验收用的 Node 取自旧版安装包并放在安装目录外，覆盖安装时不占用安装目录。
  $nodeDirectory = Join-Path $RunRoot 'node'
  Copy-Item -LiteralPath (Join-Path $installRoot 'resources\headless-node-runtime\win32\x64') -Destination $nodeDirectory -Recurse
  $node = Join-Path $nodeDirectory 'node.exe'
  Complete-Step 'legacy-installed'

  $scripts = Join-Path $RunRoot 'scripts\e2e\knowledge-plugin\legacy-upgrade'
  # 0.2.x 的界面没有可用的嵌入模型，真实用户的旧资料最多是空知识库。
  Invoke-Node 'baseline' @((Join-Path $scripts 'build-legacy-baseline.mjs'), '--app', $executable, '--expect-version', $LegacyVersion,
    '--legacy-ingestion', 'none', '--out', (Join-Path $RunRoot 'b'))
  Complete-Step 'legacy-data-created'

  # 与 electron-updater 静默安装传给安装程序的参数一致；旧版自己的卸载登记由安装程序处理。
  Invoke-Installer $CandidateInstaller "--updated /S /D=$installRoot"
  Wait-Version $CandidateVersion
  if (@(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall *.exe').Count -ne 1) { throw 'Upgrade left more than one uninstaller' }
  Complete-Step 'upgraded-in-place'

  Invoke-Node 'upgrade' @((Join-Path $scripts 'installed-upgrade.acceptance.mjs'), '--app', $executable, '--expect-version', $CandidateVersion,
    '--baseline', (Join-Path $RunRoot 'b'), '--out', (Join-Path $RunRoot 'u'))
  Complete-Step 'legacy-data-opened'

  Invoke-Installer (Join-Path $installRoot "Uninstall $productName.exe") '/currentuser /S'
  $deadline = [DateTime]::UtcNow.AddSeconds(360)
  while ((@(Find-Installed).Count -ne 0 -or (Test-Path -LiteralPath $installRoot)) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 500 }
  if (@(Find-Installed).Count -ne 0 -or (Test-Path -LiteralPath $installRoot)) { throw 'Uninstall left the application behind' }
  Complete-Step 'uninstalled'
  $report.status = 'passed'
} catch {
  $report.error = $_.ToString()
} finally {
  [IO.File]::WriteAllText((Join-Path $RunRoot 'upgrade-session.json'), ($report | ConvertTo-Json -Depth 5), $utf8)
}
if ($report.status -ne 'passed') { exit 1 }
