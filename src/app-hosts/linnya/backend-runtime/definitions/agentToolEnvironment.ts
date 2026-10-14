import type { agentTools } from '@linnlabs/linnkit/context-manager';
import type { tools } from '@linnlabs/linnkit/runtime-kernel';
import type { PhysicalFileReaderPort } from '../../application/file-read';

/** 同一 Host 的根运行与所有子运行共享装配；策略由 composition 提供，不进入基础工具。 */
export interface AgentToolEnvironment {
  readonly toolRuntime: tools.ToolRuntimePort;
  readonly toolManager: agentTools.ToolManager;
  readonly physicalFileReader: PhysicalFileReaderPort;
}
