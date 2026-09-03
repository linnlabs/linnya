/**
 * @file src/tools/workspace/index.ts
 * @description Workspace 工具导出与注册
 */

export { ListFilesTool } from './list_files';
export { ReadFileTool } from './read_file';
export { GrepTool } from './grep';
export { EditFileTool } from './edit_file';
export { WriteFileTool } from './write_file';

import { ListFilesTool } from './list_files';
import { ReadFileTool } from './read_file';
import { GrepTool } from './grep';
import { EditFileTool } from './edit_file';
import { WriteFileTool } from './write_file';

export const workspaceToolClasses = [
  ListFilesTool,
  ReadFileTool,
  GrepTool,
  EditFileTool,
  WriteFileTool,
] as const;
