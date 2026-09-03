import type { CommandRuntimePlatform } from '@app/schemas/commands';

/**
 * 风险规则使用的平台和 Shell 语义必须跟随授权结果进入启动边界，
 * 否则一条按 zsh 判断的命令可能在批准后被另一套 Shell 重新解释。
 */
export interface CommandAuthorizationRuntimeContext {
  readonly platform: CommandRuntimePlatform;
  readonly shellSemanticsId: string;
}
