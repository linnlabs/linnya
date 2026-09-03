/* global Buffer, process, require, setTimeout */

const fs = require('node:fs');

const parentPort = process.parentPort;
if (!parentPort) throw new Error('stdin isolation fixture requires process.parentPort');
const mode = process.argv[2] === 'sandbox' ? 'sandbox' : 'command';

if (mode === 'command') {
  parentPort.postMessage({
    kind: 'command_runner_utility_message',
    generation: process.argv[2],
    transport_message_id: 0,
    payload: { kind: 'command_runner_ready' },
  });
}

// 给 main 足够时间注册 message listener。外层 harness 在此期间保持自己的 stdin
// 打开并写入哨兵；若 Utility 错误继承该 pipe，这次读取会拿到哨兵而不是 EOF。
setTimeout(() => {
  const buffer = Buffer.alloc(128);
  let bytesRead;
  let errorCode;
  try {
    bytesRead = fs.readSync(0, buffer, 0, buffer.byteLength, null);
  } catch (error) {
    errorCode = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'unknown';
  }
  const observation = {
    bytesRead: bytesRead ?? null,
    errorCode: errorCode ?? null,
    stdinIsTTY: process.stdin.isTTY === true,
    observedText: bytesRead ? buffer.subarray(0, bytesRead).toString('utf8') : '',
  };
  if (mode === 'sandbox') {
    parentPort.postMessage(observation);
  } else {
    process.stderr.write(`${JSON.stringify(observation)}\n`);
  }
  setTimeout(() => process.exit(0), 50);
}, 150);
