param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDirectory,
    [Parameter(Mandatory = $true)]
    [string]$RunRoot,
    [Parameter(Mandatory = $true)]
    [string]$RunToken
)

$ErrorActionPreference = 'Stop'
$compileRoot = Join-Path $RunRoot 'compiled'
$suiteRoot = Join-Path $RunRoot 'suite'
$crashRoot = Join-Path $RunRoot 'owner crash'
$recoveryRoot = Join-Path $RunRoot 'recovery'
$probePath = Join-Path $compileRoot 'WindowsJobListProbe.exe'
$readyPath = Join-Path $crashRoot 'atomic-created.txt'
$markerPath = Join-Path $crashRoot 'user-code.marker'
$externalAckPath = Join-Path $crashRoot 'external-observer.ack'
$resultPath = Join-Path $RunRoot 'controller-result.json'
$controllerIdentityPath = Join-Path $RunRoot 'controller-identity.json'
$activeProbeIdentityPath = Join-Path $RunRoot 'active-probe-identity.json'
$ownerProcess = $null
$activeProbeProcess = $null

function Wait-Until {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Condition,
        [Parameter(Mandatory = $true)]
        [string]$Description,
        [int]$TimeoutMilliseconds = 30000
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 25
    }
    throw "Timed out waiting for $Description (${TimeoutMilliseconds}ms)"
}

function Test-ProcessAlive {
    param([int]$ProcessId)

    try {
        $process = [Diagnostics.Process]::GetProcessById($ProcessId)
        try { return -not $process.HasExited }
        finally { $process.Dispose() }
    }
    catch [ArgumentException] {
        return $false
    }
}

function ConvertTo-WindowsArgument {
    param([AllowEmptyString()][string]$Value)

    $backslash = [char]92
    $doubleQuote = [char]34
    if ($Value.Length -gt 0 -and $Value -notmatch '\s' -and $Value.IndexOf($doubleQuote) -lt 0) { return $Value }
    $result = New-Object Text.StringBuilder
    [void]$result.Append($doubleQuote)
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq $backslash) {
            $backslashes += 1
            continue
        }
        if ($character -eq $doubleQuote) {
            [void]$result.Append($backslash, ($backslashes * 2 + 1))
            [void]$result.Append($doubleQuote)
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$result.Append($backslash, $backslashes)
            $backslashes = 0
        }
        [void]$result.Append($character)
    }
    if ($backslashes -gt 0) { [void]$result.Append($backslash, ($backslashes * 2)) }
    [void]$result.Append($doubleQuote)
    return $result.ToString()
}

function Publish-JsonAtomically {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $pendingPath = $Path + '.pending'
    [IO.File]::WriteAllText($pendingPath, ($Value | ConvertTo-Json -Depth 10 -Compress))
    if (Test-Path -LiteralPath $Path) {
        $backupPath = $Path + '.backup'
        [IO.File]::Replace($pendingPath, $Path, $backupPath)
        [IO.File]::Delete($backupPath)
    }
    else {
        [IO.File]::Move($pendingPath, $Path)
    }
}

function Publish-ProcessIdentity {
    param(
        [Parameter(Mandatory = $true)]
        [Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Role
    )

    Publish-JsonAtomically -Path $Path -Value ([pscustomobject]@{
        version = 1
        runToken = $RunToken
        role = $Role
        processId = $Process.Id
        startTimeUtcTicks = $Process.StartTime.ToUniversalTime().Ticks
    })
}

function Invoke-TrackedProbe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$Role
    )

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $probePath
    $startInfo.Arguments = $Arguments
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Failed to start tracked probe: $Role" }
    $script:activeProbeProcess = $process
    Publish-ProcessIdentity -Process $process -Path $activeProbeIdentityPath -Role $Role
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout = $stdout.GetAwaiter().GetResult()
            Stderr = $stderr.GetAwaiter().GetResult()
        }
    }
    finally {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        $process.Dispose()
        $script:activeProbeProcess = $null
        Remove-Item -LiteralPath $activeProbeIdentityPath -Force -ErrorAction SilentlyContinue
    }
}

