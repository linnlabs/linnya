import path from 'node:path';

export function resolvePresentationBuildWorkerPath(packageRoot: string): string {
  return path.resolve(packageRoot, 'dist', 'backend', 'presentation-build-worker.cjs');
}
