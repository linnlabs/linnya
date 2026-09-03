import {
  SANDBOX_CONTROL_PROTOCOL_VERSION,
  type SandboxControlFrameKind,
} from '../../../../../features/sandbox/runners/local-process/definitions/sandboxControlProtocol.js';
import {
  parseSandboxRunToken,
  SANDBOX_MAILBOX_PROTOCOL_VERSION,
} from '../../../../../features/sandbox/runners/local-process/definitions/sandboxMailboxProtocol.js';
import {
  parseSandboxHeapLimitMb,
} from '../../../../../features/sandbox/runners/local-process/definitions/sandboxRuntimeLimits.js';
import {
  serializeSandboxControlFrame,
} from '../../../../../features/sandbox/runners/local-process/functions/createSandboxControlFrameStateMachine.js';
import {
  publishSandboxResultMailbox,
  readSandboxRequestMailbox,
} from '../../../../../features/sandbox/runners/local-process/functions/sandboxMailboxFiles.js';
import {
  evaluateSandboxRunnerRequest,
} from '../../../../../features/sandbox/runner-evaluation/functions/evaluateSandboxRunnerRequest.js';

const SANDBOX_EVALUATOR_INVALID_REQUEST_EXIT_CODE = 2;

interface SandboxEvaluatorInvocation {
  readonly runToken: string;
  readonly maximumHeapMb: number;
}

void runSandboxEvaluatorProcess(process.argv).then(
  () => exitSandboxEvaluatorProcess(0),
  error => exitSandboxEvaluatorProcess(
    error instanceof SandboxEvaluatorInvocationError
      ? SANDBOX_EVALUATOR_INVALID_REQUEST_EXIT_CODE
      : 1,
    error instanceof SandboxEvaluatorInvocationError
      ? 'sandbox.evaluator.invalid_request\n'
      : `sandbox.evaluator.failure:${readStableFailureCode(error)}\n`,
  ),
);

async function runSandboxEvaluatorProcess(argv: readonly string[]): Promise<void> {
  const invocation = parseSandboxEvaluatorInvocation(argv);
  const runDirectory = process.cwd();
  await writeControlFrame('ready', invocation.runToken);
  const request = await readSandboxRequestMailbox({
    runDirectory,
    runToken: invocation.runToken,
  });
  if (request.limits.maxHeapMb !== invocation.maximumHeapMb) {
    throw new Error('heap_limit_mismatch');
  }

  const evaluated = await evaluateSandboxRunnerRequest(request, {
    confirmStarted: () => writeControlFrame('started', invocation.runToken),
  });
  await publishSandboxResultMailbox({
    runDirectory,
    runToken: invocation.runToken,
    result: evaluated,
  });
  await writeControlFrame('result_committed', invocation.runToken);
}

class SandboxEvaluatorInvocationError extends Error {
  constructor() {
    super('sandbox evaluator invocation is invalid');
    this.name = 'SandboxEvaluatorInvocationError';
  }
}

function parseSandboxEvaluatorInvocation(argv: readonly string[]): SandboxEvaluatorInvocation {
  if (argv.length !== 5) throw new SandboxEvaluatorInvocationError();
  const protocolVersion = argv[2];
  if (protocolVersion !== String(SANDBOX_MAILBOX_PROTOCOL_VERSION)) {
    throw new SandboxEvaluatorInvocationError();
  }
  try {
    return {
      runToken: parseSandboxRunToken(argv[3]),
      maximumHeapMb: parseSandboxHeapLimitMb(Number(argv[4])),
    };
  } catch {
    throw new SandboxEvaluatorInvocationError();
  }
}

function writeControlFrame(kind: SandboxControlFrameKind, runToken: string): Promise<void> {
  const serialized = serializeSandboxControlFrame({
    protocol_version: SANDBOX_CONTROL_PROTOCOL_VERSION,
    kind,
    run_token: runToken,
    pid: process.pid,
  });
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      process.stdout.removeListener('error', onError);
      reject(error);
    };
    process.stdout.once('error', onError);
    process.stdout.write(serialized, error => {
      process.stdout.removeListener('error', onError);
      if (error) reject(error);
      else resolve();
    });
  });
}

function readStableFailureCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = Reflect.get(error, 'code');
    if (typeof code === 'string' && /^[a-z0-9_]+$/u.test(code)) return code;
  }
  if (error instanceof Error && /^[a-z0-9_]+$/u.test(error.message)) return error.message;
  return 'unexpected';
}

/** 最后一帧必须先完成 stdout flush，再结束一次性 evaluator。 */
async function exitSandboxEvaluatorProcess(exitCode: number, stderr = ''): Promise<never> {
  await Promise.allSettled([
    endStandardStream(process.stdout),
    endStandardStream(process.stderr, stderr),
  ]);
  process.exit(exitCode);
}

function endStandardStream(stream: NodeJS.WriteStream, text = ''): Promise<void> {
  return new Promise(resolve => {
    stream.end(text, resolve);
  });
}
