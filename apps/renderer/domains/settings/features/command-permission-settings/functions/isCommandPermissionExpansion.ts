import {
  compareCommandPermissionLevels,
  type CommandExternalApproval,
  type CommandInternalDataAccess,
  type CommandPermissionLevel,
} from '@app/schemas/commands';

export function isCommandPermissionExpansion(input: {
  readonly current: {
    readonly permissionLevel: CommandPermissionLevel;
    readonly internalDataAccess: CommandInternalDataAccess;
    readonly externalCommandApproval: CommandExternalApproval;
  };
  readonly next: {
    readonly permissionLevel: CommandPermissionLevel;
    readonly internalDataAccess: CommandInternalDataAccess;
    readonly externalCommandApproval: CommandExternalApproval;
  };
}): boolean {
  return compareCommandPermissionLevels(input.next.permissionLevel, input.current.permissionLevel) > 0
    || (input.current.internalDataAccess === 'denied'
      && input.next.internalDataAccess === 'allowed')
    // 让外部调用方也能批准命令，同样是放宽，需要用户确认。
    || (input.current.externalCommandApproval === 'user_only'
      && input.next.externalCommandApproval === 'allowed');
}
