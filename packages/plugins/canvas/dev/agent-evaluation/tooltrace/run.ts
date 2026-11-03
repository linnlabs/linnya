import { inspectCanvasToolTrace } from './index';
import { readTraceJson } from './adapters/traceFiles';
const [command, input, outputDirectory] = process.argv.slice(2);
try {
  if (command !== 'inspect' || !input || !outputDirectory)
    throw new Error('Usage: run.ts inspect INSPECTION.json NEW-OUTPUT-DIRECTORY');
  process.stdout.write(
    JSON.stringify(
      await inspectCanvasToolTrace({ inspection: await readTraceJson(input), outputDirectory })
    ) + '\n'
  );
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
