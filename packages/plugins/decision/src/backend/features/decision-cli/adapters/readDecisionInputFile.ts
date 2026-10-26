import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DecisionFailure } from '../../decision-record';

/** App 授权后的文件输入只在当前会话工作目录内解析，不读取 Workspace 或宿主配置。 */
export async function readDecisionInputFile(root: string, relativePath: string, signal: AbortSignal): Promise<string> {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new DecisionFailure('invalid_model', '--input must be a relative file in the current conversation directory.');
  }
  try {
    const canonicalRoot = await realpath(root);
    const target = await realpath(path.resolve(canonicalRoot, relativePath));
    const relativeTarget = path.relative(canonicalRoot, target);
    if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
      throw new DecisionFailure('invalid_model', '--input cannot follow a link outside the conversation directory.');
    }
    return await readFile(target, { encoding: 'utf8', signal });
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && ['ENOENT', 'EACCES', 'EISDIR'].includes(String(error.code))) {
      throw new DecisionFailure('invalid_model', 'Cannot read --input in the current conversation directory. Create a UTF-8 JSON file there first.');
    }
    throw error;
  }
}
