/* global __dirname, clearTimeout, module, process, require, setTimeout */

const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');

const ACK_DELAY_MS = 2;
const CHILD_TIMEOUT_MS = 30_000;
const EXPECTED_OUTPUT_EVENTS = 128;
const EXPECTED_OUTPUT_EVENT_BYTES = 64 * 1024;
let app;
let utilityProcess;
let runMode;
let publishResult;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createHostRequestBytes() {
  const bytes = new Uint8Array(257);
  for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = index % 251;
  return bytes;
}

function writeStage(stage) {
  process.stdout.write(`LINNYA_UTILITY_RUNNER_STAGE=${stage}\n`);
}

function createDeferred(label) {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const timeout = setTimeout(
    () => rejectPromise(new Error(`${label} timed out`)),
    CHILD_TIMEOUT_MS,
  );
  return {
    promise,
    resolve(value) {
      clearTimeout(timeout);
      resolvePromise(value);
    },
    reject(error) {
      clearTimeout(timeout);
      rejectPromise(error);
    },
  };
}

async function waitForPayloadBeforeExit(deferred, session, label) {
  return Promise.race([
    deferred.promise,
    session.exit.then((exitCode) => {
      throw new Error(`${label} utility exited before payload: code=${exitCode} diagnostic=${session.diagnostic()}`);
    }),
  ]);
}

