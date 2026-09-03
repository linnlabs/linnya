export { MarkdownCreateAnnotationsTool } from './create-annotations';
export { WriteToTableTool } from './write-to-table';

import { MarkdownCreateAnnotationsTool } from './create-annotations';
import { WriteToTableTool } from './write-to-table';

/** Markdown 领域专属工具；不属于 Workspace 五件套。 */
export const markdownToolClasses = [
  MarkdownCreateAnnotationsTool,
  WriteToTableTool,
] as const;
