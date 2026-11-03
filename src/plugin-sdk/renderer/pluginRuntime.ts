import type { RendererPluginAvailabilityChange, RendererPluginRuntimePort } from '@linnya/plugin-host-contract/renderer/pluginRuntime';
export type * from '@linnya/plugin-host-contract/renderer/pluginRuntime';
let port: RendererPluginRuntimePort | null = null;
export function registerRendererPluginRuntimePort(value: RendererPluginRuntimePort): void { port = value; }
function requirePort(): RendererPluginRuntimePort { if (!port) throw new Error('Renderer plugin runtime port is not installed'); return port; }
export function readRendererPluginAvailability(pluginId: string) { return requirePort().read(pluginId); }
export function subscribeRendererPluginAvailability(listener: (changes: readonly RendererPluginAvailabilityChange[]) => void): () => void { return requirePort().subscribe(listener); }