try {
    $isAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
    if ($isAdministrator) { throw 'E1 must run as a standard user without an administrator token' }

    New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null
    $controllerProcess = [Diagnostics.Process]::GetCurrentProcess()
    try { Publish-ProcessIdentity -Process $controllerProcess -Path $controllerIdentityPath -Role 'controller' }
    finally { $controllerProcess.Dispose() }
    New-Item -ItemType Directory -Path $compileRoot, $suiteRoot, $crashRoot, $recoveryRoot | Out-Null
    $sources = @(
        (Join-Path $SourceDirectory 'WindowsJobListProbe.cs'),
        (Join-Path $SourceDirectory 'WindowsJobListProbe.Native.cs'),
        (Join-Path $SourceDirectory 'WindowsJobListProbe.Results.cs'),
        (Join-Path $SourceDirectory 'WindowsJobListProbe.Validation.cs')
    )
    Add-Type -Path $sources -ReferencedAssemblies 'System.Web.Extensions.dll' -OutputAssembly $probePath -OutputType ConsoleApplication

    $suiteArguments = @('suite', $suiteRoot) | ForEach-Object { ConvertTo-WindowsArgument $_ }
    $suiteExecution = Invoke-TrackedProbe -Arguments ($suiteArguments -join ' ') -WorkingDirectory $suiteRoot -Role 'native-suite'
    $suiteJson = $suiteExecution.Stdout
    if ($suiteExecution.ExitCode -ne 0) {
        throw "Native E1 suite failed (exit=$($suiteExecution.ExitCode)): $($suiteExecution.Stderr)$suiteJson"
    }
    $suite = $suiteJson | ConvertFrom-Json

    $backslash = [char]92
    $doubleQuote = [char]34
    $expectedArguments = @(
        '',
        'space value',
        (([string][char]0x4e2d) + [char]0x6587),
        ('trailing' + $backslash),
        ('embedded' + $doubleQuote + 'quote')
    )
    $roundTripArguments = @('argv-echo') + $expectedArguments | ForEach-Object { ConvertTo-WindowsArgument $_ }
    $roundTripExecution = Invoke-TrackedProbe -Arguments ($roundTripArguments -join ' ') -WorkingDirectory $suiteRoot -Role 'argument-round-trip'
    $actualArguments = [string[]]($roundTripExecution.Stdout | ConvertFrom-Json)
    $argumentRoundTrip = $roundTripExecution.ExitCode -eq 0 -and $null -eq (Compare-Object $expectedArguments $actualArguments -SyncWindow 0)
    if (-not $argumentRoundTrip) {
        throw "Windows argument round-trip failed: expected=$($expectedArguments | ConvertTo-Json -Compress) actual=$($actualArguments | ConvertTo-Json -Compress)"
    }

    $ownerArguments = @(
        'hold-before-resume',
        $crashRoot,
        $readyPath,
        $markerPath,
        $RunToken
    ) | ForEach-Object { ConvertTo-WindowsArgument $_ }
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $probePath
    $startInfo.Arguments = $ownerArguments -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $ownerProcess = [Diagnostics.Process]::Start($startInfo)
    if ($null -eq $ownerProcess) { throw 'Failed to start suspended owner' }
    Publish-ProcessIdentity -Process $ownerProcess -Path $activeProbeIdentityPath -Role 'suspended-owner'

    Wait-Until -Description 'atomic owner Job evidence' -Condition {
        (Test-Path $readyPath) -and ((Get-Item $readyPath).Length -gt 0)
    }
    Wait-Until -Description 'macOS external observer acknowledgement' -TimeoutMilliseconds 60000 -Condition { Test-Path $externalAckPath }

    $externalAck = Get-Content -Raw $externalAckPath | ConvertFrom-Json
    if ($externalAck.version -ne 1 -or $externalAck.runToken -ne $RunToken -or -not $externalAck.success) {
        throw 'Invalid macOS external observer result'
    }

    Wait-Until -Description 'owner process exit' -Condition { -not (Test-ProcessAlive $ownerProcess.Id) }
    $markerAfterKill = Test-Path $markerPath

    $recoveryResultPath = Join-Path $recoveryRoot 'result.txt'
    $recoveryArguments = @('nested-owner', $recoveryRoot, $recoveryResultPath) | ForEach-Object { ConvertTo-WindowsArgument $_ }
    $recoveryExecution = Invoke-TrackedProbe -Arguments ($recoveryArguments -join ' ') -WorkingDirectory $recoveryRoot -Role 'recovery-owner'
    $recoveryExitCode = $recoveryExecution.ExitCode
    $recoverySucceeded = $recoveryExitCode -eq 31 -and (Test-Path $recoveryResultPath) -and (Get-Content -Raw $recoveryResultPath).Trim() -eq 'true'

    $result = [pscustomobject]@{
        success = [bool]$suite.Success -and -not $isAdministrator -and -not $markerAfterKill -and $recoverySucceeded
        version = 1
        runToken = $RunToken
        platform = [Environment]::OSVersion.Version.ToString()
        architecture = $env:PROCESSOR_ARCHITECTURE
        standardUser = -not $isAdministrator
        argumentRoundTrip = $argumentRoundTrip
        native = $suite
        externalOwnerCrash = $externalAck
        markerAfterOwnerKill = $markerAfterKill
        recoveryAfterOwnerCrash = [pscustomobject]@{
            success = $recoverySucceeded
            exitCode = $recoveryExitCode
        }
        runRoot = $RunRoot
    }
    Publish-JsonAtomically -Path $resultPath -Value $result
    $result | ConvertTo-Json -Depth 10 -Compress
    if (-not $result.success) { exit 1 }
}
finally {
    if ($null -ne $activeProbeProcess) {
        try {
            if (-not $activeProbeProcess.HasExited) { Stop-Process -Id $activeProbeProcess.Id -Force -ErrorAction SilentlyContinue }
        }
        finally {
            $activeProbeProcess.Dispose()
            $activeProbeProcess = $null
        }
    }
    if ($null -ne $ownerProcess) {
        try {
            if (-not $ownerProcess.HasExited) { Stop-Process -Id $ownerProcess.Id -Force -ErrorAction SilentlyContinue }
        }
        finally {
            $ownerProcess.Dispose()
        }
    }
    Remove-Item -LiteralPath $activeProbeIdentityPath -Force -ErrorAction SilentlyContinue
}
