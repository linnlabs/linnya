import type { RoutedRuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { WorkspaceAssetCommitRecord } from 'src/features/workspace/assets/definitions/workspaceAssetCommit';
import type { RunDescriptor } from './runDescriptor';

export interface RunAdmissionFacts {
  readonly events: readonly RoutedRuntimeEvent[];
  readonly assetCommitsByEventId: ReadonlyMap<string, readonly WorkspaceAssetCommitRecord[]>;
  readonly replaceTargetId?: string;
}

/** 只组合已物化的数据，事务内不调用 Provider、文件系统或任意异步工作。 */
export interface RunAdmissionCommitPort {
  start(input: {
    record: runSupervisor.RunRecord;
    replacement?: { previous: runSupervisor.RunRecord; next: runSupervisor.RunRecord };
    descriptor: RunDescriptor;
    incoming: RunAdmissionFacts;
  }): Promise<void>;
  resume(input: {
    previous: runSupervisor.RunRecord;
    next: runSupervisor.RunRecord;
    incoming: RunAdmissionFacts;
  }): Promise<void>;
}
