import type { CommandPermissionSnapshotV1 } from '@app/schemas/commands';

export type ApprovedCommandPermissionSource = 'allow_once' | 'conversation_approval';

export type ApprovedCommandPermissionResolution =
  | {
      readonly status: 'resolved';
      readonly permission: CommandPermissionSnapshotV1;
    }
  | {
      readonly status: 'rejected';
      readonly code: 'full_access_requires_no_approval' | 'permission_already_modified';
    };
