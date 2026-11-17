import type {
  PluginWorkerQueueOptions,
  PluginWorkerTask,
} from '@linnya/plugin-host-contract/backend/workerQueue';
import { createHostPluginWorkerQueue } from 'src/app-hosts/linnya/adapters/plugin-worker-queue/orchestration/createHostPluginWorkerQueue';
import { getDatabaseService } from 'src/electron-main/services/database';
import { SCHEMA_VERSION } from 'src/electron-main/services/database/migrations';
import { getPluginInferencePort } from './inferenceRuntime';

export type * from '@linnya/plugin-host-contract/backend/workerQueue';

export function createPluginWorkerQueue<T extends PluginWorkerTask>(
  options: PluginWorkerQueueOptions<T>
) {
  return createHostPluginWorkerQueue(options, {
    database: { path: getDatabaseService().getDb().name, schemaVersion: SCHEMA_VERSION },
    inference: getPluginInferencePort(),
    environment: process.env,
  });
}
