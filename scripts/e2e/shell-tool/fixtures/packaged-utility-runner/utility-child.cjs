/* global clearTimeout, process, require, setInterval, setTimeout */

const { createHash } = require('node:crypto');

const parentPort = process.parentPort;
if (!parentPort) throw new Error('packaged utility child requires process.parentPort');

const scenario = process.argv[2];
const generation = process.argv[3];
const OUTPUT_EVENT_COUNT = 128;
const OUTPUT_EVENT_BYTES = 64 * 1024;
const ACK_TIMEOUT_MS = scenario === 'ack-timeout' ? 300 : 10_000;
const pendingAcknowledgements = new Map();
let hostRequestAccepted = false;
let nextMessageId = 0;
let inFlightEvents = 0;
let maxInFlightEvents = 0;

if (!scenario || !generation) throw new Error('utility child requires scenario and generation');
if (scenario === 'exit-before-ready') process.exit(42);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createOutputBytes(sequence) {
  const bytes = new Uint8Array(OUTPUT_EVENT_BYTES);
  bytes.fill(sequence % 251);
  return bytes;
}

function waitForAcknowledgement(transportMessageId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAcknowledgements.delete(transportMessageId);
      reject(new Error(`host acknowledgement timed out: ${transportMessageId}`));
    }, ACK_TIMEOUT_MS);
    pendingAcknowledgements.set(transportMessageId, () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function sendToHost(payload) {
  const transportMessageId = nextMessageId;
  nextMessageId += 1;
  inFlightEvents += 1;
  maxInFlightEvents = Math.max(maxInFlightEvents, inFlightEvents);
  const acknowledged = waitForAcknowledgement(transportMessageId);
  parentPort.postMessage({
    kind: 'transport_message',
    generation,
    transportMessageId,
    payload,
  });
  await acknowledged;
  inFlightEvents -= 1;
}

async function runTransportProbe(request) {
  const requestBytes = request.bytes;
  await sendToHost({
    kind: 'host_probe_accepted',
    byteLength: requestBytes.byteLength,
    sha256: digest(requestBytes),
  });

  for (let index = 0; index < OUTPUT_EVENT_COUNT; index += 1) {
    const bytes = createOutputBytes(index);
    await sendToHost({
      kind: 'runner_output',
      outputSequence: index,
      bytes,
      sha256: digest(bytes),
    });
  }
  await sendToHost({
    kind: 'runner_terminal',
    outputEventCount: OUTPUT_EVENT_COUNT,
    outputBytes: OUTPUT_EVENT_COUNT * OUTPUT_EVENT_BYTES,
    maxInFlightEvents,
  });
  process.exit(0);
}

function acceptHostPayload(payload) {
  if (payload?.kind !== 'host_probe' || hostRequestAccepted) {
    throw new Error('utility child accepts exactly one host probe');
  }
  if (!(payload.bytes instanceof Uint8Array)) {
    throw new Error('host request bytes did not preserve Uint8Array');
  }
  hostRequestAccepted = true;
  void runTransportProbe(payload).catch((error) => {
    process.stderr.write(`[utility-child] ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}

parentPort.on('message', (event) => {
  const message = event.data;
  if (message?.generation !== generation) {
    throw new Error('host message belongs to a stale generation');
  }
  if (message.kind === 'transport_ack') {
    const resolve = pendingAcknowledgements.get(message.transportMessageId);
    if (!resolve) throw new Error(`unexpected host acknowledgement: ${message.transportMessageId}`);
    pendingAcknowledgements.delete(message.transportMessageId);
    resolve();
    return;
  }
  if (message.kind !== 'transport_message' || !Number.isSafeInteger(message.transportMessageId)) {
    throw new Error('invalid host transport envelope');
  }

  // 请求 ACK 表示载荷已经同步完成校验和分派，不表示命令已经结束。
  acceptHostPayload(message.payload);
  parentPort.postMessage({
    kind: 'transport_ack',
    generation,
    transportMessageId: message.transportMessageId,
  });
});

void sendToHost({
  kind: 'utility_ready',
  pid: process.pid,
  hasParentPort: true,
  execPath: process.execPath,
  electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
}).then(() => {
  if (scenario === 'hold') setInterval(() => undefined, 1_000);
}).catch((error) => {
  process.stderr.write(`[utility-child] ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
