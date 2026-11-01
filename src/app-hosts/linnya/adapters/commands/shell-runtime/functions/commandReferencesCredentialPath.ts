import path from 'node:path';
import { inspectStaticShellArguments, type CommandAuthorizationRuntimeContext } from 'src/domains/commands';

/**
 * 只识别可见文本和静态路径参数，作为风险提示；不读取脚本、不遍历文件、不模拟执行。
 * 同用户脚本仍能读取凭据，这里不能被解释成操作系统的文件保密边界。
 */
export function commandReferencesCredentialPath(input: {
  readonly command: string;
  readonly cwd: string;
  readonly credentialFilePath: string;
  readonly context: CommandAuthorizationRuntimeContext;
}): boolean {
  const paths = input.context.platform === 'windows' ? path.win32 : path.posix;
  const normalize = (value: string): string => {
    const normalized = value.replace(/\\+/gu, '/');
    return input.context.platform === 'windows' ? normalized.toLocaleLowerCase('en-US') : normalized;
  };
  const directory = normalize(paths.dirname(input.credentialFilePath));
  const referencesDirectory = (value: string): boolean => {
    return normalize(value).split(directory).slice(1).some(suffix => (
      suffix.length === 0 || /[\s/"'`);,*?\]]/u.test(suffix[0])
    ));
  };
  if (referencesDirectory(input.command)) return true;
  return inspectStaticShellArguments(input.command, input.context).some(token => {
    const argument = token.startsWith('-') && token.includes('=')
      ? token.slice(token.indexOf('=') + 1) : token;
    return referencesDirectory(paths.resolve(input.cwd, argument));
  });
}
