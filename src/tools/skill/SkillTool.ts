/**
 * @file src/tools/skill/SkillTool.ts
 * @description 统一 Skill 工具入口（薄编排层）
 *
 * 中文备注：
 * - 遵循工具规范："工具是抽象的，具体的复杂实现应该在上层"；
 * - 所有文件读取/目录遍历/路径安全校验均在 catalog 层（features/skills/catalog.ts）；
 * - 本文件只负责：参数校验 → 调用 catalog → 格式化 StructuredToolResult。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../types';
import {
  SkillActivateResultSchema,
  SkillArgsSchema,
  SkillListResourcesResultSchema,
  SkillReadResourceResultSchema,
  SkillResultSchema,
} from '@app/schemas';
import {
  loadSkillContent,
  listSkillResources,
  readSkillResource,
  type SkillContent,
} from '../../features/skills/catalog';
import { sliceSkillResourceWindow } from '../../features/skills/functions/sliceSkillResourceWindow';

// ─── 工具定义 ───

export class SkillTool extends BaseTool {
  readonly name = 'skill';

  /** Skill 不需要在参数尚未接纳时提前创建 UI 卡片。 */
  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    const parsed = SkillArgsSchema.safeParse(args);
    return parsed.success ? { success: true } : { success: false, error: parsed.error.message };
  }

  get description(): string {
    return `Activate a skill or read its resources to get specialized instructions for a task.

# Actions
- activate: Load a skill's full instructions (SKILL.md body). Use when a task matches a skill from the catalog.
- read_resource: Read a supporting file from a skill's directory (e.g. reference docs, examples).
- list_resources: List available resource files in a skill's directory.

# read_resource Windowing
- offset: 1-based line number. Omit to start at line 1.
- limit: Maximum number of lines to return. Omit to read to the end.

# When to Use
- When the skill catalog indicates a relevant skill for the current task.
- When you need additional reference material from an activated skill.

# Important
- Always activate a skill before reading its resources.
- Skill names come from the <available_skills> catalog in context.`;
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The action to perform.',
        enum: ['activate', 'read_resource', 'list_resources'],
      },
      skill_name: {
        type: 'string',
        description: 'The name of the skill (from the skill catalog).',
        minLength: 1,
      },
      resource_path: {
        type: 'string',
        description:
          'Relative path to the resource file within the skill directory (only for read_resource action).',
        minLength: 1,
      },
      offset: {
        type: 'integer',
        description: 'Only for read_resource. 1-based starting line number.',
      },
      limit: {
        type: 'integer',
        description: 'Only for read_resource. Maximum number of lines to return.',
      },
    },
    required: ['action', 'skill_name'],
    additionalProperties: false,
  };

  async run(rawArgs: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const args = SkillArgsSchema.parse(rawArgs);
    const skillName = args.skill_name;

    switch (args.action) {
      case 'activate':
        return this.handleActivate(skillName);
      case 'read_resource': {
        return this.handleReadResource(skillName, args.resource_path, {
          ...(args.offset !== undefined ? { offset: args.offset } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
        });
      }
      case 'list_resources':
        return this.handleListResources(skillName);
    }
  }

  // ─── Action handlers（纯编排 + 格式化，不碰 fs） ───

  private handleActivate(skillName: string): string {
    const content: SkillContent = loadSkillContent(skillName);

    return JSON.stringify(
      SkillActivateResultSchema.parse({
        data: {
          skill_name: content.name,
          source: content.source,
          activated: true,
          resource_count: content.resources.length,
        },
        observation: this.formatActivationOutput(content.name, content.body, content.resources),
      })
    );
  }

  private handleReadResource(
    skillName: string,
    resourcePath: string | undefined,
    windowParams: { offset?: number; limit?: number }
  ): string {
    if (!resourcePath) {
      throw new Error('skill read_resource: resource_path 是必需参数');
    }

    const fileContent = readSkillResource(skillName, resourcePath);
    const window = sliceSkillResourceWindow(fileContent, windowParams);
    const observationHeader = window.isWindowed
      ? `<skill_resource name="${skillName}" path="${resourcePath}" lines="${window.startLine}-${window.endLine}" total_lines="${window.totalLines}">`
      : `<skill_resource name="${skillName}" path="${resourcePath}">`;

    return JSON.stringify(
      SkillReadResourceResultSchema.parse({
        data: {
          skill_name: skillName,
          resource_path: resourcePath,
          total_lines: window.totalLines,
          start_line: window.startLine,
          end_line: window.endLine,
          is_truncated:
            window.isWindowed && (window.startLine > 1 || window.endLine < window.totalLines),
        },
        observation: `${observationHeader}\n${window.text}\n</skill_resource>`,
      })
    );
  }

  private handleListResources(skillName: string): string {
    const resources = listSkillResources(skillName);

    return JSON.stringify(
      SkillListResourcesResultSchema.parse({
        data: { skill_name: skillName, resources },
        observation:
          resources.length > 0
            ? `"${skillName}" 的资源文件：\n${resources.map(r => `  - ${r}`).join('\n')}`
            : `Skill "${skillName}" 没有额外的资源文件。`,
      })
    );
  }

  // ─── 格式化辅助 ───

  private formatActivationOutput(name: string, body: string, resources: string[]): string {
    const resourceSection =
      resources.length > 0
        ? `\n\n可用资源（需要时用 skill(action="read_resource", skill_name="${name}", resource_path="...") 读取）：\n${resources
            .map(r => `  - ${r}`)
            .join('\n')}`
        : '';

    return `<skill_content name="${name}">\n${body}${resourceSection}\n</skill_content>`;
  }

  getExecutionSummary(output: string): string {
    try {
      const result = SkillResultSchema.parse(JSON.parse(output));
      if ('activated' in result.data) {
        const src = formatSkillSourceLabel(result.data.source);
        return `已激活${src} Skill "${result.data.skill_name}"（可用资源 ${result.data.resource_count} 个）`;
      }
      if ('resources' in result.data) {
        return `已列出 Skill "${result.data.skill_name}" 的资源（${result.data.resources.length} 个）`;
      }
      if ('resource_path' in result.data) {
        return `已读取 Skill "${result.data.skill_name}" 的资源：${result.data.resource_path}`;
      }
      return 'Skill 工具已执行。';
    } catch {
      return 'Skill 工具已执行。';
    }
  }
}

function formatSkillSourceLabel(source: unknown): string {
  if (source === 'builtin') return '[内置]';
  if (source === 'plugin') return '[插件]';
  return '[用户]';
}
