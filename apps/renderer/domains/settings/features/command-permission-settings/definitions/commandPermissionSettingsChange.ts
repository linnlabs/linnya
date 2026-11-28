import type {
  CommandExternalApproval,
  CommandInternalDataAccess,
  CommandPermissionLevel,
} from '@app/schemas/commands';

export type CommandPermissionSettingsChange =
  | {
    readonly kind: 'permission_level';
    readonly value: CommandPermissionLevel;
  }
  | {
    readonly kind: 'internal_data_access';
    readonly value: CommandInternalDataAccess;
  }
  | {
    readonly kind: 'external_command_approval';
    readonly value: CommandExternalApproval;
  };
