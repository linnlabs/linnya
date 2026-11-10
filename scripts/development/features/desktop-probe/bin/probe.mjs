import { performance } from 'node:perf_hooks';
import { ProbeError } from '../definitions/probeContract.mjs';
import { parseProbeArgs } from '../functions/parseProbeArgs.mjs';
import { runProbeCommand } from '../orchestration/probeClient.mjs';

const started = performance.now();
try {
  const result = await runProbeCommand(parseProbeArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ ok: true, ...result, ms: Math.round(performance.now() - started) }));
} catch (error) {
  process.exitCode = error instanceof ProbeError ? error.exitCode : 1;
  console.log(JSON.stringify({
    ok: false,
    error: { code: error.code ?? 'PROBE_ERROR', message: error.message, hint: error.hint, details: error.details },
    ms: Math.round(performance.now() - started),
  }));
}
