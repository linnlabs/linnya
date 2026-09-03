param(
  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectoryName,

  [Parameter(Mandatory = $true)]
  [string]$RunToken,

  [Parameter(Mandatory = $true)]
  [ValidateSet('parent', 'child', 'grandchild')]
  [string]$Role
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class LinnyaFixtureProcessIdentity
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasicInformation
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int processInformationClass,
        out ProcessBasicInformation processInformation,
        int processInformationLength,
        out int returnLength);

    public static int ReadCurrentParentProcessId()
    {
        ProcessBasicInformation information;
        int returnLength;
        using (Process process = Process.GetCurrentProcess())
        {
            int status = NtQueryInformationProcess(
                process.Handle,
                0,
                out information,
                Marshal.SizeOf(typeof(ProcessBasicInformation)),
                out returnLength);
            if (status != 0)
            {
                throw new InvalidOperationException("NtQueryInformationProcess failed: " + status);
            }
        }
        return information.InheritedFromUniqueProcessId.ToInt32();
    }
}
'@

if ($EvidenceDirectoryName -notmatch '^[A-Za-z0-9_-]+$') {
  throw 'evidence directory must be one safe relative segment'
}
if ($RunToken -notmatch '^[A-Za-z0-9_-]+$') {
  throw 'run token contains unsupported characters'
}

$evidenceRoot = Join-Path ([Environment]::CurrentDirectory) $EvidenceDirectoryName
$evidenceRoot = [IO.Path]::GetFullPath($evidenceRoot)
$currentDirectory = [IO.Path]::GetFullPath([Environment]::CurrentDirectory).TrimEnd('\')
if (-not $evidenceRoot.StartsWith($currentDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'evidence directory escaped the command working directory'
}
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null

function Quote-ProcessArgument {
  param([string]$Value)
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Start-Descendant {
  param([string]$DescendantRole)

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = Join-Path $PSHOME 'powershell.exe'
  $startInfo.WorkingDirectory = $currentDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.Arguments = @(
    '-NoLogo'
    '-NoProfile'
    '-NonInteractive'
    '-ExecutionPolicy'
    'Bypass'
    '-File'
    (Quote-ProcessArgument -Value $PSCommandPath)
    '-EvidenceDirectoryName'
    (Quote-ProcessArgument -Value $EvidenceDirectoryName)
    '-RunToken'
    (Quote-ProcessArgument -Value $RunToken)
    '-Role'
    $DescendantRole
  ) -join ' '
  $descendant = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $descendant) { throw "failed to start $DescendantRole" }
  $descendant.Dispose()
}

if ($Role -eq 'parent') {
  Start-Descendant -DescendantRole 'child'
} elseif ($Role -eq 'child') {
  Start-Descendant -DescendantRole 'grandchild'
}

$identityPath = Join-Path $evidenceRoot ($Role + '.json')
$pendingIdentityPath = $identityPath + '.' + $PID + '.pending'
$identity = [ordered]@{
  version = 1
  runToken = $RunToken
  role = $Role
  pid = $PID
  parentPid = [LinnyaFixtureProcessIdentity]::ReadCurrentParentProcessId()
}
$identityJson = $identity | ConvertTo-Json -Compress
[IO.File]::WriteAllText($pendingIdentityPath, $identityJson, (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $pendingIdentityPath -Destination $identityPath

if ($Role -eq 'parent') {
  [Console]::Out.WriteLine('production-agent-parent-start')
}

$heartbeatPath = Join-Path $evidenceRoot ($Role + '.heartbeat.log')
$utf8 = New-Object Text.UTF8Encoding($false)
$sequence = 0
while ($true) {
  $sequence += 1
  $line = $RunToken + "`t" + $Role + "`t" + $PID + "`t" + $sequence + "`t" + [DateTime]::UtcNow.Ticks + "`n"
  [IO.File]::AppendAllText($heartbeatPath, $line, $utf8)
  if ($Role -eq 'parent' -and $sequence -eq 10) {
    [Console]::Out.WriteLine('production-agent-parent-tick-' + $sequence)
    [Console]::Out.WriteLine('interaction-request: enter value >')
    if ([Console]::In.Read() -eq -1) {
      [Console]::Out.WriteLine('interaction-stdin:eof')
    } else {
      [Console]::Out.WriteLine('interaction-stdin:received')
    }
  }
  Start-Sleep -Milliseconds 50
}
