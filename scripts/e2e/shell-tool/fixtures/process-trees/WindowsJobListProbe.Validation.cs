using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed partial class WindowsJobListProbe
{
    private static BreakawayResult RunBreakaway(string executable, string root)
    {
        BreakawayResult result = new BreakawayResult();
        Directory.CreateDirectory(root);
        string marker = Path.Combine(root, "escaped.marker");
        string evidence = Path.Combine(root, "breakaway-evidence.txt");
        OwnedLaunch launch = null;
        try
        {
            launch = CreateOwnedSuspended(executable, delegate(IntPtr sentinel)
            {
                return BuildCommandLine(executable, "child-breakaway", marker, evidence);
            }, root, null, false);
            result.ParentInJob = launch.IsInJob();
            launch.CloseStdin();
            launch.StartReaders();
            launch.Resume();
            result.ParentExitCode = launch.WaitForExit(5000);
            if (!WaitForFile(evidence, 1000)) throw new InvalidOperationException("Breakaway child did not publish evidence");
            Dictionary<string, string> values = ReadEvidence(evidence);
            result.BreakawayDenied = values["denied"] == "true";
            result.BreakawayError = Int32.Parse(values["error"]);
            result.EscapedMarkerAbsent = !File.Exists(marker);
            launch.Stdout.Finish(5000);
            launch.Stderr.Finish(5000);
            WaitForNoActiveProcesses(launch.Job, 5000);
            result.Success = result.ParentInJob && result.ParentExitCode == 29 && result.BreakawayDenied && result.BreakawayError == 5 && result.EscapedMarkerAbsent && launch.ActiveProcesses() == 0;
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

    private static int RunNestedOwner(string root, string resultPath)
    {
        string executable = Process.GetCurrentProcess().MainModule.FileName;
        string nestedRoot = Path.Combine(root, "inner");
        Directory.CreateDirectory(nestedRoot);
        string marker = Path.Combine(nestedRoot, "marker");
        string evidence = Path.Combine(nestedRoot, "evidence");
        bool success = false;
        OwnedLaunch launch = CreateOwnedSuspended(executable, delegate(IntPtr sentinel)
        {
            return BuildCommandLine(executable, "child-quick", marker, evidence, sentinel.ToInt64().ToString());
        }, nestedRoot, null, false);
        RunAndDispose(launch, delegate
        {
            launch.CloseStdin();
            success = launch.IsInJob() && !File.Exists(marker) && launch.StartReaders();
            launch.Resume();
            success = success && launch.WaitForExit(5000) == 17 && WaitForFile(marker, 1000) && !launch.SentinelSignaled();
            launch.Stdout.Finish(5000);
            launch.Stderr.Finish(5000);
            WaitForNoActiveProcesses(launch.Job, 5000);
            success = success && launch.ActiveProcesses() == 0;
        });
        File.WriteAllText(resultPath, success ? "true" : "false");
        return success ? 31 : 32;
    }

    private static int RunBreakawayChild(string marker, string evidence)
    {
        string executable = Process.GetCurrentProcess().MainModule.FileName;
        STARTUPINFOEX startup = new STARTUPINFOEX();
        startup.StartupInfo.cb = checked((uint)Marshal.SizeOf(typeof(STARTUPINFO)));
        PROCESS_INFORMATION process;
        bool created = CreateProcessW(
            executable,
            new StringBuilder(BuildCommandLine(executable, "breakaway-target", marker)),
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW,
            IntPtr.Zero,
            Path.GetDirectoryName(marker),
            ref startup,
            out process);
        int error = created ? 0 : Marshal.GetLastWin32Error();
        if (created)
        {
            List<Exception> cleanupErrors = new List<Exception>();
            if (!TerminateProcess(process.hProcess, 0xC000013A))
                cleanupErrors.Add(LastError("TerminateProcess(unexpected breakaway)"));
            uint wait = WaitForSingleObject(process.hProcess, 7000);
            if (wait != WAIT_OBJECT_0)
                cleanupErrors.Add(new InvalidOperationException("Unexpected breakaway process did not reach terminal state: " + wait));
            if (!CloseHandle(process.hThread))
                cleanupErrors.Add(LastError("CloseHandle(unexpected breakaway thread)"));
            if (!CloseHandle(process.hProcess))
                cleanupErrors.Add(LastError("CloseHandle(unexpected breakaway process)"));
            if (cleanupErrors.Count > 0)
                throw new AggregateException("Unexpected breakaway cleanup failed", cleanupErrors);
        }
        File.WriteAllText(evidence, "denied=" + Lower(!created) + Environment.NewLine + "error=" + error + Environment.NewLine);
        return !created && error == 5 ? 29 : 30;
    }

    private static int RunBreakawayTarget(string marker)
    {
        File.WriteAllText(marker, "escaped");
        // 即使回归失败且目标真的逃出 Job，也不能让测试自己留下永久进程。
        Thread.Sleep(5000);
        return 33;
    }

    private static int EchoArguments(string[] args)
    {
        string[] values = new string[args.Length - 1];
        Array.Copy(args, 1, values, 0, values.Length);
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.Out.Write(Serialize(values));
        return 0;
    }

    private static void DisposeLaunch(OwnedLaunch launch, Action<string> report)
    {
        if (launch == null) return;
        try { launch.Dispose(); }
        catch (Exception error) { report(error.ToString()); }
    }

    private static string AppendError(string existing, string added)
    {
        return String.IsNullOrEmpty(existing) ? added : existing + Environment.NewLine + "Cleanup: " + added;
    }

    private static void RunAndDispose(OwnedLaunch launch, Action action)
    {
        Exception primary = null;
        try { action(); }
        catch (Exception error) { primary = error; }
        try { launch.Dispose(); }
        catch (Exception cleanup)
        {
            if (primary != null) throw new AggregateException("Owned launch action and cleanup failed", primary, cleanup);
            throw;
        }
        if (primary != null) throw primary;
    }
}
