import { z } from 'zod';
import type { ConversationReferenceChipInput } from '@linnya/plugin-host-contract/renderer';
import { resolveCurrentPluginContributionMessage } from '../../../functions/resolveCurrentPluginContributionMessage';
const identity = z.object({ documentId: z.string().min(1), projectId: z.string().min(1) });
export function readWorkspaceReferenceIdentity(reference: ConversationReferenceChipInput, currentProjectId: string | null) {
  const target = identity.parse(reference.metadata);
  if (target.projectId !== currentProjectId) throw new Error(resolveCurrentPluginContributionMessage('plugins.contribution.workspaceReference.error.outsideProject'));
  return target;
}
