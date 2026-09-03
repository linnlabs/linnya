using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public sealed class WindowsPtyJobProbe : IDisposable
{
    private const uint JobObjectBasicAccountingInformation = 1;
    private const uint JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const int ErrorInsufficientBuffer = 122;
    private static readonly IntPtr ProcThreadAttributeJobList = new IntPtr(0x0002000D);

    private IntPtr handle;

    private WindowsPtyJobProbe(IntPtr handle)
    {
        this.handle = handle;
    }

    public static WindowsPtyJobProbe Create(bool killOnClose)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw LastError("CreateJobObjectW");
        }
        try
        {
            if (killOnClose)
            {
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits =
                    new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
                int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr memory = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(limits, memory, false);
                    if (!SetInformationJobObject(
                        job,
                        JobObjectExtendedLimitInformation,
                        memory,
                        (uint)size))
                    {
                        throw LastError("SetInformationJobObject");
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(memory);
                }
            }
            return new WindowsPtyJobProbe(job);
        }
        catch
        {
            CloseHandle(job);
            throw;
        }
    }

    public void Assign(Process process)
    {
        EnsureOpen();
        if (!AssignProcessToJobObject(handle, process.Handle))
        {
            throw LastError("AssignProcessToJobObject");
        }
    }

    public Process StartProcess(string applicationName, string commandLine, string currentDirectory)
    {
        EnsureOpen();
        UIntPtr attributeBytes = UIntPtr.Zero;
        bool measured = InitializeProcThreadAttributeList(
            IntPtr.Zero,
            1,
            0,
            ref attributeBytes);
        int measurementError = Marshal.GetLastWin32Error();
        if (measured || measurementError != ErrorInsufficientBuffer || attributeBytes == UIntPtr.Zero)
        {
            throw new Win32Exception(
                measurementError,
                "InitializeProcThreadAttributeList(size) returned an invalid contract");
        }

        IntPtr attributes = Marshal.AllocHGlobal(checked((int)attributeBytes.ToUInt64()));
        IntPtr jobValues = IntPtr.Zero;
        bool attributesInitialized = false;
        PROCESS_INFORMATION processInformation = new PROCESS_INFORMATION();
        try
        {
            if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref attributeBytes))
            {
                throw LastError("InitializeProcThreadAttributeList(buffer)");
            }
            attributesInitialized = true;
            jobValues = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobValues, handle);
            if (!UpdateProcThreadAttribute(
                attributes,
                0,
                ProcThreadAttributeJobList,
                jobValues,
                new UIntPtr((uint)IntPtr.Size),
                IntPtr.Zero,
                IntPtr.Zero))
            {
                throw LastError("UpdateProcThreadAttribute(JOB_LIST)");
            }

            STARTUPINFOEX startupInfo = new STARTUPINFOEX();
            startupInfo.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
            startupInfo.lpAttributeList = attributes;
            StringBuilder mutableCommandLine = new StringBuilder(commandLine);
            if (!CreateProcessW(
                applicationName,
                mutableCommandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CreateSuspended | ExtendedStartupInfoPresent | CreateUnicodeEnvironment | CreateNoWindow,
                IntPtr.Zero,
                currentDirectory,
                ref startupInfo,
                out processInformation))
            {
                throw LastError(
                    "CreateProcessW(JOB_LIST, application=" + applicationName
                        + ", cwd=" + currentDirectory + ")");
            }
            bool createdInJob;
            if (!IsProcessInJob(processInformation.hProcess, handle, out createdInJob))
            {
                throw LastError("IsProcessInJob(created runner)");
            }
            if (!createdInJob)
            {
                throw new InvalidOperationException("CreateProcessW returned a runner outside its Job");
            }
            if (ResumeThread(processInformation.hThread) == UInt32.MaxValue)
            {
                throw LastError("ResumeThread(created runner)");
            }
            return Process.GetProcessById(checked((int)processInformation.dwProcessId));
        }
        finally
        {
            if (processInformation.hThread != IntPtr.Zero)
            {
                CloseHandle(processInformation.hThread);
            }
            if (processInformation.hProcess != IntPtr.Zero)
            {
                CloseHandle(processInformation.hProcess);
            }
            if (attributes != IntPtr.Zero)
            {
                // 只有成功初始化的 opaque list 才能交给 Windows 删除；失败时这块内存只是普通 buffer。
                if (attributesInitialized)
                {
                    DeleteProcThreadAttributeList(attributes);
                }
                Marshal.FreeHGlobal(attributes);
            }
            if (jobValues != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(jobValues);
            }
        }
    }

    public bool Contains(int processId)
    {
        EnsureOpen();
        IntPtr process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero)
        {
            int error = Marshal.GetLastWin32Error();
            if (error == 87 || error == 1168)
            {
                return false;
            }
            throw new Win32Exception(error, "OpenProcess failed");
        }
        try
        {
            bool result;
            if (!IsProcessInJob(process, handle, out result))
            {
                throw LastError("IsProcessInJob");
            }
            return result;
        }
        finally
        {
            CloseHandle(process);
        }
    }

    public bool ContainsProcess(Process process)
    {
        EnsureOpen();
        bool result;
        if (!IsProcessInJob(process.Handle, handle, out result))
        {
            throw LastError("IsProcessInJob");
        }
        return result;
    }

    public uint ActiveProcessCount()
    {
        EnsureOpen();
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting =
            new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
        int size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
        IntPtr memory = Marshal.AllocHGlobal(size);
        try
        {
            if (!QueryInformationJobObject(
                handle,
                JobObjectBasicAccountingInformation,
                memory,
                (uint)size,
                IntPtr.Zero))
            {
                throw LastError("QueryInformationJobObject");
            }
            accounting = (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(
                memory,
                typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            return accounting.ActiveProcesses;
        }
        finally
        {
            Marshal.FreeHGlobal(memory);
        }
    }

    public void Terminate(uint exitCode)
    {
        EnsureOpen();
        if (!TerminateJobObject(handle, exitCode))
        {
            throw LastError("TerminateJobObject");
        }
    }

    public void Dispose()
    {
        if (handle != IntPtr.Zero)
        {
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }
        GC.SuppressFinalize(this);
    }

    ~WindowsPtyJobProbe()
    {
        Dispose();
    }

    private void EnsureOpen()
    {
        if (handle == IntPtr.Zero)
        {
            throw new ObjectDisposedException("WindowsPtyJobProbe");
        }
    }

    private static Win32Exception LastError(string operation)
    {
        int error = Marshal.GetLastWin32Error();
        return new Win32Exception(error, operation + " failed with Win32 error " + error);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        uint informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
        IntPtr job,
        uint informationClass,
        IntPtr information,
        uint informationLength,
        IntPtr returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref UIntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        UIntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFOEX startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO
    {
        public uint cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }
}
