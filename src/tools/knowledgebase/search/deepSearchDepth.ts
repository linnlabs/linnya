import type { ToolContext } from '../../types';

export function readDeepSearchRuntimeDepth(context: ToolContext): number {
  if (typeof context.childRunDepth === 'number' && Number.isFinite(context.childRunDepth)) {
    return Math.max(0, Math.floor(context.childRunDepth));
  }
  return 0;
}
