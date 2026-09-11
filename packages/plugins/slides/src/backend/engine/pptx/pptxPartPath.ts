import { posix } from 'node:path';

/** 按 OPC relationship 规则解析相对或包根绝对 Target，不访问 OS 文件路径。 */
export function resolvePptxPartTarget(
  sourcePartPath: string,
  target: string,
): string {
  const resolved = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(sourcePartPath), target));
  if (resolved.startsWith('../') || resolved.startsWith('/')) {
    throw new Error(`Relationship target escapes the PPTX package: ${target}.`);
  }
  return resolved;
}
