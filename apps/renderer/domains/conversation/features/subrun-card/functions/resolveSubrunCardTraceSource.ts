import type { HistoricalSubrunTraceLazySource } from '../../subrun-trace';

/**
 * 卡片 presentation ID 与历史 source ID 必须描述同一个 child。
 * source ID 只在 collection 为单卡补齐时出现；禁止用对象覆盖让 undefined 擦掉身份。
 */
export function resolveSubrunCardTraceSource(input: {
  readonly source?: HistoricalSubrunTraceLazySource;
  readonly subrunId?: string;
  readonly kinds: HistoricalSubrunTraceLazySource['kinds'];
}): HistoricalSubrunTraceLazySource | undefined {
  if (!input.source) return undefined;
  if (
    input.source.subrunId !== undefined
    && input.subrunId !== undefined
    && input.source.subrunId !== input.subrunId
  ) {
    throw new Error(
      `[SUBRUN_CARD_SOURCE_IDENTITY_CONFLICT] source=${input.source.subrunId}, presentation=${input.subrunId}`,
    );
  }
  return {
    ...input.source,
    subrunId: input.subrunId ?? input.source.subrunId,
    kinds: input.kinds,
  };
}
