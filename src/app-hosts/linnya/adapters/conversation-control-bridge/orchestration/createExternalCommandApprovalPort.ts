import {
  CommandPermissionSettingsError,
  readCommandPermissionSettings,
  type CommandPermissionSettingsPort,
} from 'src/domains/commands';
import type { CommandExternalApproval } from '@app/schemas/commands';
import {
  resolveExternalCommandApprovalPolicy,
  type ExternalCommandApprovalPort,
} from 'src/app-hosts/linnya/application/conversation-control';

/**
 * 把命令权限设置（当前 App 生命周期内的内存权威，不是磁盘文件）和宿主启动时的放行
 * 接成控制入口的“能否代批”查询。控制入口本身没有任何能改这两项的命令。
 */
export function createExternalCommandApprovalPort(input: {
  readonly hostKind: 'desktop' | 'cli_runtime';
  readonly hostAllows: boolean;
  readonly settings: CommandPermissionSettingsPort;
}): ExternalCommandApprovalPort {
  return Object.freeze({
    read() {
      let setting: CommandExternalApproval | undefined;
      try {
        setting = readCommandPermissionSettings(input.settings).external_command_approval;
      } catch (error: unknown) {
        // 设置读不出来是已知业务状态（命令权限页会显示不可用），这里按“未放开”处理；其余异常照常抛出。
        if (!(error instanceof CommandPermissionSettingsError)) throw error;
        setting = undefined;
      }
      return resolveExternalCommandApprovalPolicy({
        hostKind: input.hostKind,
        hostAllows: input.hostAllows,
        setting,
      });
    },
  });
}
