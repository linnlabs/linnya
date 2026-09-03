import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkReportPort } from '../definitions/benchmarkRun';
import { renderBenchmarkReport } from '../functions/renderBenchmarkReport';

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, filePath);
}

export function createFileBenchmarkReportWriter(
  defaultOutputRoot: string,
): BenchmarkReportPort {
  return {
    async write(input) {
      const outputRoot = path.resolve(input.outputRoot ?? defaultOutputRoot);
      const timestamp = new Date(input.facts.startedAt).toISOString().replaceAll(':', '-');
      const runIdentity = (input.facts.receipt?.run_id ?? randomUUID())
        .replaceAll(/[^a-zA-Z0-9_-]/g, '_');
      const directory = path.join(
        outputRoot,
        input.benchmark.definition.id,
        `${timestamp}-r${input.benchmark.definition.revision}-${runIdentity}`,
      );
      await mkdir(directory, { recursive: true });
      const factsFile = path.join(directory, 'facts.json');
      const reportFile = path.join(directory, 'report.md');
      await Promise.all([
        writeAtomic(factsFile, `${JSON.stringify(input.facts, null, 2)}\n`),
        writeAtomic(reportFile, renderBenchmarkReport(input.benchmark, input.facts)),
      ]);
      return { directory, factsFile, reportFile };
    },
  };
}
