public sealed partial class WindowsJobListProbe
{
    public sealed class NormalResult
    {
        public bool Success { get; set; }
        public bool InJobWhileSuspended { get; set; }
        public bool MarkerWhileSuspended { get; set; }
        public bool ReadersReadyBeforeResume { get; set; }
        public bool HostReadyCheckpointBeforeResume { get; set; }
        public bool StdinWasClosed { get; set; }
        public bool SentinelWasNotInherited { get; set; }
        public uint RootExitCode { get; set; }
        public uint ActiveAfterRootExit { get; set; }
        public bool HeartbeatAdvanced { get; set; }
        public uint ActiveAfterTerminate { get; set; }
        public bool GrandchildGone { get; set; }
        public bool HeartbeatStopped { get; set; }
        public int StdoutBytes { get; set; }
        public int StderrBytes { get; set; }
        public string Error { get; set; }
    }

    public sealed class SetupFailureResult
    {
        public bool Success { get; set; }
        public int CasesPassed { get; set; }
        public int CasesExpected { get; set; }
        public int HandleDelta { get; set; }
        public string Error { get; set; }
    }

    public sealed class AckFailureResult
    {
        public bool Success { get; set; }
        public bool InJobWhileSuspended { get; set; }
        public bool ReadersReady { get; set; }
        public bool ChildGone { get; set; }
        public bool MarkerAbsent { get; set; }
        public string Error { get; set; }
    }

    public sealed class StressResult
    {
        public bool Success { get; set; }
        public int RoundsRequested { get; set; }
        public int RoundsCompleted { get; set; }
        public int HandleDelta { get; set; }
        public long ElapsedMilliseconds { get; set; }
        public string Error { get; set; }
    }

    public sealed class NestedResult
    {
        public bool Success { get; set; }
        public bool OuterChildInJob { get; set; }
        public bool InnerLaunchSucceeded { get; set; }
        public uint OuterExitCode { get; set; }
        public string Error { get; set; }
    }

    public sealed class BreakawayResult
    {
        public bool Success { get; set; }
        public bool ParentInJob { get; set; }
        public uint ParentExitCode { get; set; }
        public bool BreakawayDenied { get; set; }
        public int BreakawayError { get; set; }
        public bool EscapedMarkerAbsent { get; set; }
        public string Error { get; set; }
    }

    public sealed class SuiteResult
    {
        public bool Success { get; set; }
        public string Platform { get; set; }
        public string Architecture { get; set; }
        public NormalResult Normal { get; set; }
        public AckFailureResult AckFailure { get; set; }
        public SetupFailureResult SetupFailures { get; set; }
        public StressResult Stress { get; set; }
        public NestedResult Nested { get; set; }
        public BreakawayResult Breakaway { get; set; }
    }
}
