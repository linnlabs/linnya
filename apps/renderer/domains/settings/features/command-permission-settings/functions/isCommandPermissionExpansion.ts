import {
  compareCommandPermissionLevels,
  type CommandInternalDataAccess,
  type CommandPermissionLevel,
} from '@app/schemas/commands';

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
  return compareCommandPermissionLevels(input.next.permissionLevel, input.current.permissionLevel) > 0
    || (input.current.internalDataAccess === 'denied'
      && input.next.internalDataAccess === 'allowed');
}
