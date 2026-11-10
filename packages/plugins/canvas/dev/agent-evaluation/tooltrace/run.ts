import {
  inspectCanvasToolTrace,
  draftCanvasEvaluationRun,
  collectCanvasReceiptWitness,
  collectCanvasT13Metrics,
} from './index';
import { readTraceJson } from './adapters/traceFiles';
const [command, input, outputDirectory] = process.argv.slice(2);
try {
  if (!input || !outputDirectory)
    throw new Error(
      'Usage: run.ts inspect|draft|receipts|metrics REQUEST.json NEW-DIRECTORY'
    );
  const value = await readTraceJson(input);
  const result =
    command === 'inspect'
      ? await inspectCanvasToolTrace({ inspection: value, outputDirectory })
      : command === 'receipts'
        ? await collectCanvasReceiptWitness({ request: value, outputDirectory })
        : command === 'metrics'
          ? await collectCanvasT13Metrics({ request: value, outputDirectory })
          : command === 'draft'
            ? await draftCanvasEvaluationRun({ request: value, outputDirectory })
            : undefined;
  if (!result) throw new Error('Unknown tooltrace command');
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
