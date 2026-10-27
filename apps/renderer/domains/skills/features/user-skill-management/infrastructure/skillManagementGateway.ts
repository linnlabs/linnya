import { SkillManagementErrorSchema, SkillManagementRequestSchema, SkillManagementResultSchema,
  type SkillManagementRequest, type SkillManagementResult } from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';

export async function executeSkillManagement(request: SkillManagementRequest): Promise<SkillManagementResult> {
  const base = await getApiBaseUrl();
  const response = await apiFetch(`${base}/api/v1/skills`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SkillManagementRequestSchema.parse(request)),
  });
  if (!response.ok) throw new Error(SkillManagementErrorSchema.parse(await response.json()).message);
  return SkillManagementResultSchema.parse(await response.json());
}
