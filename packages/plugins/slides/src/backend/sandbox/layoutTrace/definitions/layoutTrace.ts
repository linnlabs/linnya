import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';

export type LayoutTraceNodeType =
  | 'Slide'
  | 'View'
  | 'Text'
  | 'Shape'
  | 'Chart'
  | 'Table'
  | 'Image'
  | 'SvgGraphic'
  | 'Formula'
  | 'Spacer';

export interface LayoutTraceNode extends SandboxJsonObject {
  id: number;
  type: LayoutTraceNodeType;
  startLine: number;
  endLine: number;
  children: number[];
  configured: boolean;
  content: boolean;
}

export interface LayoutTraceSnapshot extends SandboxJsonObject {
  version: 1;
  truncated: boolean;
  nodes: LayoutTraceNode[];
  roots: number[];
}
