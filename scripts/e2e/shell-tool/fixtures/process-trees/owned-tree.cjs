/* global __filename, require */

const { spawn } = require('node:child_process');
const {
  appendFileSync,
  closeSync,
  openSync,
  writeFileSync,
} = require('node:fs');
const process = require('node:process');
const {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} = require('node:timers');

const [
  evidencePath,
  startupEvidencePath,
  heartbeatPrefix,
  runToken,
  terminationMode = 'cooperative',
  role = 'parent',
  expectedParentPid,
] = process.argv.slice(2);

if (!evidencePath || !startupEvidencePath || !heartbeatPrefix || !runToken) {
  throw new Error('owned-tree fixture requires evidence, heartbeat and run identity paths');
}

function startHeartbeat(currentRole) {
  const heartbeatPath = `${heartbeatPrefix}.${currentRole}.log`;
  let sequence = 0;
  const heartbeat = () => {
    sequence += 1;
    try {
      appendFileSync(
        heartbeatPath,
        `${runToken}\t${currentRole}\t${process.pid}\t${sequence}\t${Date.now()}\n`,
        'utf8',
      );
    } catch {
      // 目录若被错误地提前删除，fixture 仍保持存活，让外层 PID 检查暴露收尾顺序错误。
    }
  };
  const timer = setInterval(heartbeat, 50);
  heartbeat();
  return timer;
}

function configureTermination(currentRole) {
  const ignoresTerm = terminationMode === 'ignore-term'
    || (terminationMode === 'child-ignore-term' && currentRole === 'child');
  if (ignoresTerm && process.platform !== 'win32') {
    process.on('SIGTERM', () => {});
    return;
  }
  process.on('SIGTERM', () => process.exit(0));
}

function runChild() {
  const parentPid = Number(expectedParentPid);
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || typeof process.send !== 'function') {
    process.exit(23);
  }

  let acknowledged = false;
  const acknowledgementTimeout = setTimeout(() => process.exit(24), 5_000);
  process.once('disconnect', () => {
    if (!acknowledged) process.exit(25);
  });
  process.on('message', (message) => {
    if (
      acknowledged
      || message?.type !== 'startup_ack'
      || message.runToken !== runToken
    ) return;
    acknowledged = true;
    clearTimeout(acknowledgementTimeout);
    configureTermination('child');
    startHeartbeat('child');
  });
  process.send({
    type: 'child_started',
    version: 1,
    runToken,
    parentPid,
    childPid: process.pid,
  }, error => {
    if (error && !acknowledged) process.exit(26);
  });
}

function runParent() {
  const heartbeatTimer = startHeartbeat('parent');
  configureTermination('parent');

  let startupEvidenceFd;
  try {
    // 证据通道必须在 child 存在前预留；预留失败时不得创建未知子进程。
    startupEvidenceFd = openSync(startupEvidencePath, 'wx');
  } catch (error) {
    process.stderr.write(`failed to reserve startup evidence: ${error.message}\n`);
    clearInterval(heartbeatTimer);
    process.exitCode = 21;
    return;
  }

  let child;
  try {
    child = spawn(process.execPath, [
      __filename,
      evidencePath,
      startupEvidencePath,
      heartbeatPrefix,
      runToken,
      terminationMode,
      'child',
      String(process.pid),
    ], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
  } catch (error) {
    closeSync(startupEvidenceFd);
    process.stderr.write(`failed to spawn child fixture: ${error.message}\n`);
    clearInterval(heartbeatTimer);
    process.exitCode = 22;
    return;
  }

  let identityPublished = false;
  let stopping = false;

  function stopChildBeforeParentFailure(message) {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`${message}\n`);
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), 500);
    child.once('close', () => {
      clearTimeout(forceTimer);
      process.exitCode = 27;
      clearInterval(heartbeatTimer);
    });
    child.kill('SIGTERM');
  }

  child.once('error', (error) => {
    if (startupEvidenceFd !== undefined) {
      closeSync(startupEvidenceFd);
      startupEvidenceFd = undefined;
    }
    stopChildBeforeParentFailure(`failed to spawn child fixture: ${error.message}`);
  });
  child.once('close', () => {
    if (stopping) return;
    if (startupEvidenceFd !== undefined) {
      closeSync(startupEvidenceFd);
      startupEvidenceFd = undefined;
    }
    clearInterval(heartbeatTimer);
    process.exitCode = identityPublished ? 28 : 29;
  });

  child.on('message', (message) => {
    if (identityPublished || stopping) return;
    const validIdentity = message?.type === 'child_started'
      && message.version === 1
      && message.runToken === runToken
      && message.parentPid === process.pid
      && message.childPid === child.pid;
    if (!validIdentity) {
      stopChildBeforeParentFailure('child fixture published invalid identity');
      return;
    }

    const evidence = {
      version: 1,
      runToken,
      parentPid: process.pid,
      childPid: child.pid,
    };
    try {
      writeFileSync(startupEvidenceFd, JSON.stringify(evidence), 'utf8');
      closeSync(startupEvidenceFd);
      startupEvidenceFd = undefined;
      identityPublished = true;

      if (terminationMode === 'parent-exit-before-ready') {
        clearInterval(heartbeatTimer);
        process.exit(30);
      }

      writeFileSync(evidencePath, JSON.stringify(evidence), 'utf8');
      child.send({ type: 'startup_ack', runToken }, error => {
        if (error) stopChildBeforeParentFailure(`failed to acknowledge child: ${error.message}`);
      });
      if (terminationMode === 'fail-after-child-start') {
        stopChildBeforeParentFailure('intentional failure after child start');
      }
    } catch (error) {
      if (startupEvidenceFd !== undefined) {
        closeSync(startupEvidenceFd);
        startupEvidenceFd = undefined;
      }
      stopChildBeforeParentFailure(`failed to publish process evidence: ${error.message}`);
    }
  });
}

if (role === 'child') runChild();
else runParent();
