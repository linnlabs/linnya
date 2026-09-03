/** 为同一文档的块身份生成确定性短 ref，碰撞时明确失败。 */
export declare function generateRefMapWithCollisionCheck(
  blockIds: readonly string[],
): Map<string, string>;

/** 在明确候选块集合中解析文档块短 ref。 */
export declare function resolveBlockIdFromRef(
  blockRef: string,
  allBlockIds: readonly string[],
): string | null;
