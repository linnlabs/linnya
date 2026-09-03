import path from 'node:path';
import { createFileBenchmarkReportWriter } from './adapters/fileBenchmarkReportWriter';
import { createLinnyaCliProcessAdapter } from './adapters/linnyaCliProcessAdapter';
import { builtinBenchmarkRegistry } from './registry/builtinBenchmarkRegistry';
import { runBenchmarkCli } from './orchestration/runBenchmarkCli';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

void runBenchmarkCli(process.argv.slice(2), {
  registry: builtinBenchmarkRegistry,
  conversationCli: createLinnyaCliProcessAdapter({ repoRoot }),
  reports: createFileBenchmarkReportWriter(
    path.join(repoRoot, '_dev_data', 'benchmark-results'),
  ),
}).then(exitCode => {
  process.exitCode = exitCode;
});
