/* global process, setTimeout */

process.stdout.write('LINNYA_PTY_BLOCKED_READY\r\n');

// 故意不读取 stdin，用真实内核 PTY 缓冲证明 node-pty 公共 write() 的接纳语义。
setTimeout(() => process.exit(0), 30_000);
