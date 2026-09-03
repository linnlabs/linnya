param(
  [string]$NodeExecutable,
  [Parameter(Mandatory = $true)][string]$FixtureMainPath,
  [Parameter(Mandatory = $true)][string]$InstallerIncludePath,
  [Parameter(Mandatory = $true)][string]$RunRoot,
  [Parameter(Mandatory = $true)][string]$ExpectedElectronVersion,
  [switch]$CleanupOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$productName = 'Linnya NSIS Lifecycle Fixture'
$versionOne = '1.0.0'
$versionTwo = '1.0.1'
$runRoot = [IO.Path]::GetFullPath($RunRoot)
$projectRoot = Join-Path $runRoot 'builder'
$outputRoot = Join-Path $runRoot 'output'
$installRoot = Join-Path $runRoot 'installed\LinnyaNsisFixture'
$applicationPath = Join-Path $installRoot "$productName.exe"
$markerPath = Join-Path $installRoot 'resources\validation-marker.txt'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$productName.lnk"
$startMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$productName.lnk"
$uninstallRegistryRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$npmCli = ''
$electronBuilderCli = Join-Path $projectRoot 'node_modules\electron-builder\out\cli\cli.js'
$projectMainPath = Join-Path $projectRoot 'main.mjs'
$projectMarkerPath = Join-Path $projectRoot 'marker.txt'
$projectPackagePath = Join-Path $projectRoot 'package.json'
$projectInstallerIncludePath = Join-Path $projectRoot 'installer.nsh'
$knownRegistryKeys = @()

function Assert-Condition {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Invoke-BoundedProcess {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [int]$TimeoutMilliseconds = 120000
  )
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = ($Arguments -join ' ')
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) { throw "failed to start process: $FilePath" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  try {
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
      $process.Kill()
      $process.WaitForExit()
      throw "process timed out after $TimeoutMilliseconds ms: $FilePath"
    }
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      $diagnostic = ($stderr + [Environment]::NewLine + $stdout)
      if ($diagnostic.Length -gt 12000) { $diagnostic = $diagnostic.Substring($diagnostic.Length - 12000) }
      throw "process failed with exit code $($process.ExitCode): $FilePath`n$diagnostic"
    }
    return [pscustomobject]@{
      ProcessId = [int]$process.Id
      Stdout = $stdout
      Stderr = $stderr
    }
  } finally {
    $process.Dispose()
  }
}

function Write-FixturePackage {
  param([string]$Version, [string]$Marker)
  $manifest = [ordered]@{
    name = 'linnya-nsis-current-user-lifecycle-fixture'
    version = $Version
    private = $true
    type = 'module'
    main = 'main.mjs'
    devDependencies = [ordered]@{
      electron = $ExpectedElectronVersion
      'electron-builder' = '26.0.13'
    }
    build = [ordered]@{
      appId = 'com.linnya.validation.nsis-current-user-lifecycle'
      productName = $productName
      asar = $true
      files = @('main.mjs', 'package.json')
      extraResources = @([ordered]@{ from = 'marker.txt'; to = 'validation-marker.txt' })
      directories = [ordered]@{ output = $outputRoot }
      win = [ordered]@{
        target = @([ordered]@{ target = 'nsis'; arch = @('x64') })
        signAndEditExecutable = $false
      }
      nsis = [ordered]@{
        oneClick = $true
        perMachine = $false
        allowElevation = $false
        allowToChangeInstallationDirectory = $false
        createDesktopShortcut = $true
        createStartMenuShortcut = $true
        runAfterFinish = $false
        artifactName = 'linnya-nsis-lifecycle-' + $Version + '.${ext}'
        include = $projectInstallerIncludePath
      }
    }
  }
  [IO.File]::WriteAllText(
    $projectPackagePath,
    ($manifest | ConvertTo-Json -Depth 10),
    (New-Object Text.UTF8Encoding($false))
  )
  [IO.File]::WriteAllText($projectMarkerPath, "$Marker`n", (New-Object Text.UTF8Encoding($false)))
}

function Find-UninstallEntries {
  param([string]$ExpectedInstallRoot)
  if (-not (Test-Path -LiteralPath $uninstallRegistryRoot)) { return @() }
  $matches = @()
  foreach ($key in Get-ChildItem -LiteralPath $uninstallRegistryRoot) {
    $properties = Get-ItemProperty -LiteralPath $key.PSPath
    $installRegistryPath = "HKCU:\Software\$($key.PSChildName)"
    if (Test-Path -LiteralPath $installRegistryPath) {
      $installProperties = Get-ItemProperty -LiteralPath $installRegistryPath
      if ([string]$installProperties.InstallLocation -eq $ExpectedInstallRoot) {
        $matches += [pscustomobject]@{
          Key = $key
          Properties = $properties
          InstallProperties = $installProperties
        }
      }
    }
  }
  return @($matches)
}

