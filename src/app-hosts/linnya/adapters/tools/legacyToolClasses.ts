import { searchToolClasses } from '../../../../tools/knowledgebase/search';
import { readerToolClasses } from '../../../../tools/knowledgebase/reader';
import { assembleToolClasses } from '../../../../tools/knowledgebase/assemble';
import { evidenceToolClasses } from '../../../../tools/evidence';
import { imageGenerationToolClasses } from '../../../../tools/image_generation';
import {
  askToolClasses,
  subagentToolClasses,
  subrunBatchToolClasses,
  taskStateToolClasses,
} from '../../../../tools/agent_control';
import { workspaceToolClasses } from '../../../../tools/workspace';
import { todoToolClasses } from '../../../../tools/todo';
import { toolOutputToolClasses } from '../../../../tools/tool_output';
import { deepResearchToolClasses } from '../../../../tools/deep_research';
import { webSearchToolClasses, webReadToolClasses } from '../../../../tools/web';
import { skillToolClasses } from '../../../../tools/skill';
import { ProcessTool, ShellTool } from '../../../../tools/commands';
import { markdownToolClasses } from '../../../../domains/markdown/tools';

/**
 * 内置工具 raw list。
 *
 * 中文说明：这个文件只承载“当前内置工具全集”的原始清单，供 platform 插件贡献引用。
 * 不要从这里读取 enabled 状态；运行期消费必须走 BackendPluginRegistry。
 */
export const legacyBuiltinToolClasses = [
  ...searchToolClasses,
  ...readerToolClasses,
  ...assembleToolClasses,
  ...evidenceToolClasses,
  ...imageGenerationToolClasses,
  ...askToolClasses,
  ...workspaceToolClasses,
  ...markdownToolClasses,
  ...todoToolClasses,
  ...taskStateToolClasses,
  ...subagentToolClasses,
  ...subrunBatchToolClasses,
  ...toolOutputToolClasses,
  ...deepResearchToolClasses,
  ...webSearchToolClasses,
  ...webReadToolClasses,
  ...skillToolClasses,
  ShellTool,
  ProcessTool,
] as const;
