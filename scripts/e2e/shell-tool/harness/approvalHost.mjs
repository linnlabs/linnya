import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import readline from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const fixturePath = process.env.LINNYA_APPROVAL_HARNESS_HOST_FIXTURE
  ?? fileURLToPath(new URL('../fixtures/approval/approval-host.mjs', import.meta.url));

export function startApprovalHost({
  approvalMemoryRoot,
  persistenceFailureRequestId,
  persistenceBarrierRequestId,
}) {
  const nodeArguments = process.env.LINNYA_APPROVAL_HARNESS_BUNDLED === '1'
    ? [fixturePath]
    : ['--import', 'tsx', fixturePath];
  const child = spawn(process.execPath, nodeArguments, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LINNYA_APPROVAL_HARNESS_MEMORY_ROOT: approvalMemoryRoot,
      ...(persistenceFailureRequestId
        ? { LINNYA_APPROVAL_HARNESS_FAIL_PERSIST_REQUEST_ID: persistenceFailureRequestId }
        : {}),
      ...(persistenceBarrierRequestId
        ? { LINNYA_APPROVAL_HARNESS_BARRIER_REQUEST_ID: persistenceBarrierRequestId }
        : {}),
    },
  });
  const pendingMessages = new Map();
  let closeOutcome;
  let protocolError;
  let stderr = '';

  const closePromise = new Promise(resolve => {
    child.once('close', (code, signal) => {
      closeOutcome = { code, signal };
      resolve(closeOutcome);
    });
  });

  function rejectPending(error) {
    for (const { reject, timeout } of pendingMessages.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    pendingMessages.clear();
  }

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderr = `${stderr}${chunk}`.slice(-32_768);
  });
  child.once('close', (code, signal) => {
    rejectPending(new Error(
      `approval host closed before reply: code=${code} signal=${signal ?? 'none'}`,
    ));
  });
  child.once('error', error => {
    rejectPending(error);
  });
  child.stdin.on('error', error => rejectPending(error));

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', line => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      protocolError = new Error(`approval host emitted invalid JSONL: ${line}`, { cause: error });
      rejectPending(protocolError);
      child.kill('SIGKILL');
      return;
    }
    const pendingMessage = pendingMessages.get(message.message_id);
    if (!pendingMessage) return;
    pendingMessages.delete(message.message_id);
    clearTimeout(pendingMessage.timeout);
    pendingMessage.resolve(message);
  });

  function send(message) {
    if (closeOutcome) {
      return Promise.reject(new Error('approval host already closed'));
    }
    const messageId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingMessages.delete(messageId);
        reject(new Error('approval host reply timed out'));
      }, 10_000);
      pendingMessages.set(messageId, { resolve, reject, timeout });
      child.stdin.write(
        `${JSON.stringify({ message_id: messageId, ...message })}\n`,
        error => {
          if (!error) return;
          const pendingMessage = pendingMessages.get(messageId);
          if (!pendingMessage) return;
          pendingMessages.delete(messageId);
          clearTimeout(pendingMessage.timeout);
          pendingMessage.reject(error);
        },
      );
    });
  }

  let teardownPromise;
  return {
    pid: child.pid,
    send,
    teardown() {
      teardownPromise ??= (async () => {
        let ownerEndError;
        if (!closeOutcome) {
          try {
            await send({ type: 'end_owner' });
          } catch (error) {
            ownerEndError = error;
          } finally {
            child.stdin.end();
          }
        }
        if (!closeOutcome) {
          const closedBeforeTimeout = await new Promise(resolve => {
            const timeout = setTimeout(() => resolve(false), 5_000);
            void closePromise.then(() => {
              clearTimeout(timeout);
              resolve(true);
            });
          });
          if (!closedBeforeTimeout && !closeOutcome) {
            child.kill('SIGKILL');
            await closePromise;
            throw new Error(`approval host teardown timed out: ${stderr.trim()}`);
          }
        }
        if (protocolError) throw protocolError;
        if (ownerEndError) throw ownerEndError;
        if (closeOutcome?.code !== 0) {
          throw new Error(
            `approval host exited unexpectedly: code=${closeOutcome?.code} stderr=${stderr.trim()}`,
          );
        }
      })();
      return teardownPromise;
    },
  };
}
