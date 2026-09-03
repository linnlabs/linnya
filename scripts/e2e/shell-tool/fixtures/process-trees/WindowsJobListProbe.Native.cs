using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public sealed partial class WindowsJobListProbe
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1;
    private const int JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
    private const int ERROR_INSUFFICIENT_BUFFER = 122;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 258;
    private const uint WAIT_FAILED = 0xFFFFFFFF;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST = new IntPtr(0x00020002);
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST = new IntPtr(0x0002000D);

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
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

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength, out uint returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount, int flags, ref UIntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr attributeList, uint flags, IntPtr attribute, IntPtr value, UIntPtr size, IntPtr previousValue, IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, IntPtr attributes, uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateEvent(ref SECURITY_ATTRIBUTES attributes, bool manualReset, bool initialState, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetEvent(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private sealed class InjectedFailureException : Exception
    {
        public InjectedFailureException(string stage) : base("Injected failure after " + stage) { }
    }

    private sealed class AttributeList : IDisposable
    {
        public IntPtr Pointer;
        private IntPtr jobValues;
        private IntPtr handleValues;

        public AttributeList(int count)
        {
            UIntPtr size = UIntPtr.Zero;
            bool firstCall = InitializeProcThreadAttributeList(IntPtr.Zero, count, 0, ref size);
            int error = Marshal.GetLastWin32Error();
            if (firstCall || error != ERROR_INSUFFICIENT_BUFFER || size == UIntPtr.Zero)
                throw new Win32Exception(error, "InitializeProcThreadAttributeList(size) did not return the required buffer contract");

            Pointer = Marshal.AllocHGlobal(checked((int)size.ToUInt64()));
            try
            {
                if (!InitializeProcThreadAttributeList(Pointer, count, 0, ref size))
                    throw LastError("InitializeProcThreadAttributeList(buffer)");
            }
            catch
            {
                Marshal.FreeHGlobal(Pointer);
                Pointer = IntPtr.Zero;
                throw;
            }
        }

        public void SetJob(IntPtr job)
        {
            jobValues = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobValues, job);
            if (!UpdateProcThreadAttribute(Pointer, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, jobValues, new UIntPtr((uint)IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                throw LastError("UpdateProcThreadAttribute(JOB_LIST)");
        }

        public void SetHandles(IntPtr[] handles)
        {
            handleValues = Marshal.AllocHGlobal(checked(handles.Length * IntPtr.Size));
            for (int index = 0; index < handles.Length; index++)
                Marshal.WriteIntPtr(handleValues, index * IntPtr.Size, handles[index]);
            if (!UpdateProcThreadAttribute(Pointer, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handleValues, new UIntPtr(checked((uint)(handles.Length * IntPtr.Size))), IntPtr.Zero, IntPtr.Zero))
                throw LastError("UpdateProcThreadAttribute(HANDLE_LIST)");
        }

        public void Dispose()
        {
            if (Pointer != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(Pointer);
                Marshal.FreeHGlobal(Pointer);
                Pointer = IntPtr.Zero;
            }
            Free(ref jobValues);
            Free(ref handleValues);
        }
    }

    private sealed class PipeReader : IDisposable
    {
        private readonly ManualResetEvent ready = new ManualResetEvent(false);
        private readonly ManualResetEvent done = new ManualResetEvent(false);
        private readonly Thread thread;
        private readonly MemoryStream bytes = new MemoryStream();
        private Exception error;
        private bool finished;

        public PipeReader(IntPtr handle)
        {
            thread = new Thread(delegate()
            {
                try
                {
                    using (FileStream stream = new FileStream(new SafeFileHandle(handle, true), FileAccess.Read, 4096, false))
                    {
                        ready.Set();
                        byte[] buffer = new byte[8192];
                        int count;
                        while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
                            bytes.Write(buffer, 0, count);
                    }
                }
                catch (Exception caught)
                {
                    error = caught;
                }
                finally
                {
                    ready.Set();
                    done.Set();
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        public bool WaitReady(int milliseconds) { return ready.WaitOne(milliseconds); }

        public int Finish(int milliseconds)
        {
            if (!done.WaitOne(milliseconds) || !thread.Join(milliseconds))
                throw new TimeoutException("Pipe reader did not reach EOF");
            finished = true;
            if (error != null) throw new InvalidOperationException("Pipe reader failed", error);
            return checked((int)bytes.Length);
        }

        public void Dispose()
        {
            // 事件对象是 reader 线程会访问的资源，只有 EOF 后才能释放。
            Exception finishError = null;
            try
            {
                if (!finished) Finish(5000);
            }
            catch (Exception caught)
            {
                finishError = caught;
            }
            bool threadStopped = done.WaitOne(0) && !thread.IsAlive;
            if (threadStopped)
            {
                ready.Dispose();
                done.Dispose();
                bytes.Dispose();
            }
            if (finishError != null) throw finishError;
            if (!threadStopped) throw new TimeoutException("Pipe reader resources are still owned by the reader thread");
        }
    }

    private sealed class OwnedLaunch : IDisposable
    {
        public IntPtr Job;
        public IntPtr Process;
        public IntPtr Thread;
        public IntPtr StdinWrite;
        public IntPtr StdoutRead;
        public IntPtr StderrRead;
        public IntPtr Sentinel;
        public int ProcessId;
        public PipeReader Stdout;
        public PipeReader Stderr;

        public bool IsInJob()
        {
            bool inJob;
            if (!IsProcessInJob(Process, Job, out inJob)) throw LastError("IsProcessInJob");
            return inJob;
        }

        public void CloseStdin() { Close(ref StdinWrite); }

        public bool StartReaders()
        {
            Stdout = new PipeReader(StdoutRead);
            StdoutRead = IntPtr.Zero;
            Stderr = new PipeReader(StderrRead);
            StderrRead = IntPtr.Zero;
            return Stdout.WaitReady(5000) && Stderr.WaitReady(5000);
        }

        public void Resume()
        {
            if (ResumeThread(Thread) == UInt32.MaxValue) throw LastError("ResumeThread");
            Close(ref Thread);
        }

        public uint WaitForExit(int milliseconds)
        {
            uint wait = WaitForSingleObject(Process, checked((uint)milliseconds));
            if (wait == WAIT_TIMEOUT) throw new TimeoutException("Root process did not exit");
            if (wait == WAIT_FAILED) throw LastError("WaitForSingleObject(process)");
            if (wait != WAIT_OBJECT_0) throw new InvalidOperationException("Unexpected process wait result: " + wait);
            uint exitCode;
            if (!GetExitCodeProcess(Process, out exitCode)) throw LastError("GetExitCodeProcess");
            return exitCode;
        }

        public uint ActiveProcesses() { return QueryActiveProcesses(Job); }

        public void Terminate()
        {
            if (Job != IntPtr.Zero && !TerminateJobObject(Job, 0xC000013A))
                throw LastError("TerminateJobObject");
        }

        public void CloseJob() { Close(ref Job); }

        public bool SentinelSignaled()
        {
            uint wait = WaitForSingleObject(Sentinel, 0);
            if (wait == WAIT_OBJECT_0) return true;
            if (wait == WAIT_TIMEOUT) return false;
            if (wait == WAIT_FAILED) throw LastError("WaitForSingleObject(sentinel)");
            throw new InvalidOperationException("Unexpected sentinel wait result: " + wait);
        }

        public void Dispose()
        {
            // Job 是整棵树的唯一 owner。必须先结束树并等待 pipe EOF，才能释放 reader 的同步对象。
            // 任一步失败也必须继续释放其余句柄，否则清理异常会反过来制造测试进程泄漏。
            List<Exception> errors = new List<Exception>();
            Attempt(errors, delegate
            {
                if (Job != IntPtr.Zero)
                {
                    if (!TerminateJobObject(Job, 0xC000013A)) throw LastError("TerminateJobObject(dispose)");
                    WaitForNoActiveProcesses(Job, 5000);
                }
            });
            Attempt(errors, delegate { Close(ref Thread); });
            Attempt(errors, delegate { Close(ref StdinWrite); });
            Attempt(errors, delegate { Close(ref StdoutRead); });
            Attempt(errors, delegate { Close(ref StderrRead); });
            Attempt(errors, delegate { if (Stdout != null) Stdout.Dispose(); });
            Attempt(errors, delegate { if (Stderr != null) Stderr.Dispose(); });
            Attempt(errors, delegate { Close(ref Process); });
            Attempt(errors, delegate { Close(ref Sentinel); });
            Attempt(errors, delegate { Close(ref Job); });
            if (errors.Count > 0) throw new AggregateException("Owned launch cleanup failed", errors);
        }
    }

    private static void Attempt(List<Exception> errors, Action action)
    {
        try { action(); }
        catch (Exception error) { errors.Add(error); }
    }
}
