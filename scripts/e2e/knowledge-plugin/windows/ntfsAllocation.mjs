import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// 不用产品的 Node stat.blocks 做对照：通过 Windows 文件句柄独立查询实际分配空间，
// 包括稀疏文件和目录；同时记录逻辑长度，防止把文件长度当成磁盘占用。
const allocationScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class NtfsAcceptance {
    [StructLayout(LayoutKind.Sequential)]
    public struct StandardInfo {
        public long AllocationSize;
        public long EndOfFile;
        public uint NumberOfLinks;
        public byte DeletePending;
        public byte Directory;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind,
        out StandardInfo result, uint resultSize);

    public static long AllocatedBytes(string path) {
        using (SafeFileHandle file = CreateFile(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
            if (file.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), path);
            StandardInfo info;
            if (!GetFileInformationByHandleEx(file, 1, out info, (uint)Marshal.SizeOf(typeof(StandardInfo))))
                throw new Win32Exception(Marshal.GetLastWin32Error(), path);
            return info.AllocationSize;
        }
    }
}
'@
$drive = New-Object System.IO.DriveInfo([IO.Path]::GetPathRoot($root))
if ($drive.DriveFormat -ne 'NTFS') { throw 'The allocation acceptance requires an NTFS volume' }
$bytes = @{ source = [long]0; derived = [long]0; runtime = [long]0 }
$length = @{ source = [long]0; derived = [long]0; runtime = [long]0 }
$directoryBytes = @{ source = [long]0; derived = [long]0; runtime = [long]0 }
$storage = Join-Path $root 'qdrant\storage'
foreach ($name in @('source_of_truth', 'originals', 'qdrant', 'temporary', 'diagnostics')) {
    $directory = Join-Path $root $name
    if (!(Test-Path -LiteralPath $directory)) { continue }
    $entries = @(Get-Item -LiteralPath $directory -Force) + @(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    foreach ($entry in $entries) {
        $category = switch ($name) {
            { $_ -in @('source_of_truth', 'originals') } { 'source'; break }
            'qdrant' {
                if ($entry.FullName -eq $storage -or $entry.FullName.StartsWith($storage + '\', [StringComparison]::OrdinalIgnoreCase)) { 'derived' }
                else { 'runtime' }
                break
            }
            default { 'runtime' }
        }
        $allocated = [NtfsAcceptance]::AllocatedBytes($entry.FullName)
        $bytes[$category] += $allocated
        if ($entry.PSIsContainer) { $directoryBytes[$category] += $allocated }
        else { $length[$category] += $entry.Length }
    }
}
@{ filesystem = $drive.DriveFormat; bytes = $bytes; logicalBytes = $length; directoryBytes = $directoryBytes } | ConvertTo-Json -Compress
`;

export async function readNtfsAllocation(root) {
  assert.equal(process.platform, 'win32');
  const command = `$root = '${root.replaceAll("'", "''")}'\n${allocationScript}`;
  const { stdout } = await execute(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, timeout: 45_000 }
  );
  const allocation = JSON.parse(stdout);
  assert.equal(allocation.filesystem, 'NTFS');
  return {
    ...allocation,
    total: Object.values(allocation.bytes).reduce((sum, size) => sum + size, 0),
  };
}
