import type { WaitUserRuntimeEvent } from '../definitions/executionSettlement';

export function readWaitUserReason(event: WaitUserRuntimeEvent): string | undefined {
  if (typeof event.prompt === 'string' && event.prompt.trim().length > 0) {
    return event.prompt;
  }
  const form = event.form;
  if (form && typeof form === 'object' && !Array.isArray(form) && 'prompt' in form) {
    const prompt = form.prompt;
    return typeof prompt === 'string' && prompt.trim().length > 0 ? prompt : undefined;
  }
  return undefined;
}
