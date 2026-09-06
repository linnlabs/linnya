import type { BaseTool } from '@plugin/backend/toolRuntime';
import { MindMapCreateNodeTool } from './MindMapCreateNodeTool';

export type MindmapBackendToolClass = new () => BaseTool;

function readToolName(ToolClass: MindmapBackendToolClass): string {
  return new ToolClass().name;
}

export const mindmapToolClasses = [
  MindMapCreateNodeTool,
] as const;

export const mindmapToolNames = mindmapToolClasses.map(readToolName);

export const mindmapToolManifest = {
  classes: mindmapToolClasses,
  allNames: mindmapToolNames,
  names: {
    createNode: readToolName(MindMapCreateNodeTool),
  },
  agentTools: {
    mindmapEditor: ['list_files', 'read_file', 'write_file', readToolName(MindMapCreateNodeTool)],
  },
} as const;
