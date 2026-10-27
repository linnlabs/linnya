import { type ConversationControlSkillsResponse, type SkillManagementRequest } from '@app/schemas';
import { SkillManagementError, type SkillManagementPort } from 'src/features/skills';
import { ConversationControlError } from '../definitions/conversationControlError';

export function controlSkills(owner: SkillManagementPort | undefined, request: SkillManagementRequest): ConversationControlSkillsResponse {
  if (!owner) throw new ConversationControlError('capability_unavailable', 'Skills management is unavailable');
  try {
    return { schema_version: 1, ok: true, command: 'skills', result: owner.execute(request) };
  } catch (error: unknown) {
    if (!(error instanceof SkillManagementError)) throw error;
    throw new ConversationControlError(error.code === 'conflict' ? 'skill_conflict' : 'invalid_request', error.message);
  }
}
