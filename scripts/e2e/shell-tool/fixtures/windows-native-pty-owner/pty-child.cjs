/* global Buffer, __filename, clearInterval, process, require, setInterval, setTimeout */

const { appendFileSync, existsSync, writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');

const mode = process.argv[2];

function waitForFile(pathname, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (existsSync(pathname)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error(`等待文件超时：${pathname}`));
      }
    }, 20);
  });
}

if (mode === '--write-marker') {
  writeFileSync(process.argv[3], 'user-code-ran');
} else if (mode === '--quiet-input') {
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', value => {
    process.stdin.pause();
    process.stdout.write(
      `INPUT_HEX:${Buffer.from(value).toString('hex')}\n`,
      () => process.exit(17),
    );
  });
  process.stdin.resume();
} else if (mode === '--wait-eof') {
  process.stdin.resume();
  process.stdin.on('end', () => {
    process.stdout.write('EOF_OBSERVED\n', () => process.exit(19));
  });
} else if (mode === '--resize') {
  process.stdout.write(`SIZE_BEFORE:${process.stdout.columns}x${process.stdout.rows}\n`);
  process.stdin.once('data', () => {
    setTimeout(() => {
      process.stdin.pause();
      process.stdout.write(
        `SIZE_AFTER:${process.stdout.columns}x${process.stdout.rows}\n`,
        () => process.exit(21),
      );
    }, 100);
  });
  process.stdin.resume();
} else if (mode === '--byte-output') {
  const payload = Buffer.from([
    0x41, 0x00, 0x42, 0xff, 0xc3, 0x28, 0xe4, 0xb8, 0xad, 0x1b, 0x5b, 0x33, 0x31,
    0x6d, 0x52, 0x1b, 0x5b, 0x30, 0x6d,
  ]);
  process.stdout.write(Buffer.from('BYTE_BEGIN\n'));
  process.stdout.write(payload);
  process.stdout.write(Buffer.from('\nBYTE_END\n'));
  process.exitCode = 23;
} else if (mode === '--large-output') {
  const chunk = Buffer.alloc(64 * 1024, 0x4f);
  let remaining = 16 * 1024 * 1024;
  process.stdout.write('BEGIN_16M\n');
  function write() {
    while (remaining > 0) {
      const next = Math.min(chunk.length, remaining);
      remaining -= next;
      if (!process.stdout.write(chunk.subarray(0, next))) {
        process.stdout.once('drain', write);
        return;
      }
    }
    process.stdout.write('\nEND_16M\n', () => process.exit(29));
  }
  write();
} else if (mode === '--heartbeat') {
  const heartbeat = process.argv[3];
  appendFileSync(heartbeat, 'ready');
  setInterval(() => appendFileSync(heartbeat, 'x'), 40);
} else if (mode === '--detached-descendant') {
  const heartbeat = process.argv[3];
  const child = spawn(process.execPath, [__filename, '--heartbeat', heartbeat], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  waitForFile(heartbeat).then(() => {
    process.stdout.write(`DETACHED_READY:${child.pid}\n`);
    process.exitCode = 31;
  }).catch(error => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
} else if (mode === '--never-read') {
  setInterval(() => undefined, 1_000);
} else if (mode === '--exit-23') {
  process.stdout.write('TAIL_MARKER\n');
  process.exitCode = 23;
} else {
  throw new Error(`未知 PTY child mode：${String(mode)}`);
}
