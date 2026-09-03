import type { BaseTool } from '@plugin/backend/toolRuntime';
import { PptPlanTool } from './tools/PptPlanTool';
import { PptInspectTool } from './tools/PptInspectTool';
import { PptExportTool } from './tools/PptExportTool';

export type SlidesBackendToolClass = new () => BaseTool;

function readToolName(ToolClass: SlidesBackendToolClass): string {
  return new ToolClass().name;
}

export const slidesBackendToolClasses = [PptPlanTool, PptInspectTool, PptExportTool] as const;

export const slidesToolNames = slidesBackendToolClasses.map(readToolName);

export const slidesToolManifest = {
  classes: slidesBackendToolClasses,
  allNames: slidesToolNames,
  names: {
    plan: readToolName(PptPlanTool),
    inspect: readToolName(PptInspectTool),
    export: readToolName(PptExportTool),
  },
  agentTools: {
    slidesAgent: [
      //'search_in_knowledgebase',
      'ask',
      'generate_image',
      'shell',
      readToolName(PptPlanTool),
      'list_files',
      'read_file',
      'grep',
      'edit_file',
      'write_file',
      readToolName(PptInspectTool),
      // 当前只允许编辑器菜单下载 PPTX。该旧工具不交付 bytes/locator；完成通用
      // conversation artifact 合同前不得加入 Agent 白名单。
      // readToolName(PptExportTool),
      'tool_output_read',
      'subagent',
      'web_search',
      'web_read',
      'task_write',
      'task_read',
      'skill',
      'process',
    ],
  },
} as const;

export function createSlidesBackendToolClasses(): readonly SlidesBackendToolClass[] {
  return slidesBackendToolClasses;
}
