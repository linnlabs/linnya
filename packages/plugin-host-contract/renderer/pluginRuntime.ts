export type RendererPluginAvailability = 'enabled' | 'disabled' | 'missing';
export interface RendererPluginAvailabilityChange {
  readonly pluginId: string;
  readonly state: RendererPluginAvailability;
  /** 包含本次卸载前的文档类型，让仍打开的引用表面能够失效旧身份。 */
  readonly documentNodeTypes: readonly string[];
}
export interface RendererPluginRuntimePort {
  read(pluginId: string): RendererPluginAvailability;
  subscribe(listener: (changes: readonly RendererPluginAvailabilityChange[]) => void): () => void;
}
export declare function registerRendererPluginRuntimePort(port: RendererPluginRuntimePort): void;
export declare function readRendererPluginAvailability(pluginId: string): RendererPluginAvailability;
export declare function subscribeRendererPluginAvailability(listener: (changes: readonly RendererPluginAvailabilityChange[]) => void): () => void;
