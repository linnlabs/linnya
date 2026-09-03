import fs from 'node:fs';
import path from 'node:path';

import type { PresentationBuildExecutionPort } from '../definitions/presentationBuildExecution';
import { resolvePresentationBuildWorkerPath } from '../functions/resolvePresentationBuildWorkerPath';
import { createWorkerPresentationBuildExecution } from './createWorkerPresentationBuildExecution';

let active = false;
let runtime: ReturnType<typeof createWorkerPresentationBuildExecution> | undefined;

export function activateSharedPresentationBuildExecution(): void {
  active = true;
}

export async function deactivateSharedPresentationBuildExecution(): Promise<void> {
  active = false;
  const current = runtime;
  runtime = undefined;
  await current?.close();
}

export function getSharedPresentationBuildExecution(): PresentationBuildExecutionPort {
  if (!active) {
    throw new Error('Slides presentation build execution runtime is not active.');
  }
  if (!runtime) {
    const workerPath = resolvePresentationBuildWorkerPath(resolveSlidesPackageRoot());
    if (!fs.existsSync(workerPath)) {
      throw new Error(`Slides presentation build worker artifact is missing: ${workerPath}`);
    }
    runtime = createWorkerPresentationBuildExecution({ workerPath });
  }
  return runtime;
}

function resolveSlidesPackageRoot(): string {
  const loadingMode = process.env.LINNYA_PLUGIN_BACKEND_LOADING;
  if (loadingMode === 'disk' || loadingMode === 'disk-only') {
    return path.resolve(__dirname, '../..');
  }
  return path.resolve(process.cwd(), 'packages/plugins/slides');
}
