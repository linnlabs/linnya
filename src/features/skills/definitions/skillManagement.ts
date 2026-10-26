import type { SkillManagementErrorCode, SkillManagementRequest, SkillManagementResult } from '@app/schemas';

export class SkillManagementError extends Error {
  readonly name = 'SkillManagementError';
  constructor(readonly code: SkillManagementErrorCode, message: string) { super(message); }
}

export interface SkillManagementPort {
  execute(request: SkillManagementRequest): SkillManagementResult;
}
