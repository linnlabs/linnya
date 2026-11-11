/** pending 资源用 null 标记，只有已解码的资源参与 LRU 淘汰。 */
export interface SettledRenderResourceEntry {
  readonly cacheKey: string;
  readonly loaded: object | null;
  readonly decodedBytes: number;
}
export interface RenderResourceBudget {
  readonly maxEntries: number;
  readonly maxDecodedBytes: number;
  readonly decodedBytes: number;
}
