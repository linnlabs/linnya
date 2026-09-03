import path from 'node:path';

import type { RuntimePathRoots } from '../definitions/runtimePathRoots';

/** 校验并冻结可跨进程传递的路径事实。 */
export function createRuntimePathRoots(input: RuntimePathRoots): RuntimePathRoots {
  requireAbsolute(input.developmentRoot, 'developmentRoot');
  requireAbsolute(input.appDataRoot, 'appDataRoot');
  requireAbsolute(input.workspaceRoot, 'workspaceRoot');
  return Object.freeze({ ...input });
}

function requireAbsolute(value: string, name: string): void {
  if (!path.isAbsolute(value)) throw new Error(`Runtime path ${name} 必须是绝对路径`);
}
