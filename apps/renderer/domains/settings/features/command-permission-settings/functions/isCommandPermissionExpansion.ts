import type {
  CommandInternalDataAccess,
  CommandPermissionLevel,
} from '@app/schemas/commands';

const PERMISSION_LEVEL_WIDTH: Readonly<Record<CommandPermissionLevel, number>> = {
  read_only: 0,
  standard: 1,
  full_access: 2,
};

export function isCommandPermissionExpansion(input: {
  readonly current: {
    readonly permissionLevel: CommandPermissionLevel;
    readonly internalDataAccess: CommandInternalDataAccess;
  };
  readonly next: {
    readonly permissionLevel: CommandPermissionLevel;
    readonly internalDataAccess: CommandInternalDataAccess;
  };
}): boolean {
  return PERMISSION_LEVEL_WIDTH[input.next.permissionLevel]
      > PERMISSION_LEVEL_WIDTH[input.current.permissionLevel]
    || (input.current.internalDataAccess === 'denied'
      && input.next.internalDataAccess === 'allowed');
}
