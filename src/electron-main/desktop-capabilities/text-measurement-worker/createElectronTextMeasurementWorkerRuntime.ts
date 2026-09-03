import fs from 'node:fs';
import path from 'node:path';

import type { DesktopTextMeasurementWorkerPort } from '../../../app-hosts/linnya/desktop-capabilities';
import { MeasurementWorkerManager } from '../../measurement/MeasurementWorkerManager';

export interface ElectronTextMeasurementWorkerRuntime {
  readonly port: DesktopTextMeasurementWorkerPort;
  dispose(): Promise<void>;
}

/** BrowserWindow worker 只在 Desktop adapter 内创建；Backend 只收到批量 DTO 端口。 */
export function createElectronTextMeasurementWorkerRuntime(): ElectronTextMeasurementWorkerRuntime {
  const preloadPath = path.join(__dirname, 'measurement-preload.js');
  const workerHtmlPath = path.join(__dirname, 'worker.html');
  const availability = readWorkerAvailability({ preloadPath, workerHtmlPath });

  const port: DesktopTextMeasurementWorkerPort = {
    availability,
    measureBatch: (inputs) => MeasurementWorkerManager.instance().measureBatch(inputs),
    measureClusterAdvancesBatch: (requests) => (
      MeasurementWorkerManager.instance().measureClusterAdvancesBatch(requests)
    ),
    touch: () => MeasurementWorkerManager.instance().touch(),
  };
  Object.freeze(port);

  return Object.freeze({
    port,
    dispose: () => MeasurementWorkerManager.disposeSingleton(),
  });
}

function readWorkerAvailability(paths: {
  readonly preloadPath: string;
  readonly workerHtmlPath: string;
}): DesktopTextMeasurementWorkerPort['availability'] {
  if (!fs.existsSync(paths.preloadPath)) {
    return { available: false, reason: `missing preload at ${paths.preloadPath}` };
  }
  if (!fs.existsSync(paths.workerHtmlPath)) {
    return { available: false, reason: `missing worker html at ${paths.workerHtmlPath}` };
  }
  return { available: true };
}
