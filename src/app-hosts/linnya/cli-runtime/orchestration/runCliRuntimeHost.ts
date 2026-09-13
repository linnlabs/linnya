import type { CliRuntimeHostInput } from '../definitions/cliRuntimeHost';
import { createCliAppServerRuntime } from './createCliAppServerRuntime';

type RuntimeSignal = 'SIGINT' | 'SIGTERM';

/** 前台 CLI 进程拥有 App Server；信号只触发一次业务收口，不创建后台 daemon。 */
export async function runCliRuntimeHost(input: CliRuntimeHostInput): Promise<void> {
  const runtime = await createCliAppServerRuntime(input);
  let resolveSignal: ((signal: RuntimeSignal) => void) | null = null;
  const signal = new Promise<RuntimeSignal>(resolve => { resolveSignal = resolve; });
  const onSigint = (): void => resolveSignal?.('SIGINT');
  const onSigterm = (): void => resolveSignal?.('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    const start = runtime.start();
    const outcome = await Promise.race([
      start.then(identity => ({ kind: 'ready' as const, identity })),
      signal.then(received => ({ kind: 'signal' as const, received })),
    ]);
    if (outcome.kind === 'signal') {
      await runtime.shutdown();
      await start.catch(() => undefined);
      return;
    }
    input.onReady(outcome.identity);
    const terminal = await Promise.race([
      runtime.waitForExit().then(() => ({ kind: 'exit' as const })),
      signal.then(received => ({ kind: 'signal' as const, received })),
    ]);
    if (terminal.kind === 'exit') return;
    await runtime.shutdown();
    await runtime.waitForExit();
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}
