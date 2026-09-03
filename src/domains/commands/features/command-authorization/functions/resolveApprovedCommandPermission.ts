import {
  parseCommandPermissionSnapshot,
  type CommandPermissionSnapshotV1,
} from '@app/schemas/commands';

import type {
  ApprovedCommandPermissionResolution,
  ApprovedCommandPermissionSource,
} from '../../../definitions/commandPermission';

/**
 * 用户批准最多让本条命令进入标准权限；审批不能把全局档位改成完全访问，
 * 也不能覆盖内部数据开关。这样设置变化与单条批准始终是两个独立事实。
 */
export function resolveApprovedCommandPermission(params: {
  readonly current: CommandPermissionSnapshotV1;
  readonly source: ApprovedCommandPermissionSource;
}): ApprovedCommandPermissionResolution {
  const { current, source } = params;

  if (current.base_level === 'full_access') {
    return { status: 'rejected', code: 'full_access_requires_no_approval' };
  }
  if (
    current.grant_source !== 'global_setting'
    || current.effective_level !== current.base_level
  ) {
    return { status: 'rejected', code: 'permission_already_modified' };
  }

  return {
    status: 'resolved',
    permission: parseCommandPermissionSnapshot({
      ...current,
      effective_level: 'standard',
      grant_source: source,
    }),
  };
}