function Find-FixtureIdentityEntries {
  if (-not (Test-Path -LiteralPath $uninstallRegistryRoot)) { return @() }
  $matches = @()
  foreach ($key in Get-ChildItem -LiteralPath $uninstallRegistryRoot) {
    $properties = Get-ItemProperty -LiteralPath $key.PSPath
    if ([string]$properties.DisplayName -like "$productName *") {
      $matches += [pscustomobject]@{
        Key = $key
        InstallRegistryPath = "HKCU:\Software\$($key.PSChildName)"
      }
    }
  }
  return @($matches)
}

function Wait-InstalledCommit {
  param(
    [string]$ExpectedVersion,
    [string]$ExpectedMarker,
    [int]$TimeoutMilliseconds = 30000
  )
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $entries = @(Find-UninstallEntries -ExpectedInstallRoot $installRoot)
    if ($entries.Count -eq 1) {
      $entry = $entries[0]
      $installLocation = if ($null -eq $entry.InstallProperties) {
        ''
      } else {
        [string]$entry.InstallProperties.InstallLocation
      }
      $markerExists = Test-Path -LiteralPath $markerPath -PathType Leaf
      $markerMatches = $false
      if ($markerExists) {
        $markerMatches = [IO.File]::ReadAllText($markerPath).Trim() -eq $ExpectedMarker
      }
      $installLocationMatches = $installLocation -eq $installRoot
      $versionMatches = [string]$entry.Properties.DisplayVersion -eq $ExpectedVersion
      $applicationExists = Test-Path -LiteralPath $applicationPath -PathType Leaf
      $desktopShortcutExists = Test-Path -LiteralPath $desktopShortcut -PathType Leaf
      $startMenuShortcutExists = Test-Path -LiteralPath $startMenuShortcut -PathType Leaf
      $commitObserved = $installLocationMatches -and $versionMatches -and $applicationExists -and $markerMatches -and $desktopShortcutExists -and $startMenuShortcutExists
      if ($commitObserved) {
        return
      }
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "installer transaction did not commit within $TimeoutMilliseconds ms"
    }
    Start-Sleep -Milliseconds 50
  } while ($true)
}

function Read-InstalledState {
  param([string]$ExpectedVersion, [string]$ExpectedMarker)
  $entries = @(Find-UninstallEntries -ExpectedInstallRoot $installRoot)
  Assert-Condition ($entries.Count -eq 1) "expected one HKCU uninstall entry, got $($entries.Count)"
  $entry = $entries[0]
  $properties = $entry.Properties
  $script:knownRegistryKeys = @($knownRegistryKeys + [string]$entry.Key.PSChildName | Select-Object -Unique)
  $installRegistryPath = "HKCU:\Software\$($entry.Key.PSChildName)"
  Assert-Condition ($null -ne $entry.InstallProperties) 'install registry was not committed'
  Assert-Condition ([string]$entry.InstallProperties.InstallLocation -eq $installRoot) 'one-click /D install root was not honored'
  Assert-Condition ([string]$properties.DisplayName -eq "$productName $ExpectedVersion") 'DisplayName mismatch'
  Assert-Condition ([string]$properties.DisplayVersion -eq $ExpectedVersion) 'DisplayVersion mismatch'
  Assert-Condition (Test-Path -LiteralPath $applicationPath -PathType Leaf) 'installed application is missing'
  Assert-Condition (Test-Path -LiteralPath $markerPath -PathType Leaf) 'installed marker is missing'
  Assert-Condition ([IO.File]::ReadAllText($markerPath).Trim() -eq $ExpectedMarker) 'installed marker mismatch'
  Assert-Condition (Test-Path -LiteralPath $desktopShortcut -PathType Leaf) 'desktop shortcut is missing'
  Assert-Condition (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf) 'start menu shortcut is missing'

  $uninstallString = [string]$properties.UninstallString
  $quietUninstallString = [string]$properties.QuietUninstallString
  $uninstallMatch = [regex]::Match($uninstallString, '^"([^"]+)" /currentuser$')
  Assert-Condition $uninstallMatch.Success 'UninstallString is not current-user scoped'
  Assert-Condition ($quietUninstallString -eq ('"' + $uninstallMatch.Groups[1].Value + '" /currentuser /S')) 'QuietUninstallString mismatch'
  Assert-Condition (Test-Path -LiteralPath $uninstallMatch.Groups[1].Value -PathType Leaf) 'uninstaller is missing'
  return [pscustomobject]@{
    RegistryKeyName = [string]$entry.Key.PSChildName
    UninstallerPath = $uninstallMatch.Groups[1].Value
    QuietUninstallString = $quietUninstallString
  }
}

