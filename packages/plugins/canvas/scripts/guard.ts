import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasQualityExceptions } from './quality/definitions/canvasQualityExceptions';
import { readCanvasQualitySources } from './quality/functions/readCanvasQualitySources';
import { readCanvasQualityMetrics } from './quality/functions/readCanvasQualityMetrics';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = readCanvasQualityMetrics(readCanvasQualitySources(pluginRoot), canvasQualityExceptions);
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  for (const issue of report.issues) process.stdout.write(`${issue.severity} ${issue.file}:${issue.line} ${issue.function ?? ''} [${issue.rule}] ${issue.message}\n`);
  process.stdout.write(`[canvas-quality] ${report.files} production files / ${report.functions} functions; errors=${report.issues.filter(issue => issue.severity === 'error').length}\n`);
}
if (report.issues.some(issue => issue.severity === 'error' || issue.severity === 'review')) process.exitCode = 1;
