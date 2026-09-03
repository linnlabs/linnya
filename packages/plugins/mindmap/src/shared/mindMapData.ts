import type { NodeTagging } from './tagging';

export interface DraftMindMapNodeData {
  id?: string;
  topic?: string;
  root?: boolean;
  children?: DraftMindMapNodeData[];
  [key: string]: unknown;
}

export interface DraftMindMapData {
  nodeData?: DraftMindMapNodeData;
  arrows?: unknown[];
  summaries?: unknown[];
  direction?: unknown;
  theme?: unknown;
  [key: string]: unknown;
}

export interface MindMapNodeData {
  id: string;
  topic: string;
  root?: boolean;
  children: MindMapNodeData[];
  tagging?: NodeTagging;
  [key: string]: unknown;
}

export interface MindMapTheme {
  name?: string;
  [key: string]: unknown;
}

export interface MindMapData {
  nodeData: MindMapNodeData;
  arrows: unknown[];
  summaries: unknown[];
  direction: number;
  theme?: MindMapTheme;
  [key: string]: unknown;
}