function Get-FixtureProcessCount {
  $count = 0
  foreach ($candidate in Get-Process -ErrorAction SilentlyContinue) {
    try {
      if ([string]$candidate.Path -eq $applicationPath) { $count++ }
    } catch [System.ComponentModel.Win32Exception] {
    }
  }
  return $count
}

function Get-RemovalFacts {
  $remainingPaths = @()
  if (Test-Path -LiteralPath $installRoot) {
    $remainingPaths = @(
      Get-ChildItem -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
    )
  }
  $relatedProcesses = @()
  foreach ($candidate in Get-Process -ErrorAction SilentlyContinue) {
    try {
      if ([string]$candidate.Path -like "$runRoot*") {
        $relatedProcesses += [pscustomobject]@{
          ProcessId = [int]$candidate.Id
          Name = [string]$candidate.ProcessName
          Path = [string]$candidate.Path
        }
      }
    } catch [System.ComponentModel.Win32Exception] {
    }
  }
  return [ordered]@{
    installRootExists = [int](Test-Path -LiteralPath $installRoot)
    remainingPaths = $remainingPaths
    uninstallEntries = @(Find-FixtureIdentityEntries).Count
    desktopShortcut = [int](Test-Path -LiteralPath $desktopShortcut)
    startMenuShortcut = [int](Test-Path -LiteralPath $startMenuShortcut)
    relatedProcesses = $relatedProcesses
  }
}

function Wait-UninstalledCommit {
  param([string]$RegistryKeyName, [int]$TimeoutMilliseconds = 30000)
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $installRootExists = Test-Path -LiteralPath $installRoot
    $uninstallEntryExists = Test-Path -LiteralPath "$uninstallRegistryRoot\$RegistryKeyName"
    $installRegistryExists = Test-Path -LiteralPath "HKCU:\Software\$RegistryKeyName"
    $desktopShortcutExists = Test-Path -LiteralPath $desktopShortcut
    $startMenuShortcutExists = Test-Path -LiteralPath $startMenuShortcut
    $appProcessCount = Get-FixtureProcessCount
    $commitObserved = -not $installRootExists -and -not $uninstallEntryExists -and -not $installRegistryExists -and -not $desktopShortcutExists -and -not $startMenuShortcutExists -and $appProcessCount -eq 0
    if ($commitObserved) { return }
    if ([DateTime]::UtcNow -ge $deadline) {
      $facts = Get-RemovalFacts
      throw "uninstaller transaction did not commit; facts=$($facts | ConvertTo-Json -Depth 5 -Compress)"
    }
    Start-Sleep -Milliseconds 50
  } while ($true)
}

