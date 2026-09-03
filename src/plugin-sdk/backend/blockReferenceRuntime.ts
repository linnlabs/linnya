import {
  generateRefMapWithCollisionCheck as generateHostBlockRefMap,
  resolveBlockIdFromRef as resolveHostBlockIdFromRef,
} from '../../shared/utils/refIdGenerator';

/** 插件只获得默认文档块 ref 规则，不暴露 Host 的可变 options。 */
export function generateRefMapWithCollisionCheck(
  blockIds: readonly string[],
): Map<string, string> {
  return generateHostBlockRefMap([...blockIds]);
}

export function resolveBlockIdFromRef(
  blockRef: string,
  allBlockIds: readonly string[],
): string | null {
  return resolveHostBlockIdFromRef(blockRef, [...allBlockIds]);
}
