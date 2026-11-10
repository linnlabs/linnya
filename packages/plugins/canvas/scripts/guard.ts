import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { canvasQualityExceptions } from './quality/definitions/canvasQualityExceptions';
import { readCanvasQualitySources } from './quality/functions/readCanvasQualitySources';
import { readCanvasQualityMetrics } from './quality/functions/readCanvasQualityMetrics';
import { checkCanvasSourceBoundaries } from './quality/functions/checkCanvasSourceBoundaries';
import { checkCanvasFrameClosure } from './quality/functions/checkCanvasFrameClosure';
import { checkCanvasGlobalReferences } from './quality/functions/checkCanvasGlobalReferences';
import { checkCanvasUnionSwitches } from './quality/functions/checkCanvasUnionSwitches';
import { checkCanvasSourceFormatting } from './quality/functions/checkCanvasSourceFormatting';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(pluginRoot, 'tsconfig.json'),
  config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, pluginRoot);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const sources = readCanvasQualitySources(pluginRoot),
  metrics = readCanvasQualityMetrics(sources, canvasQualityExceptions);
const boundaries = checkCanvasSourceBoundaries(sources, {
    pluginRoot,
    compilerOptions: parsed.options,
  }),
  frame = checkCanvasFrameClosure(program, pluginRoot);
const globals = checkCanvasGlobalReferences(program, pluginRoot);
const switches = checkCanvasUnionSwitches(program, pluginRoot);
const formatting = await checkCanvasSourceFormatting(sources);
const report = {
  ...metrics,
  frame: {
    entries: frame.entries,
    preparationFrames: frame.preparationFrames,
    projectFunctions: frame.projectFunctions,
    externalCalls: frame.externalCalls,
  },
  issues: [
    ...metrics.issues,
    ...boundaries,
    ...globals,
    ...switches,
    ...frame.issues,
    ...formatting,
  ],
};
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  for (const issue of report.issues)
    process.stdout.write(
      `${issue.severity} ${issue.file}:${issue.line} ${issue.function ?? ''} [${issue.rule}] ${issue.message}\n`
    );
  process.stdout.write(
    `[canvas-quality] ${report.files} production files / ${report.functions} functions; errors=${report.issues.filter(issue => issue.severity === 'error').length}\n`
  );
}
if (report.issues.some(issue => issue.severity === 'error' || issue.severity === 'review'))
  process.exitCode = 1;
