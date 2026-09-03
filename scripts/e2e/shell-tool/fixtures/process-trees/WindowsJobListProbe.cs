using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public sealed partial class WindowsJobListProbe
{
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0) throw new ArgumentException("mode is required");
            if (args[0] == "suite") return RunSuite(args[1]);
            if (args[0] == "hold-before-resume") return HoldBeforeResume(args[1], args[2], args[3], args[4]);
            if (args[0] == "child-normal") return RunNormalChild(args);
            if (args[0] == "child-quick") return RunQuickChild(args);
            if (args[0] == "grandchild") return RunGrandchild(args[1], args[2]);
            if (args[0] == "nested-owner") return RunNestedOwner(args[1], args[2]);
            if (args[0] == "child-breakaway") return RunBreakawayChild(args[1], args[2]);
            if (args[0] == "breakaway-target") return RunBreakawayTarget(args[1]);
            if (args[0] == "argv-echo") return EchoArguments(args);
            throw new ArgumentException("unknown mode: " + args[0]);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.ToString());
            return 90;
        }
    }

    private static int RunSuite(string root)
    {
        Directory.CreateDirectory(root);
        string executable = Process.GetCurrentProcess().MainModule.FileName;
        SuiteResult result = new SuiteResult();
        result.Platform = Environment.OSVersion.VersionString;
        result.Architecture = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE");
        result.Normal = RunNormal(executable, Path.Combine(root, "normal"));
        result.AckFailure = RunAckFailure(executable, Path.Combine(root, "ack-failure"));
        result.SetupFailures = RunSetupFailures(executable, Path.Combine(root, "setup-failures"));
        result.Stress = RunStress(executable, Path.Combine(root, "stress"), 100);
        result.Nested = RunNested(executable, Path.Combine(root, "nested"));
        result.Breakaway = RunBreakaway(executable, Path.Combine(root, "breakaway"));
        result.Success = result.Normal.Success && result.AckFailure.Success && result.SetupFailures.Success && result.Stress.Success && result.Nested.Success && result.Breakaway.Success;
        Console.Out.WriteLine(Serialize(result));
        return result.Success ? 0 : 1;
    }

    private static NormalResult RunNormal(string executable, string root)
    {
        NormalResult result = new NormalResult();
        Directory.CreateDirectory(root);
        string marker = Path.Combine(root, "user-code.marker");
        string evidence = Path.Combine(root, "child-evidence.txt");
        string heartbeat = Path.Combine(root, "grandchild.heartbeat");
        string pidPath = Path.Combine(root, "grandchild.pid");
            string hostReadyCheckpoint = Path.Combine(root, "host-ready.checkpoint");
        OwnedLaunch launch = null;
        try
        {
            launch = CreateOwnedSuspended(executable, delegate(IntPtr sentinel)
            {
                return BuildCommandLine(executable, "child-normal", marker, evidence, heartbeat, pidPath, sentinel.ToInt64().ToString());
            }, root, null, false);
            result.InJobWhileSuspended = launch.IsInJob();
            Thread.Sleep(300);
            result.MarkerWhileSuspended = File.Exists(marker);
            launch.CloseStdin();
            result.ReadersReadyBeforeResume = launch.StartReaders();
            // E1 只证明 host-side reader 已准备好；真实 IPC started ACK 留给 packaged utility-process 实验。
            File.WriteAllText(hostReadyCheckpoint, "ready");
            result.HostReadyCheckpointBeforeResume = File.Exists(hostReadyCheckpoint) && !File.Exists(marker);
            launch.Resume();
            result.RootExitCode = launch.WaitForExit(15000);
            if (!WaitForFile(evidence, 5000) || !WaitForFile(pidPath, 5000) || !WaitForFile(heartbeat, 10000))
                throw new InvalidOperationException("Normal child did not publish complete evidence");
            Dictionary<string, string> childEvidence = ReadEvidence(evidence);
            result.StdinWasClosed = childEvidence["stdinEof"] == "true";
            result.SentinelWasNotInherited = childEvidence["sentinelSet"] == "false" && !launch.SentinelSignaled();
            if (childEvidence["inAnyJob"] != "true") throw new InvalidOperationException("Child did not observe Job membership");
            int grandchildPid = Int32.Parse(File.ReadAllText(pidPath).Trim());
            result.ActiveAfterRootExit = launch.ActiveProcesses();
            int heartbeatBefore = CountLines(heartbeat);
            Thread.Sleep(500);
            int heartbeatAfter = CountLines(heartbeat);
            result.HeartbeatAdvanced = heartbeatAfter > heartbeatBefore;
            launch.Terminate();
            WaitForNoActiveProcesses(launch.Job, 5000);
            result.ActiveAfterTerminate = launch.ActiveProcesses();
            WaitUntilGone(grandchildPid, 5000);
            result.GrandchildGone = !IsAlive(grandchildPid);
            int stoppedAt = CountLines(heartbeat);
            Thread.Sleep(300);
            result.HeartbeatStopped = CountLines(heartbeat) == stoppedAt;
            result.StdoutBytes = launch.Stdout.Finish(5000);
            result.StderrBytes = launch.Stderr.Finish(5000);
            result.Success = result.InJobWhileSuspended && !result.MarkerWhileSuspended && result.ReadersReadyBeforeResume && result.HostReadyCheckpointBeforeResume && result.StdinWasClosed && result.SentinelWasNotInherited && result.RootExitCode == 23 && result.ActiveAfterRootExit >= 1 && result.HeartbeatAdvanced && result.ActiveAfterTerminate == 0 && result.GrandchildGone && result.HeartbeatStopped && result.StdoutBytes == 262144 && result.StderrBytes == 262144;
        }
        catch (Exception error)
        {
            result.Error = error.ToString();
        }
        finally
        {
            DisposeLaunch(launch, delegate(string error) { result.Success = false; result.Error = AppendError(result.Error, error); });
        }
        return result;
    }

    private static AckFailureResult RunAckFailure(string executable, string root)
    {
        AckFailureResult result = new AckFailureResult();
        Directory.CreateDirectory(root);
        string marker = Path.Combine(root, "user-code.marker");
        string evidence = Path.Combine(root, "child-evidence.txt");
        OwnedLaunch launch = null;
        try
        {
            launch = CreateOwnedSuspended(executable, delegate(IntPtr sentinel)
            {
                return BuildCommandLine(executable, "child-quick", marker, evidence, sentinel.ToInt64().ToString());
            }, root, null, false);
            result.InJobWhileSuspended = launch.IsInJob();
            launch.CloseStdin();
            result.ReadersReady = launch.StartReaders();
            launch.CloseJob();
            result.ChildGone = WaitForSingleObject(launch.Process, 5000) == WAIT_OBJECT_0;
            result.MarkerAbsent = !File.Exists(marker);
            launch.Stdout.Finish(5000);
            launch.Stderr.Finish(5000);
            result.Success = result.InJobWhileSuspended && result.ReadersReady && result.ChildGone && result.MarkerAbsent;
        }
        catch (Exception error)
        {
            result.Error = error.ToString();
        }
        finally
        {
            DisposeLaunch(launch, delegate(string error) { result.Success = false; result.Error = AppendError(result.Error, error); });
        }
        return result;
    }

    private static SetupFailureResult RunSetupFailures(string executable, string root)
    {
        SetupFailureResult result = new SetupFailureResult();
        Directory.CreateDirectory(root);
        string[] stages = new string[] { "job", "pipes", "attributes", "attribute-values" };
        result.CasesExpected = stages.Length + 1;
        int handlesBefore = CurrentHandleCount();
        try
        {
            foreach (string stage in stages)
            {
                string marker = Path.Combine(root, stage + ".marker");
                try
                {
                    OwnedLaunch launch = CreateOwnedSuspended(executable, delegate(IntPtr sentinel)
                    {
                        return BuildCommandLine(executable, "child-quick", marker, Path.Combine(root, stage + ".txt"), sentinel.ToInt64().ToString());
                    }, root, stage, false);
                    launch.Dispose();
                    throw new InvalidOperationException("Failure stage did not fail: " + stage);
                }
                catch (InjectedFailureException)
                {
                    if (File.Exists(marker)) throw new InvalidOperationException("Injected setup failure ran user code: " + stage);
                    result.CasesPassed += 1;
                }
            }
            string invalidMarker = Path.Combine(root, "invalid-executable.marker");
            try
            {
                OwnedLaunch invalid = CreateOwnedSuspended(executable, delegate(IntPtr sentinel)
                {
                    return BuildCommandLine(executable, "child-quick", invalidMarker, Path.Combine(root, "invalid.txt"), sentinel.ToInt64().ToString());
                }, root, null, true);
                invalid.Dispose();
                throw new InvalidOperationException("Invalid executable unexpectedly launched");
            }
            catch (Win32Exception)
            {
                if (File.Exists(invalidMarker)) throw new InvalidOperationException("Invalid executable ran user code");
                result.CasesPassed += 1;
            }
        }
        catch (Exception error)
        {
            result.Error = error.ToString();
        }
        result.HandleDelta = WaitForHandleDelta(handlesBefore, 4, 5000);
        result.Success = result.CasesPassed == result.CasesExpected && result.HandleDelta <= 4;
        return result;
    }

    private static StressResult RunStress(string executable, string root, int rounds)
    {
        StressResult result = new StressResult();
        result.RoundsRequested = rounds;
        Directory.CreateDirectory(root);
        int handlesBefore = CurrentHandleCount();
        Stopwatch timer = Stopwatch.StartNew();
        try
        {
            for (int index = 0; index < rounds; index++)
            {
                string roundRoot = Path.Combine(root, index.ToString("D3"));
                Directory.CreateDirectory(roundRoot);
                string marker = Path.Combine(roundRoot, "marker");
                string evidence = Path.Combine(roundRoot, "evidence");
                OwnedLaunch launch = CreateOwnedSuspended(executable, delegate(IntPtr sentinel)
                {
                    return BuildCommandLine(executable, "child-quick", marker, evidence, sentinel.ToInt64().ToString());
                }, roundRoot, null, false);
                RunAndDispose(launch, delegate
                {
                    if (!launch.IsInJob() || File.Exists(marker)) throw new InvalidOperationException("Stress ownership failed in round " + index);
                    launch.CloseStdin();
                    if (!launch.StartReaders()) throw new InvalidOperationException("Stress readers not ready in round " + index);
                    launch.Resume();
                    if (launch.WaitForExit(5000) != 17) throw new InvalidOperationException("Stress exit mismatch in round " + index);
                    if (!WaitForFile(marker, 1000)) throw new InvalidOperationException("Stress marker missing in round " + index);
                    WaitForNoActiveProcesses(launch.Job, 1000);
                    if (launch.ActiveProcesses() != 0) throw new InvalidOperationException("Stress Job not empty in round " + index);
                    Dictionary<string, string> childEvidence = ReadEvidence(evidence);
                    if (childEvidence["sentinelSet"] != "false" || launch.SentinelSignaled())
                        throw new InvalidOperationException("Stress sentinel leaked in round " + index);
                    launch.Stdout.Finish(5000);
                    launch.Stderr.Finish(5000);
                });
                result.RoundsCompleted += 1;
            }
        }
        catch (Exception error)
        {
            result.Error = error.ToString();
        }
        timer.Stop();
        result.HandleDelta = WaitForHandleDelta(handlesBefore, 6, 5000);
        result.ElapsedMilliseconds = timer.ElapsedMilliseconds;
        result.Success = result.RoundsCompleted == result.RoundsRequested && result.HandleDelta <= 6;
        return result;
    }

    private static NestedResult RunNested(string executable, string root)
    {
        NestedResult result = new NestedResult();
        Directory.CreateDirectory(root);
        string nestedResultPath = Path.Combine(root, "inner-result.txt");
        OwnedLaunch launch = null;
        try
        {
            launch = CreateOwnedSuspended(executable, delegate(IntPtr sentinel)
            {
                return BuildCommandLine(executable, "nested-owner", root, nestedResultPath);
            }, root, null, false);
            result.OuterChildInJob = launch.IsInJob();
            launch.CloseStdin();
            launch.StartReaders();
            launch.Resume();
            result.OuterExitCode = launch.WaitForExit(15000);
            if (!WaitForFile(nestedResultPath, 5000)) throw new InvalidOperationException("Nested owner did not publish inner result");
            result.InnerLaunchSucceeded = File.ReadAllText(nestedResultPath).Trim() == "true";
            launch.Stdout.Finish(5000);
            launch.Stderr.Finish(5000);
            WaitForNoActiveProcesses(launch.Job, 5000);
            result.Success = result.OuterChildInJob && result.InnerLaunchSucceeded && result.OuterExitCode == 31 && launch.ActiveProcesses() == 0;
        }
        catch (Exception error)
        {
            result.Error = error.ToString();
        }
        finally
        {
            DisposeLaunch(launch, delegate(string error) { result.Success = false; result.Error = AppendError(result.Error, error); });
        }
        return result;
    }

    private static int HoldBeforeResume(string root, string readyPath, string marker, string runToken)
    {
        Directory.CreateDirectory(root);
        string executable = Process.GetCurrentProcess().MainModule.FileName;
        OwnedLaunch launch = CreateOwnedSuspended(executable, delegate(IntPtr sentinel)
        {
            return BuildCommandLine(executable, "child-quick", marker, Path.Combine(root, "evidence"), sentinel.ToInt64().ToString());
        }, root, null, false);
        if (!launch.IsInJob() || File.Exists(marker)) throw new InvalidOperationException("Suspended owner checkpoint is invalid");
        launch.CloseStdin();
        if (!launch.StartReaders()) throw new InvalidOperationException("Suspended owner readers did not become ready");
        int ownerProcessId;
        long ownerStartTimeUtcTicks;
        using (Process owner = Process.GetCurrentProcess())
        {
            ownerProcessId = owner.Id;
            ownerStartTimeUtcTicks = owner.StartTime.ToUniversalTime().Ticks;
        }
        long rootStartTimeUtcTicks;
        using (Process rootProcess = Process.GetProcessById(launch.ProcessId))
            rootStartTimeUtcTicks = rootProcess.StartTime.ToUniversalTime().Ticks;
        string pendingReadyPath = readyPath + ".pending";
        File.WriteAllText(
            pendingReadyPath,
                "version=1" + Environment.NewLine
                + "runToken=" + runToken + Environment.NewLine
                + "ownerPid=" + ownerProcessId + Environment.NewLine
                + "ownerStartTimeUtcTicks=" + ownerStartTimeUtcTicks + Environment.NewLine
                + "rootPid=" + launch.ProcessId + Environment.NewLine
                + "rootStartTimeUtcTicks=" + rootStartTimeUtcTicks + Environment.NewLine
                + "inJob=true" + Environment.NewLine);
        File.Move(pendingReadyPath, readyPath);
        Thread.Sleep(Timeout.Infinite);
        return 0;
    }

    private static int RunNormalChild(string[] args)
    {
        string marker = args[1];
        string evidence = args[2];
        string heartbeat = args[3];
        string pidPath = args[4];
        IntPtr sentinel = new IntPtr(Int64.Parse(args[5]));
        File.WriteAllText(marker, "started");
        bool inAnyJob;
        if (!IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out inAnyJob)) throw LastError("IsProcessInJob(child)");
        bool stdinEof = Console.OpenStandardInput().ReadByte() == -1;
        bool sentinelSet = SetEvent(sentinel);
        File.WriteAllText(evidence, "stdinEof=" + Lower(stdinEof) + Environment.NewLine + "inAnyJob=" + Lower(inAnyJob) + Environment.NewLine + "sentinelSet=" + Lower(sentinelSet) + Environment.NewLine);
        WriteRepeated(Console.OpenStandardOutput(), 0x41, 262144);
        WriteRepeated(Console.OpenStandardError(), 0x42, 262144);
        ProcessStartInfo grandchild = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, BuildArguments("grandchild", heartbeat, pidPath));
        grandchild.UseShellExecute = false;
        grandchild.CreateNoWindow = true;
        Process process = Process.Start(grandchild);
        if (process == null) throw new InvalidOperationException("Grandchild did not start");
        process.Dispose();
        return 23;
    }

    private static int RunQuickChild(string[] args)
    {
        string marker = args[1];
        string evidence = args[2];
        IntPtr sentinel = new IntPtr(Int64.Parse(args[3]));
        File.WriteAllText(marker, "started");
        bool stdinEof = Console.OpenStandardInput().ReadByte() == -1;
        bool sentinelSet = SetEvent(sentinel);
        File.WriteAllText(evidence, "stdinEof=" + Lower(stdinEof) + Environment.NewLine + "sentinelSet=" + Lower(sentinelSet) + Environment.NewLine);
        Console.Out.Write("quick-out");
        Console.Error.Write("quick-error");
        return 17;
    }

    private static int RunGrandchild(string heartbeat, string pidPath)
    {
        File.WriteAllText(pidPath, Process.GetCurrentProcess().Id.ToString());
        int sequence = 0;
        while (true)
        {
            File.AppendAllText(heartbeat, (++sequence).ToString() + Environment.NewLine);
            Thread.Sleep(50);
        }
    }

    private static OwnedLaunch CreateOwnedSuspended(string executable, Func<IntPtr, string> buildCommandLine, string cwd, string failStage, bool invalidExecutable)
    {
        OwnedLaunch launch = new OwnedLaunch();
        IntPtr stdinRead = IntPtr.Zero;
        IntPtr stdoutWrite = IntPtr.Zero;
        IntPtr stderrWrite = IntPtr.Zero;
        AttributeList attributes = null;
        try
        {
            launch.Job = CreateConfiguredJob();
            Inject(failStage, "job");
            if (!CreatePipe(out stdinRead, out launch.StdinWrite, IntPtr.Zero, 0)) throw LastError("CreatePipe(stdin)");
            if (!CreatePipe(out launch.StdoutRead, out stdoutWrite, IntPtr.Zero, 0)) throw LastError("CreatePipe(stdout)");
            if (!CreatePipe(out launch.StderrRead, out stderrWrite, IntPtr.Zero, 0)) throw LastError("CreatePipe(stderr)");
            SECURITY_ATTRIBUTES inheritable = InheritableAttributes();
            launch.Sentinel = CreateEvent(ref inheritable, true, false, null);
            if (launch.Sentinel == IntPtr.Zero) throw LastError("CreateEvent(sentinel)");
            // pipe 默认不可继承，只开放三个 child 端点；避免并发 spawn 看见短暂的宽继承窗口。
            MarkInheritable(stdinRead);
            MarkInheritable(stdoutWrite);
            MarkInheritable(stderrWrite);
            Inject(failStage, "pipes");

            attributes = new AttributeList(2);
            Inject(failStage, "attributes");
            attributes.SetJob(launch.Job);
            attributes.SetHandles(new IntPtr[] { stdinRead, stdoutWrite, stderrWrite });
            Inject(failStage, "attribute-values");

            STARTUPINFOEX startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = checked((uint)Marshal.SizeOf(typeof(STARTUPINFOEX)));
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = stdinRead;
            startup.StartupInfo.hStdOutput = stdoutWrite;
            startup.StartupInfo.hStdError = stderrWrite;
            startup.lpAttributeList = attributes.Pointer;
            PROCESS_INFORMATION process;
            string application = invalidExecutable ? Path.Combine(cwd, "missing-probe.exe") : executable;
            string commandLine = buildCommandLine(launch.Sentinel);
            bool created = CreateProcessW(application, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW, IntPtr.Zero, cwd, ref startup, out process);
            if (!created) throw LastError("CreateProcessW");
            launch.Process = process.hProcess;
            launch.Thread = process.hThread;
            launch.ProcessId = checked((int)process.dwProcessId);
            Close(ref stdinRead);
            Close(ref stdoutWrite);
            Close(ref stderrWrite);
            return launch;
        }
        catch (Exception primary)
        {
            Close(ref stdinRead);
            Close(ref stdoutWrite);
            Close(ref stderrWrite);
            try { launch.Dispose(); }
            catch (Exception cleanup) { throw new AggregateException("Owned launch setup and cleanup failed", primary, cleanup); }
            throw;
        }
        finally
        {
            if (attributes != null) attributes.Dispose();
        }
    }

    private static IntPtr CreateConfiguredJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw LastError("CreateJobObject");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, buffer, false);
            if (!SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, buffer, checked((uint)size)))
                throw LastError("SetInformationJobObject");
            return job;
        }
        catch
        {
            CloseHandle(job);
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static uint QueryActiveProcesses(IntPtr job)
    {
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
        int size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(accounting, buffer, false);
            uint returned;
            if (!QueryInformationJobObject(job, JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION, buffer, checked((uint)size), out returned))
                throw LastError("QueryInformationJobObject");
            accounting = (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(buffer, typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            return accounting.ActiveProcesses;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static void WaitForNoActiveProcesses(IntPtr job, int milliseconds)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < milliseconds)
        {
            if (QueryActiveProcesses(job) == 0) return;
            Thread.Sleep(20);
        }
        throw new TimeoutException("Job still has active processes");
    }

    private static SECURITY_ATTRIBUTES InheritableAttributes()
    {
        SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
        attributes.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        attributes.bInheritHandle = true;
        return attributes;
    }

    private static void MarkInheritable(IntPtr handle)
    {
        if (!SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT))
            throw LastError("SetHandleInformation");
    }

    private static void Inject(string requested, string current)
    {
        if (requested == current) throw new InjectedFailureException(current);
    }

    private static void WriteRepeated(Stream stream, byte value, int count)
    {
        byte[] chunk = new byte[8192];
        for (int index = 0; index < chunk.Length; index++) chunk[index] = value;
        int remaining = count;
        while (remaining > 0)
        {
            int length = Math.Min(remaining, chunk.Length);
            stream.Write(chunk, 0, length);
            remaining -= length;
        }
        stream.Flush();
    }

    private static Dictionary<string, string> ReadEvidence(string path)
    {
        Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (string line in File.ReadAllLines(path))
        {
            int separator = line.IndexOf('=');
            if (separator > 0) values[line.Substring(0, separator)] = line.Substring(separator + 1);
        }
        return values;
    }

    private static bool WaitForFile(string path, int milliseconds)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < milliseconds)
        {
            if (File.Exists(path) && new FileInfo(path).Length > 0) return true;
            Thread.Sleep(20);
        }
        return File.Exists(path) && new FileInfo(path).Length > 0;
    }

    private static int CountLines(string path)
    {
        return File.Exists(path) ? File.ReadAllLines(path).Length : 0;
    }

    private static bool IsAlive(int pid)
    {
        try
        {
            using (Process process = Process.GetProcessById(pid))
                return !process.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static void WaitUntilGone(int pid, int milliseconds)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < milliseconds)
        {
            if (!IsAlive(pid)) return;
            Thread.Sleep(20);
        }
        throw new TimeoutException("Process still alive: " + pid);
    }

    private static int CurrentHandleCount()
    {
        using (Process current = Process.GetCurrentProcess())
            return current.HandleCount;
    }

    private static int WaitForHandleDelta(int baseline, int acceptedDelta, int milliseconds)
    {
        Stopwatch timer = Stopwatch.StartNew();
        int smallestDelta = Int32.MaxValue;
        do
        {
            GC.Collect();
            GC.WaitForPendingFinalizers();
            int delta = CurrentHandleCount() - baseline;
            smallestDelta = Math.Min(smallestDelta, delta);
            if (delta <= acceptedDelta) return delta;
            Thread.Sleep(20);
        }
        while (timer.ElapsedMilliseconds < milliseconds);
        return smallestDelta;
    }

    private static string BuildCommandLine(string executable, params string[] args)
    {
        return Quote(executable) + " " + BuildArguments(args);
    }

    private static string BuildArguments(params string[] args)
    {
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < args.Length; index++)
        {
            if (index > 0) result.Append(' ');
            result.Append(Quote(args[index]));
        }
        return result.ToString();
    }

    private static string Quote(string value)
    {
        bool needsQuotes = value.Length == 0 || value.IndexOfAny(new char[] { ' ', '\t', '\n', '\r', '"' }) >= 0;
        if (!needsQuotes) return value;

        StringBuilder quoted = new StringBuilder(value.Length + 2);
        quoted.Append('"');
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes += 1;
                continue;
            }
            if (character == '"')
            {
                quoted.Append('\\', backslashes * 2 + 1);
                quoted.Append('"');
                backslashes = 0;
                continue;
            }
            if (backslashes > 0)
            {
                quoted.Append('\\', backslashes);
                backslashes = 0;
            }
            quoted.Append(character);
        }
        if (backslashes > 0) quoted.Append('\\', backslashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }

    private static string Lower(bool value) { return value ? "true" : "false"; }

    private static string Serialize(object value)
    {
        return new JavaScriptSerializer().Serialize(value);
    }

    private static Win32Exception LastError(string operation)
    {
        int error = Marshal.GetLastWin32Error();
        return new Win32Exception(error, operation + " failed with Win32 error " + error);
    }

    private static void Free(ref IntPtr memory)
    {
        if (memory == IntPtr.Zero) return;
        Marshal.FreeHGlobal(memory);
        memory = IntPtr.Zero;
    }

    private static void Close(ref IntPtr handle)
    {
        if (handle == IntPtr.Zero) return;
        CloseHandle(handle);
        handle = IntPtr.Zero;
    }
}
