/* global Buffer, process, require, setImmediate, setTimeout */

const fs = require('node:fs');
const path = require('node:path');

const runToken = process.argv[2];
const identityPath = process.argv[3];

if (!runToken || !identityPath || !path.isAbsolute(identityPath)) {
  throw new Error('interactive CLI requires a run token and an absolute identity path');
}

const pendingIdentityPath = `${identityPath}.${process.pid}.pending`;
fs.mkdirSync(path.dirname(identityPath), { recursive: true });
fs.writeFileSync(pendingIdentityPath, JSON.stringify({
  version: 1,
  runToken,
  pid: process.pid,
  parentPid: process.ppid,
}), 'utf8');
fs.renameSync(pendingIdentityPath, identityPath);

process.stdin.setRawMode(true);
process.stdin.resume();
const safetyTranscriptFragments = [
  Buffer.from('\u001b'),
  Buffer.from(']2;PC53_PTY_TITLE_SECRET'),
  Buffer.from('\u0007\u001b]52;c;PC53_PTY_CLIPBOARD_SECRET'),
  Buffer.from('\u0007\u001b]8;;https://pc53.invalid/secret\u001b'),
  Buffer.from('\\SAFE_LINK_TEXT\u001b]8;;\u001b\\'),
  Buffer.from('\u001b]9;PC53_PTY_NOTIFICATION_SECRET\u0007'),
  Buffer.from('\u001b]1337;File=name=PC53_PTY_IMAGE_SECRET:AAAA\u0007\u001b'),
  Buffer.from('PPC53_PTY_DCS_SECRET\u001b\\'),
  Buffer.from('\u001b[31mERASED_RED_TEXT\u001b[0m\u001b[2J\u001b[HPTY_SCREEN_SAFE_'),
  Buffer.from([0xe4]),
  Buffer.from([0xb8, 0xad]),
  Buffer.from('\r\n'),
];

function writeSafetyTranscriptFragments() {
  for (const fragment of safetyTranscriptFragments) process.stdout.write(fragment);
  process.stdout.write(
    `PTY_READY:${process.stdin.isTTY === true}:${process.stdout.isTTY === true}\r\nPTY_PROMPT> `,
  );
}

// 明确慢于 shell 的 250ms initial wait，证明 Agent 会按 cursor 继续观察 READY，
// 而不是把开发机上通常很快的启动时机固化成生产合同。
setTimeout(() => {
  writeSafetyTranscriptFragments();
}, 350);

let pendingInput = '';
process.stdin.on('data', (chunk) => {
  for (const byte of chunk) {
    if (byte === 0x04) {
      process.stdout.write('PTY_EOF_NATURAL_EXIT', () => process.exit(0));
      return;
    }
    if (byte === 0x0d || byte === 0x0a) {
      process.stdout.write(`SUBMIT_OK:${pendingInput}`);
      pendingInput = '';
      continue;
    }
    pendingInput += Buffer.from([byte]).toString('utf8');
  }
});

process.on('SIGWINCH', () => {
  setImmediate(() => {
    process.stdout.write(`PTY_SIZE:${process.stdout.columns}x${process.stdout.rows}`);
  });
});
