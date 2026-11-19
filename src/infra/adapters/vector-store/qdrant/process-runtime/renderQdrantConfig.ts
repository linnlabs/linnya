export function renderQdrantConfig(input: {
  readonly host: string;
  readonly httpPort: number;
  readonly platform: 'darwin' | 'win32';
}): string {
  // Windows 上提高 mmap 阈值，减少优化时句柄未释放导致的拒绝访问。
  const memmapThresholdKb = input.platform === 'win32' ? 1_000_000_000 : 20_000;
  return `
service:
  host: ${input.host}
  http_port: ${input.httpPort}
  grpc_port: ${input.httpPort === 0 ? 'null' : input.httpPort + 1}

storage:
  storage_path: ./storage
  wal:
    wal_capacity_mb: 16
    wal_segments_ahead: 0
  optimizers:
    memmap_threshold_kb: ${memmapThresholdKb}
    flush_interval_sec: 5
    max_optimization_threads: 1

log_level: INFO
`;
}
