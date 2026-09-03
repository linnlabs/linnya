import path from 'node:path';

import type { DevelopmentDataFilesystemPort } from '../definitions/developmentDataFilesystemPort';
import {
  CURRENT_DEVELOPMENT_DATA_EPOCH,
  DEVELOPMENT_DATA_DIRECTORY_NAME,
  type DevelopmentDataResetInspection,
  type DevelopmentDataResetResult,
  type DevelopmentDataState,
  type DevelopmentDataStateObservation,
} from '../definitions/developmentDataState';
import { decideDevelopmentDataAdmission } from '../functions/decideDevelopmentDataAdmission';
import { parseDevelopmentDataState } from '../functions/parseDevelopmentDataState';
import { resolveDevelopmentDataPaths } from '../functions/resolveDevelopmentDataPaths';

export class DevelopmentDataAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevelopmentDataAdmissionError';
  }
}

export interface DevelopmentDataLifecycle {
  ensureReady(input: {
    readonly developmentRoot: string;
    readonly appVersion: string;
  }): Promise<DevelopmentDataState>;
  reset(input: {
    readonly developmentRoot: string;
    readonly beforeRetire?: (inspection: DevelopmentDataResetInspection) => void | Promise<void>;
  }): Promise<DevelopmentDataResetResult>;
}

function serializeState(state: DevelopmentDataState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function formatTimestampForPath(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

export function createDevelopmentDataLifecycle(input: {
  readonly filesystem: DevelopmentDataFilesystemPort;
  readonly now?: () => Date;
}): DevelopmentDataLifecycle {
  const now = input.now ?? (() => new Date());

  const lifecycle: DevelopmentDataLifecycle = {
    async ensureReady(params) {
      const paths = resolveDevelopmentDataPaths(params.developmentRoot);
      const snapshot = await input.filesystem.inspectDirectory(paths.dataRoot);
      const stateSource = await input.filesystem.readTextIfExists(paths.stateFile);
      const observation: DevelopmentDataStateObservation =
        stateSource === null ? { kind: 'missing' } : parseDevelopmentDataState(stateSource);
      const decision = decideDevelopmentDataAdmission({
        directoryExists: snapshot.exists,
        topLevelEntryCount: snapshot.topLevelEntries.length,
        observation,
        requiredEpoch: CURRENT_DEVELOPMENT_DATA_EPOCH,
      });

      if (decision.kind === 'admit') {
        return decision.state;
      }
      if (decision.kind === 'reject') {
        const observed =
          decision.observedEpoch === null ? '无法确认' : String(decision.observedEpoch);
        throw new DevelopmentDataAdmissionError(
          `[DevelopmentData] 开发数据不能进入当前代码基线：${decision.reason}。\n` +
            `路径：${paths.dataRoot}\n` +
            `磁盘 epoch：${observed}\n` +
            `当前要求 epoch：${CURRENT_DEVELOPMENT_DATA_EPOCH}\n` +
            '请先停止开发进程，再执行唯一重置命令：pnpm run dev:data:reset\n' +
            '应用不会在启动过程中自动删除这些数据。'
        );
      }

      const state: DevelopmentDataState = {
        epoch: CURRENT_DEVELOPMENT_DATA_EPOCH,
        created_at: now().toISOString(),
        app_version: params.appVersion,
      };
      await input.filesystem.writeTextAtomically(paths.stateFile, serializeState(state));
      return state;
    },

    async reset(params) {
      const paths = resolveDevelopmentDataPaths(params.developmentRoot);
      const snapshot = await input.filesystem.inspectDirectory(paths.dataRoot);
      if (!snapshot.exists) {
        return {
          status: 'absent',
          dataRoot: paths.dataRoot,
          retiredPath: null,
          byteSize: 0,
          topLevelEntries: [],
        };
      }

      // 重置入口不接收目标路径；这里再次锁定目录名，避免未来调用方把通用 move
      // 能力误扩成可作用于任意目录的删除接口。
      if (
        path.dirname(paths.dataRoot) !== paths.developmentRoot ||
        path.basename(paths.dataRoot) !== DEVELOPMENT_DATA_DIRECTORY_NAME
      ) {
        throw new Error(`[DevelopmentData] 拒绝重置非标准开发数据目录：${paths.dataRoot}`);
      }

      const byteSize = await input.filesystem.measureDirectory(paths.dataRoot);
      await params.beforeRetire?.({
        dataRoot: paths.dataRoot,
        byteSize,
        topLevelEntries: snapshot.topLevelEntries,
      });
      const retiredName = `development-data-${formatTimestampForPath(now().toISOString())}`;
      const retiredPath = await input.filesystem.retireDirectory(
        paths.dataRoot,
        paths.retiredRoot,
        retiredName
      );
      return {
        status: 'retired',
        dataRoot: paths.dataRoot,
        retiredPath,
        byteSize,
        topLevelEntries: snapshot.topLevelEntries,
      };
    },
  };
  return Object.freeze(lifecycle);
}
