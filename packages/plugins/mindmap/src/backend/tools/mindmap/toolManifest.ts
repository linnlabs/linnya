import type { BaseTool } from '@plugin/backend/toolRuntime';
import { MindMapTagNodeTool } from './MindMapTagNodeTool';
import { MindMapAttachEvidenceTool } from './MindMapAttachEvidenceTool';
import { MindMapCreateNodeTool } from './MindMapCreateNodeTool';
import {
  MindMapSubrunDecomposeTool,
  MindMapSubrunParallelTool,
  MindMapSubrunProposeTool,
  MindMapSubrunValidateTool,
} from './mindmapSubagentTools';

export type MindmapBackendToolClass = new () => BaseTool;

function readToolName(ToolClass: MindmapBackendToolClass): string {
  return new ToolClass().name;
}

export const mindmapToolClasses = [
  MindMapTagNodeTool,
  MindMapAttachEvidenceTool,
  MindMapCreateNodeTool,
  MindMapSubrunDecomposeTool,
  MindMapSubrunProposeTool,
  MindMapSubrunValidateTool,
  MindMapSubrunParallelTool,
] as const;

export const mindmapToolNames = mindmapToolClasses.map(readToolName);

export const mindmapToolManifest = {
  classes: mindmapToolClasses,
  allNames: mindmapToolNames,
  names: {
    tagNode: readToolName(MindMapTagNodeTool),
    attachEvidence: readToolName(MindMapAttachEvidenceTool),
    createNode: readToolName(MindMapCreateNodeTool),
    subrunDecompose: readToolName(MindMapSubrunDecomposeTool),
    subrunPropose: readToolName(MindMapSubrunProposeTool),
    subrunValidate: readToolName(MindMapSubrunValidateTool),
    subrunParallel: readToolName(MindMapSubrunParallelTool),
  },
  agentTools: {
    decomposeQuestion: [
      'read_file',
      readToolName(MindMapCreateNodeTool),
      'search_in_knowledgebase',
    ],
    proposeHypothesis: [
      'list_files',
      'read_file',
      readToolName(MindMapCreateNodeTool),
    ],
    reasoningCanvas: [
      'list_files',
      'read_file',
      'write_file',
      readToolName(MindMapTagNodeTool),
      readToolName(MindMapAttachEvidenceTool),
      readToolName(MindMapCreateNodeTool),
      'knowledge_search',
      'list_knowledge_base',
      'knowledge_read',
      'todo_read',
      'todo_write',
      'generate_image',
    ],
    validateHypothesis: [
      'read_file',
      readToolName(MindMapTagNodeTool),
      readToolName(MindMapAttachEvidenceTool),
      readToolName(MindMapCreateNodeTool),
      'search_in_knowledgebase',
      'list_knowledge_base',
      'knowledge_read',
    ],
    workflowLeader: [
      'read_file',
      readToolName(MindMapSubrunDecomposeTool),
      readToolName(MindMapSubrunProposeTool),
      readToolName(MindMapSubrunValidateTool),
      readToolName(MindMapSubrunParallelTool),
      'search_in_knowledgebase',
    ],
  },
} as const;
