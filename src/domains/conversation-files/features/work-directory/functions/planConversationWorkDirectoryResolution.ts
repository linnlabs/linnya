import {
  ConversationDirectoryError,
} from '../../../definitions/conversationDirectoryFailure';
import type {
  ConversationWorkDirectoryResolutionStatus,
} from '../../../definitions/conversationWorkDirectory';

export interface ConversationWorkDirectoryObservedState {
  readonly ownerExists: boolean;
  readonly initializedExists: boolean;
  readonly directoryExists: boolean;
}

export interface ConversationWorkDirectoryResolutionPlan {
  readonly ownerAction: 'publish' | 'reuse';
  readonly initializedAction: 'publish' | 'reuse';
  readonly resolutionStatus: ConversationWorkDirectoryResolutionStatus;
}

/**
 * owner 和 initialized 是 Linnya 持有的生命周期事实，目录只是当前磁盘观察。
 * 这组规则放在 domain，避免文件系统 adapter 随 cleanup、迁移和恢复能力增长成业务 service。
 */
export function planConversationWorkDirectoryResolution(
  state: ConversationWorkDirectoryObservedState,
): ConversationWorkDirectoryResolutionPlan {
  if (state.initializedExists && !state.ownerExists) {
    throw new ConversationDirectoryError(
      'work_directory_unsafe_entry',
      'read_identity_marker',
    );
  }

  if (!state.ownerExists && state.directoryExists) {
    throw new ConversationDirectoryError(
      'work_directory_path_occupied',
      'inspect_directory',
    );
  }

  return Object.freeze({
    ownerAction: state.ownerExists ? 'reuse' : 'publish',
    initializedAction: state.initializedExists ? 'reuse' : 'publish',
    resolutionStatus: state.initializedExists
      ? (state.directoryExists ? 'existing' : 'recreated_missing')
      : 'created',
  });
}
