import { z } from 'zod';
import {
  HistoricalResourceReadArgsSchema,
  SkillArgsSchema,
  SkillManagementRequestSchema,
  SkillManagementResultSchema,
  HistoricalSkillResourceReadResultSchema,
  SkillResultSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import type { SkillPresentationData } from '../definitions/skillPresentation';

const SKILL_RESOURCE_PREFIX = 'skill://skills/';

function parseSkillResourceIdentity(uri: string): { skillName: string; resourcePath: string } {
  const identity = tryParseSkillResourceIdentity(uri);
  if (!identity) throw new Error(`Unsupported Skill resource URI: ${uri}`);
  return identity;
}

function tryParseSkillResourceIdentity(
  uri: string
): { skillName: string; resourcePath: string } | undefined {
  if (!uri.startsWith(SKILL_RESOURCE_PREFIX)) return undefined;
  const identity = uri.slice(SKILL_RESOURCE_PREFIX.length);
  const separatorIndex = identity.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === identity.length - 1) return undefined;
  return {
    skillName: identity.slice(0, separatorIndex),
    resourcePath: identity.slice(separatorIndex + 1),
  };
}

function assertSkillResultMatchesArgs(
  args: ReturnType<typeof SkillArgsSchema.parse>,
  result: ReturnType<typeof SkillResultSchema.parse>
): void {
  if (result.data.skill_name !== args.skill_name) {
    throw new Error('Skill result identity does not match its tool arguments.');
  }
  if (args.action === 'activate' && !('activated' in result.data)) {
    throw new Error('Skill activate returned a result for another action.');
  }
  if (args.action === 'list_resources' && !('resources' in result.data)) {
    throw new Error('Skill list_resources returned a result for another action.');
  }
  if (args.action === 'read_resource') {
    if (!('resource_path' in result.data) || result.data.resource_path !== args.resource_path) {
      throw new Error('Skill read_resource result does not match its tool arguments.');
    }
  }
}

const SkillManageToolResultSchema = z.object({
  data: SkillManagementResultSchema,
  observation: z.string(),
}).strict();

function projectManageData(
  request: ReturnType<typeof SkillManagementRequestSchema.parse>
): Extract<SkillPresentationData, { kind: 'manage' }> {
  return {
    kind: 'manage',
    action: request.action,
    skillName: 'name' in request ? request.name : undefined,
    path: 'path' in request ? request.path : undefined,
  };
}

function projectSkillManagePresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<SkillPresentationData> {
  if (input.status !== 'success') {
    // 生命周期阶段参数可能还不完整：能解析就显示具体动作，否则退回通用的“正在处理”。
    const lifecycle = SkillManagementRequestSchema.safeParse(input.args);
    return { data: lifecycle.success ? projectManageData(lifecycle.data) : { kind: 'lifecycle' } };
  }
  const request = SkillManagementRequestSchema.parse(input.args);
  const result = SkillManageToolResultSchema.parse(input.result);
  if (result.data.action !== request.action || ('name' in request && 'name' in result.data && result.data.name !== request.name)) {
    throw new Error('Skill manage result does not match its tool arguments.');
  }
  return { data: projectManageData(request) };
}

export function projectSkillPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<SkillPresentationData> {
  if (input.sourceToolName === 'skill_manage' && input.uiKey === 'skill_manage') {
    return projectSkillManagePresentation(input);
  }

  if (input.sourceToolName === 'skill' && input.uiKey === 'skill') {
    if (input.status !== 'success') {
      const lifecycleArgs = SkillArgsSchema.safeParse(input.args);
      if (!lifecycleArgs.success) return { data: { kind: 'lifecycle' } };
      return {
        data: {
          kind: 'skill',
          action: lifecycleArgs.data.action,
          skillName: lifecycleArgs.data.skill_name,
        },
      };
    }
    const args = SkillArgsSchema.parse(input.args);
    assertSkillResultMatchesArgs(args, SkillResultSchema.parse(input.result));
    return {
      data: {
        kind: 'skill',
        action: args.action,
        skillName: args.skill_name,
      },
    };
  }

  if (input.sourceToolName === 'resource_read' && input.uiKey === 'skill_resource_read') {
    if (input.status !== 'success') {
      const lifecycleArgs = HistoricalResourceReadArgsSchema.safeParse(input.args);
      if (!lifecycleArgs.success) return { data: { kind: 'lifecycle' } };
      const request = tryParseSkillResourceIdentity(lifecycleArgs.data.uri);
      if (!request) return { data: { kind: 'lifecycle' } };
      return { data: { kind: 'resource', skillName: request.skillName } };
    }
    const args = HistoricalResourceReadArgsSchema.parse(input.args);
    const request = parseSkillResourceIdentity(args.uri);
    const result = HistoricalSkillResourceReadResultSchema.parse(input.result);
    if (
      result.data.uri !== args.uri ||
      result.data.skill_name !== request.skillName ||
      result.data.resource_path !== request.resourcePath
    ) {
      throw new Error('Skill resource result identity does not match its tool arguments.');
    }
    return {
      data: {
        kind: 'resource',
        skillName: request.skillName,
      },
    };
  }

  throw new Error(
    `Unsupported Skill presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`
  );
}