function Remove-FixtureResidue {
  foreach ($candidate in Get-Process -ErrorAction SilentlyContinue) {
    try {
      if ([string]$candidate.Path -eq $applicationPath) {
        Stop-Process -Id $candidate.Id -Force -ErrorAction SilentlyContinue
      }
    } catch [System.ComponentModel.Win32Exception] {
    }
  }
  Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $startMenuShortcut -Force -ErrorAction SilentlyContinue
  foreach ($entry in @(Find-UninstallEntries -ExpectedInstallRoot $installRoot)) {
    $script:knownRegistryKeys = @($knownRegistryKeys + [string]$entry.Key.PSChildName | Select-Object -Unique)
    Remove-Item -LiteralPath $entry.Key.PSPath -Recurse -Force -ErrorAction SilentlyContinue
  }
  # 外层安装器提前返回时，安装位置字段可能尚未写入。清理按夹具自身
  # 的产品身份捕捉中间态；正常读取仍只接受完整的 InstallLocation (PowerShell 5).
  foreach ($entry in @(Find-FixtureIdentityEntries)) {
    Remove-Item -LiteralPath $entry.InstallRegistryPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $entry.Key.PSPath -Recurse -Force -ErrorAction SilentlyContinue
  }
  foreach ($keyName in $knownRegistryKeys) {
    Remove-Item -LiteralPath "HKCU:\Software\$keyName" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "$uninstallRegistryRoot\$keyName" -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($CleanupOnly) {
  Remove-FixtureResidue
  Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $FixtureMainPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallerIncludePath -Force -ErrorAction SilentlyContinue

  # Keep the SSH command short by running cleanup inside the uploaded controller.
  $controllerPath = [IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
  Remove-Item -LiteralPath $controllerPath -Force -ErrorAction SilentlyContinue
  $cleanupFacts = [ordered]@{
    runRoot = [int](Test-Path -LiteralPath $runRoot)
    installRoot = [int](Test-Path -LiteralPath $installRoot)
    controller = [int](Test-Path -LiteralPath $controllerPath)
    fixtureMain = [int](Test-Path -LiteralPath $FixtureMainPath)
    installerInclude = [int](Test-Path -LiteralPath $InstallerIncludePath)
    uninstallEntries = @(Find-FixtureIdentityEntries).Count
    desktopShortcut = [int](Test-Path -LiteralPath $desktopShortcut)
    startMenuShortcut = [int](Test-Path -LiteralPath $startMenuShortcut)
    appProcess = Get-FixtureProcessCount
  }
  Assert-Condition (-not ($cleanupFacts.Values | Where-Object { $_ -ne 0 })) (
    'NSIS remote cleanup failed: ' + ($cleanupFacts | ConvertTo-Json -Compress)
  )
  $cleanupFacts | ConvertTo-Json -Compress
  exit 0
}

$completed = $false
try {
  $windowsIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $windowsPrincipal = New-Object Security.Principal.WindowsPrincipal($windowsIdentity)
  $isAdministrator = $windowsPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  Assert-Condition (-not $isAdministrator) 'fixture must run as a standard Windows user'
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($NodeExecutable)) 'configured Windows node.exe is required'
  $nodeDirectory = Split-Path -Parent $NodeExecutable
  $npmCli = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
  Assert-Condition (Test-Path -LiteralPath $NodeExecutable -PathType Leaf) 'configured Windows node.exe is missing'
  Assert-Condition (Test-Path -LiteralPath $npmCli -PathType Leaf) 'npm-cli.js beside configured node.exe is missing'
  Assert-Condition (Test-Path -LiteralPath $FixtureMainPath -PathType Leaf) 'uploaded fixture main is missing'
  Assert-Condition (Test-Path -LiteralPath $InstallerIncludePath -PathType Leaf) 'uploaded production NSIS include is missing'
  Assert-Condition (-not (Test-Path -LiteralPath $installRoot)) 'fixture install root must be absent before install'
  Assert-Condition (@(Find-UninstallEntries -ExpectedInstallRoot $installRoot).Count -eq 0) 'fixture registry must be absent before install'
  # npm lifecycle scripts invoke "node" by name, even when npm-cli.js was started
  # through an absolute node.exe path. Scope this PATH change to the controller tree.
  $env:PATH = "$nodeDirectory;$env:PATH"
  New-Item -ItemType Directory -Path $projectRoot -Force | Out-Null
  Copy-Item -LiteralPath $FixtureMainPath -Destination $projectMainPath -Force
  Copy-Item -LiteralPath $InstallerIncludePath -Destination $projectInstallerIncludePath -Force

  Write-FixturePackage -Version $versionOne -Marker 'marker-version-one'
  $dependencyInstall = Invoke-BoundedProcess -FilePath $NodeExecutable -Arguments @(
    $npmCli, 'install', '--no-audit', '--no-fund'
  ) -WorkingDirectory $projectRoot -TimeoutMilliseconds 600000
  Assert-Condition (Test-Path -LiteralPath $electronBuilderCli -PathType Leaf) 'electron-builder CLI was not installed'

  $versionOneBuild = Invoke-BoundedProcess -FilePath $NodeExecutable -Arguments @(
    $electronBuilderCli, '--projectDir', $projectRoot, '--win', 'nsis', '--x64', '--config.npmRebuild=false'
  ) -WorkingDirectory $projectRoot -TimeoutMilliseconds 300000
  $versionOneInstaller = Join-Path $outputRoot 'linnya-nsis-lifecycle-1.0.0.exe'
  Assert-Condition (Test-Path -LiteralPath $versionOneInstaller -PathType Leaf) 'version one installer is missing'

  Write-FixturePackage -Version $versionTwo -Marker 'marker-version-two'
  $versionTwoBuild = Invoke-BoundedProcess -FilePath $NodeExecutable -Arguments @(
    $electronBuilderCli, '--projectDir', $projectRoot, '--win', 'nsis', '--x64', '--config.npmRebuild=false'
  ) -WorkingDirectory $projectRoot -TimeoutMilliseconds 300000
  $versionTwoInstaller = Join-Path $outputRoot 'linnya-nsis-lifecycle-1.0.1.exe'
  Assert-Condition (Test-Path -LiteralPath $versionTwoInstaller -PathType Leaf) 'version two installer is missing'

  # electron-builder 26 parses /D in the one-click per-user template. Registry
  # assertions below prove that the isolated installation path was honored.
  $versionOneInstall = Invoke-BoundedProcess -FilePath $versionOneInstaller -Arguments @(
    '/S', '/currentuser', "/D=$installRoot"
  ) -WorkingDirectory $runRoot
  # one-click 安装器是启动器；它退出后，内部安装事务仍可能短暂运行 (observed).
  # 以版本、文件、注册表和快捷方式同时就绪作为提交信号，不能靠固定等待猜时间 (commit).
  Wait-InstalledCommit -ExpectedVersion $versionOne -ExpectedMarker 'marker-version-one'
  $stateOne = Read-InstalledState -ExpectedVersion $versionOne -ExpectedMarker 'marker-version-one'
  $processCountAfterInstall = Get-FixtureProcessCount
  Assert-Condition ($processCountAfterInstall -eq 0) 'fixture application started during silent install'

  $versionTwoInstall = Invoke-BoundedProcess -FilePath $versionTwoInstaller -Arguments @(
    '/S', '/currentuser', "/D=$installRoot"
  ) -WorkingDirectory $runRoot
  Wait-InstalledCommit -ExpectedVersion $versionTwo -ExpectedMarker 'marker-version-two'
  $stateTwo = Read-InstalledState -ExpectedVersion $versionTwo -ExpectedMarker 'marker-version-two'
  Assert-Condition ($stateTwo.RegistryKeyName -eq $stateOne.RegistryKeyName) 'upgrade changed registry identity'
  Assert-Condition ($stateTwo.UninstallerPath -eq $stateOne.UninstallerPath) 'upgrade changed uninstaller location'
  $processCountAfterUpgrade = Get-FixtureProcessCount
  Assert-Condition ($processCountAfterUpgrade -eq 0) 'fixture application started during silent upgrade'

  $uninstall = Invoke-BoundedProcess -FilePath $stateTwo.UninstallerPath -Arguments @(
    '/currentuser', '/S'
  ) -WorkingDirectory $runRoot
  Wait-UninstalledCommit -RegistryKeyName $stateTwo.RegistryKeyName
  Assert-Condition (@(Find-UninstallEntries -ExpectedInstallRoot $installRoot).Count -eq 0) 'uninstall entry remains after uninstall'
  Assert-Condition (-not (Test-Path -LiteralPath "HKCU:\Software\$($stateTwo.RegistryKeyName)")) 'install registry remains after uninstall'
  Assert-Condition (-not (Test-Path -LiteralPath $desktopShortcut)) 'desktop shortcut remains after uninstall'
  Assert-Condition (-not (Test-Path -LiteralPath $startMenuShortcut)) 'start menu shortcut remains after uninstall'
  $processCountAfterUninstall = Get-FixtureProcessCount
  Assert-Condition ($processCountAfterUninstall -eq 0) 'fixture application remains after uninstall'

  $completed = $true
  [ordered]@{
    success = $true
    isAdministrator = $isAdministrator
    productName = $productName
    installRoot = $installRoot
    registryKeyName = $stateTwo.RegistryKeyName
    versionOne = $versionOne
    versionTwo = $versionTwo
    dependencyInstallPid = $dependencyInstall.ProcessId
    versionOneBuildPid = $versionOneBuild.ProcessId
    versionTwoBuildPid = $versionTwoBuild.ProcessId
    versionOneInstallerPid = $versionOneInstall.ProcessId
    versionTwoInstallerPid = $versionTwoInstall.ProcessId
    uninstallerPid = $uninstall.ProcessId
    quietUninstallString = $stateTwo.QuietUninstallString
    processCounts = @($processCountAfterInstall, $processCountAfterUpgrade, $processCountAfterUninstall)
    desktopShortcutObserved = $true
    startMenuShortcutObserved = $true
    finalInstallRootExists = [int](Test-Path -LiteralPath $installRoot)
    finalUninstallEntryCount = @(Find-UninstallEntries -ExpectedInstallRoot $installRoot).Count
  } | ConvertTo-Json -Depth 5 -Compress
} finally {
  if (-not $completed) { Remove-FixtureResidue }
}