function waitForUtilityExit(child, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${label} utility exit timed out`)),
      CHILD_TIMEOUT_MS,
    );
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    child.once('error', (type, location, report) => {
      clearTimeout(timeout);
      reject(new Error(`${label} utility fatal error: ${type} ${location} ${report}`));
    });
  });
}

function createUtilitySession({
  childPath,
  scenario,
  onPayload,
  onAcknowledged = () => undefined,
  acknowledgePayload = () => true,
}) {
  const generation = randomUUID();
  const child = utilityProcess.fork(childPath, [scenario, generation], {
    env: {},
    execArgv: [],
    serviceName: `Linnya Utility Runner ${scenario}`,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const exit = waitForUtilityExit(child, scenario);
  const pendingAcknowledgements = new Map();
  let nextMessageId = 0;
  let diagnostic = '';
  let firstFailure;

  child.stderr?.on('data', (chunk) => {
    diagnostic = `${diagnostic}${chunk.toString('utf8')}`.slice(-16_384);
  });

  function fail(error) {
    if (firstFailure) return;
    firstFailure = error instanceof Error ? error : new Error(String(error));
    for (const pending of pendingAcknowledgements.values()) pending.reject(firstFailure);
    pendingAcknowledgements.clear();
  }

  child.on('message', (message) => {
    try {
      if (message?.generation !== generation) {
        throw new Error('utility message belongs to a stale generation');
      }
      if (message.kind === 'transport_ack') {
        const pending = pendingAcknowledgements.get(message.transportMessageId);
        if (!pending) throw new Error(`unexpected utility acknowledgement: ${message.transportMessageId}`);
        pendingAcknowledgements.delete(message.transportMessageId);
        pending.resolve();
        return;
      }
      if (message.kind !== 'transport_message' || !Number.isSafeInteger(message.transportMessageId)) {
        throw new Error('invalid utility transport envelope');
      }

      // ACK 只能在同步校验和分派之后发送，不能把 postMessage 调用本身冒充背压。
      onPayload(message.payload, child);
      if (!acknowledgePayload(message.payload)) return;
      setTimeout(() => {
        try {
          child.postMessage({
            kind: 'transport_ack',
            generation,
            transportMessageId: message.transportMessageId,
          });
          onAcknowledged(message.payload, child);
        } catch (error) {
          fail(error);
        }
      }, ACK_DELAY_MS);
    } catch (error) {
      fail(error);
    }
  });
  exit.then(
    () => {
      if (pendingAcknowledgements.size > 0) {
        fail(new Error(`${scenario} utility exited with unacknowledged host messages`));
      }
    },
    fail,
  );

  return {
    child,
    exit,
    generation,
    diagnostic: () => diagnostic,
    failure: () => firstFailure,
    send(payload) {
      if (firstFailure) return Promise.reject(firstFailure);
      const transportMessageId = nextMessageId;
      nextMessageId += 1;
      const acknowledged = new Promise((resolve, reject) => {
        pendingAcknowledgements.set(transportMessageId, { resolve, reject });
      });
      child.postMessage({
        kind: 'transport_message',
        generation,
        transportMessageId,
        payload,
      });
      return acknowledged;
    },
  };
}

async function runTransportScenario(childPath) {
  writeStage('transport:start');
  const requestBytes = createHostRequestBytes();
  let hostAcknowledgement;
  let terminal;
  let outputBytes = 0;
  let lastOutputSequence = -1;
  const readyEvent = createDeferred('transport utility ready');
  const completed = createDeferred('transport terminal event');
  const session = createUtilitySession({
    childPath,
    scenario: 'transport',
    onPayload(payload) {
      if (payload?.kind === 'utility_ready') {
        return;
      }
      if (payload?.kind === 'host_probe_accepted') {
        hostAcknowledgement = payload;
        return;
      }
      if (payload?.kind === 'runner_output') {
        const bytes = payload.bytes;
        if (!(bytes instanceof Uint8Array)) throw new Error('runner output bytes lost Uint8Array identity');
        if (payload.outputSequence !== lastOutputSequence + 1) {
          throw new Error('runner output sequence is not contiguous');
        }
        if (bytes.byteLength !== EXPECTED_OUTPUT_EVENT_BYTES || digest(bytes) !== payload.sha256) {
          throw new Error('runner output byte ownership changed in transit');
        }
        lastOutputSequence = payload.outputSequence;
        outputBytes += bytes.byteLength;
        return;
      }
      if (payload?.kind !== 'runner_terminal') throw new Error(`unknown utility event: ${payload?.kind}`);
      terminal = payload;
      completed.resolve(payload);
    },
    onAcknowledged(payload) {
      if (payload?.kind === 'utility_ready') readyEvent.resolve(payload);
    },
  });

  const readyPayload = await waitForPayloadBeforeExit(readyEvent, session, 'transport ready');
  await session.send({ kind: 'host_probe', bytes: requestBytes });
  await waitForPayloadBeforeExit(completed, session, 'transport terminal');
  const exitCode = await session.exit;
  if (session.failure()) throw session.failure();
  if (exitCode !== 0) throw new Error(`transport utility exited ${exitCode}: ${session.diagnostic()}`);
  if (!readyPayload.hasParentPort || readyPayload.electronRunAsNode !== null) {
    throw new Error(`utility runtime boundary mismatch: ${JSON.stringify(readyPayload)}`);
  }
  if (hostAcknowledgement?.byteLength !== requestBytes.byteLength
    || hostAcknowledgement.sha256 !== digest(requestBytes)) {
    throw new Error('host request acknowledgement did not preserve bytes');
  }
  if (lastOutputSequence !== EXPECTED_OUTPUT_EVENTS - 1
    || outputBytes !== EXPECTED_OUTPUT_EVENTS * EXPECTED_OUTPUT_EVENT_BYTES
    || terminal?.outputEventCount !== EXPECTED_OUTPUT_EVENTS
    || terminal?.outputBytes !== outputBytes
    || terminal?.maxInFlightEvents !== 1) {
    throw new Error(`transport result mismatch: ${JSON.stringify({ lastOutputSequence, outputBytes, terminal })}`);
  }
  writeStage('transport:passed');
  return {
    utilityPid: readyPayload.pid,
    utilityExecPath: readyPayload.execPath,
    hostRequestBytes: requestBytes.byteLength,
    outputEvents: terminal.outputEventCount,
    outputBytes: terminal.outputBytes,
    maxInFlightEvents: terminal.maxInFlightEvents,
    exitCode,
  };
}

async function runExitBeforeReadyScenario(childPath) {
  writeStage('exit-before-ready:start');
  let messageCount = 0;
  const session = createUtilitySession({
    childPath,
    scenario: 'exit-before-ready',
    onPayload() { messageCount += 1; },
  });
  const exitCode = await session.exit;
  if (session.failure()) throw session.failure();
  if (exitCode !== 42 || messageCount !== 0) {
    throw new Error(`ready-before-exit result mismatch: ${JSON.stringify({ exitCode, messageCount })}`);
  }
  writeStage('exit-before-ready:passed');
  return { exitCode, messageCount };
}

async function runAcknowledgementTimeoutScenario(childPath) {
  writeStage('ack-timeout:start');
  let ready;
  let outputEvents = 0;
  const readyEvent = createDeferred('ack-timeout utility ready');
  const session = createUtilitySession({
    childPath,
    scenario: 'ack-timeout',
    onPayload(payload) {
      if (payload?.kind === 'utility_ready') {
        ready = payload;
      }
      if (payload?.kind === 'runner_output') outputEvents += 1;
    },
    acknowledgePayload(payload) {
      return payload?.kind !== 'runner_output';
    },
    onAcknowledged(payload) {
      if (payload?.kind === 'utility_ready') readyEvent.resolve(payload);
    },
  });
  await waitForPayloadBeforeExit(readyEvent, session, 'ack-timeout ready');
  await session.send({ kind: 'host_probe', bytes: createHostRequestBytes() });
  const exitCode = await session.exit;
  const diagnosticObserved = session.diagnostic().includes('host acknowledgement timed out');
  if (exitCode !== 1 || outputEvents !== 1) {
    throw new Error(`ack-timeout result mismatch: ${JSON.stringify({ exitCode, outputEvents })}`);
  }
  writeStage('ack-timeout:passed');
  return { utilityPid: ready.pid, exitCode, outputEvents, diagnosticObserved };
}

async function runKillDuringOutputScenario(childPath) {
  writeStage('kill-during-output:start');
  let ready;
  let outputEvents = 0;
  let terminalSeen = false;
  let killAccepted = false;
  const readyEvent = createDeferred('kill utility ready');
  const session = createUtilitySession({
    childPath,
    scenario: 'kill-during-output',
    onPayload(payload, child) {
      if (payload?.kind === 'utility_ready') {
        ready = payload;
      }
      if (payload?.kind === 'runner_output') {
        outputEvents += 1;
        killAccepted = child.kill();
      }
      if (payload?.kind === 'runner_terminal') terminalSeen = true;
    },
    acknowledgePayload(payload) {
      return payload?.kind !== 'runner_output';
    },
    onAcknowledged(payload) {
      if (payload?.kind === 'utility_ready') readyEvent.resolve(payload);
    },
  });
  await waitForPayloadBeforeExit(readyEvent, session, 'kill ready');
  await session.send({ kind: 'host_probe', bytes: createHostRequestBytes() });
  const exitCode = await session.exit;
  if (!killAccepted || outputEvents !== 1 || terminalSeen) {
    throw new Error(`kill-during-output result mismatch: ${JSON.stringify({ killAccepted, outputEvents, terminalSeen })}`);
  }
  writeStage('kill-during-output:passed');
  return { utilityPid: ready.pid, killAccepted, outputEvents, terminalSeen, exitCode };
}

async function runOwnerCrashScenario(childPath) {
  writeStage('owner-crash:start');
  const readyEvent = createDeferred('owner-crash utility ready');
  const session = createUtilitySession({
    childPath,
    scenario: 'hold',
    onPayload(payload) {
      if (payload?.kind !== 'utility_ready') throw new Error(`unknown owner-crash event: ${payload?.kind}`);
    },
    onAcknowledged(payload) {
      if (payload?.kind === 'utility_ready') readyEvent.resolve(payload);
    },
  });
  const readyPayload = await waitForPayloadBeforeExit(readyEvent, session, 'owner-crash ready');
  publishResult({
    success: true,
    status: 'ready_for_owner_crash',
    version: 1,
    platform: process.platform,
    architecture: process.arch,
    electron: process.versions.electron,
    mainPid: process.pid,
    utilityPid: readyPayload.pid,
    packaged: app.isPackaged,
    electronProcesses: app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
    })),
  });
  writeStage('owner-crash:ready');
  await session.exit;
  throw new Error('owner-crash utility exited before its Electron main owner');
}

async function run() {
  const childPath = path.join(__dirname, 'utility-child.cjs');
  if (runMode === 'owner-crash') return runOwnerCrashScenario(childPath);

  const result = {
    success: true,
    status: 'completed',
    version: 1,
    platform: process.platform,
    architecture: process.arch,
    electron: process.versions.electron,
    mainPid: process.pid,
    appPath: app.getAppPath(),
    packaged: app.isPackaged,
    transport: await runTransportScenario(childPath),
    exitBeforeReady: await runExitBeforeReadyScenario(childPath),
    acknowledgementTimeout: await runAcknowledgementTimeoutScenario(childPath),
    killDuringOutput: await runKillDuringOutputScenario(childPath),
  };
  publishResult(result);
  process.stdout.write(`LINNYA_UTILITY_RUNNER_RESULT=${JSON.stringify(result)}\n`);
}

module.exports = {
  async runPackagedUtilityRunnerValidation(input) {
    app = input.app;
    utilityProcess = input.utilityProcess;
    runMode = input.runMode;
    publishResult = input.publishResult;
    return run();
  },
};
