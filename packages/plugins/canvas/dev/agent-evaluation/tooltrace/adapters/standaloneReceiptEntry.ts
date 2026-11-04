import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { installPluginCliHostModuleResolver } from '../../../../../../../src/domains/commands/features/host-module-resolution/infrastructure/installPluginCliHostModuleResolver';
import { CanvasReceiptReaderRequestSchema } from '../definitions/canvasReceiptWitness';

/** 与正式artifact smoke相同的Electron ABI/Host解析装配，无窗口、不装配App写运行态。 */
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Receipt descriptor required');
  const request = CanvasReceiptReaderRequestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  app.setPath('userData', request.profileDirectory);
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  await app.whenReady();
  const entry = path.join(request.artifactRoot, 'dist/cli/canvas-cli.cjs');
  installPluginCliHostModuleResolver({
    pluginCliDirectory: path.dirname(entry),
    hostAppRoot: request.hostAppRoot,
  });
  process.argv = [
    process.execPath,
    entry,
    '--database',
    request.databasePath,
    '--project',
    request.projectId,
    '--conversation',
    request.conversationId,
    'receipt',
    request.documentPath,
    request.requestId,
  ];
  createRequire(entry)(entry);
}
void main().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  app.exit(1);
});
