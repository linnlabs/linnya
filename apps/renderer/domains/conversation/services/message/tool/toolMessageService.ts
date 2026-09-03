/*
 * @file apps/renderer/domains/conversation/services/message/tool/toolMessageService.ts
 */

import { buildInitialToolCallMetadata, patchToolCallMetadata, type ToolCallPatch } from './toolEventAdapter';
import { isRecord } from '../../../utils/typeGuards';

export const ToolMessageService = {
  buildInitialMetadata: buildInitialToolCallMetadata,
  patchMetadata: patchToolCallMetadata,
  buildContentFromPatch
} as const;

export type { ToolCallPatch } from './toolEventAdapter';

function buildContentFromPatch(
  patch: ToolCallPatch,
): string | undefined {
  const eventMetadata = patch.eventMetadata;
  if (eventMetadata && isRecord(eventMetadata) && isRecord(eventMetadata['interaction'])) {
    const interaction = eventMetadata['interaction'];
    if (interaction['status'] !== 'active') {
      return undefined;
    }
  }

  return patch.observation;
}
