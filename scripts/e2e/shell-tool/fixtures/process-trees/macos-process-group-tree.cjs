/* global __filename, require */

const { spawn } = require('node:child_process');
const {
  appendFileSync,
  existsSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const {
  clearInterval,
  setInterval,
  setTimeout,
} = require('node:timers');

const [runRoot, runToken, mode = 'cooperative', role = 'parent'] = process.argv.slice(2);

if (!runRoot || !runToken) {
  throw new Error('macOS process-group fixture requires run root and run token');
}

const nextRole = role === 'parent' ? 'child' : role === 'child' ? 'grandchild' : undefined;
const heartbeatPath = path.join(runRoot, `${role}.heartbeat.log`);
const identityPath = path.join(runRoot, `${role}.json`);
let heartbeatSequence = 0;

writeFileSync(identityPath, JSON.stringify({
  version: 1,
  runToken,
  role,
  pid: process.pid,
}), 'utf8');
process.stdout.write(`${role}:stdout\n`);
process.stderr.write(`${role}:stderr\n`);

const heartbeat = setInterval(() => {
  heartbeatSequence += 1;
  try {
    appendFileSync(
      heartbeatPath,
      `${runToken}\t${role}\t${process.pid}\t${heartbeatSequence}\t${Date.now()}\n`,
      'utf8',
    );
  } catch {
    // 测试目录若被错误地提前删除，进程仍保持存活，让外层 PID/PGID 验真暴露顺序错误。
  }
}, 40);

function stopCurrentRole(exitCode = 0) {
  clearInterval(heartbeat);
  process.exit(exitCode);
}

if (mode === 'ignore-term' && role === 'grandchild') {
  process.on('SIGTERM', () => {});
} else {
  process.on('SIGTERM', () => stopCurrentRole());
}

if (!nextRole) {
  if (mode === 'natural') setTimeout(() => stopCurrentRole(), 160);
} else {
  const isolatesChildSession = mode === 'escape-session' && role === 'parent';
  const childDoesNotOwnRootPipes = mode === 'root-exit' || mode === 'escape-session';
  const child = spawn(process.execPath, [
    __filename,
    runRoot,
    runToken,
    mode,
    nextRole,
  ], {
    detached: isolatesChildSession,
    stdio: childDoesNotOwnRootPipes
      ? ['ignore', 'ignore', 'ignore']
      : ['ignore', 'inherit', 'inherit'],
  });

  child.once('error', (error) => {
    process.stderr.write(`${role} failed to spawn ${nextRole}: ${error.message}\n`);
    stopCurrentRole(31);
  });

  if (mode === 'natural') {
    child.once('close', () => stopCurrentRole(role === 'parent' ? 7 : 0));
  } else if (mode === 'root-exit' && role === 'parent') {
    const grandchildIdentityPath = path.join(runRoot, 'grandchild.json');
    const readiness = setInterval(() => {
      if (!existsSync(grandchildIdentityPath)) return;
      clearInterval(readiness);
      // 先让外层观察到父进程的持续心跳，再制造“根进程已退出、后代仍存活”。
      setTimeout(() => stopCurrentRole(23), 120);
    }, 20);
  }
}
