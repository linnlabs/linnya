import type { CommandAuthorizationRuntimeContext } from '../../../definitions/commandAuthorization';
import { scanPowerShellSimpleCommand } from './scanPowerShellSimpleCommand';
import { scanZshSimpleCommand } from './scanZshSimpleCommand';

/** 提前提示已能静态识别的目标；动态脚本的权限仍必须由平台沙箱强制执行。 */
export function inspectStaticShellArguments(
  command: string,
  context: CommandAuthorizationRuntimeContext,
): readonly string[] {
  const result = context.platform === 'macos'
    ? scanZshSimpleCommand(command)
    : scanPowerShellSimpleCommand(command);
  return result.status === 'static' ? result.tokens : [];
}
