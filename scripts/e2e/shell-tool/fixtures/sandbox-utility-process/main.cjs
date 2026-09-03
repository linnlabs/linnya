const { app, utilityProcess } = require('electron');
const { writeFileSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const generation = process.env.LINNYA_SANDBOX_E2E_GENERATION;
const runToken = process.env.LINNYA_SANDBOX_E2E_RUN_TOKEN;
const runDirectory = process.env.LINNYA_SANDBOX_E2E_RUN_DIRECTORY;
const utilityPath = process.env.LINNYA_SANDBOX_E2E_UTILITY_PATH;
const evaluatorPath = process.env.LINNYA_SANDBOX_E2E_EVALUATOR_PATH;
const nodeExecutable = process.env.LINNYA_SANDBOX_E2E_NODE_EXECUTABLE;
const scenario = process.env.LINNYA_SANDBOX_E2E_SCENARIO;

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stringEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
  );
}

async function run() {
  await app.whenReady();
  const child = utilityProcess.fork(
    required(utilityPath, 'utilityPath'),
    [
      required(generation, 'generation'),
      JSON.stringify({ schema_version: 1, platform: 'darwin' }),
    ],
    {
      env: stringEnvironment(),
      execArgv: [],
      serviceName: 'Linnya Sandbox Utility E2E',
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  const stderrChunks = [];
  child.stderr?.on('data', chunk => stderrChunks.push(Buffer.from(chunk)));
  const frames = [];
  const hostAcknowledgements = [];
  let terminal;
  let started = false;

  function postHostPayload(messageId, payload) {
    child.postMessage({
      kind: 'sandbox_utility_message',
      generation,
      messageId,
      payload,
    });
  }

  function startPayload() {
    return {
      kind: 'sandbox_start',
      runToken,
      runDirectory,
      timeoutMs: 10_000,
      idleTimeoutMs: 12_000,
      maximumHeapMb: 64,
      evaluator: {
        executablePath: required(nodeExecutable, 'nodeExecutable'),
        entryPath: required(evaluatorPath, 'evaluatorPath'),
        environment: {},
      },
    };
  }

  const exit = new Promise((resolve, reject) => {
    child.once('error', (type, location) => {
      reject(new Error(`sandbox utility fatal error: ${type} at ${location}`));
    });
    child.once('exit', code => resolve(code));
  });

  child.on('message', envelope => {
    if (envelope?.generation !== generation) return;
    if (envelope.kind === 'sandbox_utility_ack') {
      hostAcknowledgements.push(envelope.messageId);
      return;
    }
    if (envelope.kind !== 'sandbox_utility_message') {
      throw new Error('sandbox utility returned an invalid envelope');
    }
    const payload = envelope.payload;
    if (payload?.kind === 'sandbox_utility_ready') {
      if (started) throw new Error('sandbox utility published ready twice');
      started = true;
      if (scenario === 'ready_ack_timeout') return;
      child.postMessage({
        kind: 'sandbox_utility_ack',
        generation,
        messageId: envelope.messageId,
      });
      if (scenario === 'cancel_before_start') {
        postHostPayload(0, { kind: 'sandbox_cancel', runToken });
        postHostPayload(1, startPayload());
        return;
      }
      if (scenario === 'owner_end_before_start') {
        postHostPayload(0, { kind: 'sandbox_owner_end' });
        // 紧跟的 start 与 owner-end 处于同一事件循环，不能重新打开执行入口。
        postHostPayload(1, startPayload());
        return;
      }
      postHostPayload(0, startPayload());
      return;
    }
    if (payload?.kind === 'sandbox_evaluator_frame') {
      frames.push(payload);
      if (scenario === 'identity_observation' && payload.frame === 'started') {
        writeFileSync(path.join(runDirectory, 'identity.json'), JSON.stringify({
          mainPid: process.pid,
          utilityPid: child.pid,
          evaluatorPid: payload.evaluatorPid,
        }));
      }
    } else if (payload?.kind === 'sandbox_terminal') {
      terminal = payload;
    } else {
      throw new Error('sandbox utility returned an invalid payload');
    }
    // 测试控制器也必须先验证再 ACK，不能确认一条自己尚未理解的坏消息。
    child.postMessage({
      kind: 'sandbox_utility_ack',
      generation,
      messageId: envelope.messageId,
    });
  });

  const timeout = new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('sandbox utility E2E timed out')), 30_000);
  });
  const exitCode = await Promise.race([exit, timeout]);
  const result = await readFile(`${runDirectory}/result.json`, 'utf8')
    .then(text => JSON.parse(text))
    .catch(error => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
  process.stdout.write(`${JSON.stringify({
    exitCode,
    hostAcknowledgements,
    frames,
    terminal,
    result,
    utilityStderr: Buffer.concat(stderrChunks).toString('utf8'),
  })}\n`);
  app.exit(0);
}

void run().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
