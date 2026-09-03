import { posix } from 'node:path';

/** 按 OPC relationship 规则把相对 Target 解析为包内 part path。 */
export function resolvePptxPartTarget(
  sourcePartPath: string,
  target: string,
): string {
  const resolved = posix.normalize(posix.join(posix.dirname(sourcePartPath), target));
  if (resolved.startsWith('../') || resolved.startsWith('/')) {
    throw new Error(`Relationship target escapes the PPTX package: ${target}.`);
  }
  return resolved;
}
