import { childRunTrace, graph, runContext, tools } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { DatabaseService } from 'src/electron-main/services/database';
import type { KnowledgeBaseService } from 'src/features/knowledge-base/application/knowledgeBaseService';
import type { WorkspaceMutationPublisher } from 'src/features/workspace/definitions/workspaceMutationPublisher';
import type { ToolContext } from 'src/tools/types';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { RegisteredChildRunInvokerPort } from 'src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import type { CommandRunPermissionContext } from 'src/domains/commands/features/permission-settings';
import type { ShellToolRuntimePort } from 'src/app-hosts/linnya/adapters/commands/shell-runtime/definitions';
import type { PhysicalFileReaderPort } from 'src/app-hosts/linnya/application/file-read';
import type { ConversationWorkDirectoryAdmissionPort } from 'src/app-hosts/linnya/application/conversation-lifecycle';
import type { SubrunTraceHistoryProjectorPort } from 'src/app-hosts/linnya/adapters/persistence/subrun-trace-history/definitions/subrunTraceHistory';
import { createLinnyaChildRunContextInjections } from 'src/app-hosts/linnya/context/agent/createLinnyaFenceInjections';

type CreateSubRunTracePublisher = NonNullable<ToolContext['createSubRunTracePublisher']>;
type RunContext = runContext.RunContext;
type ToolContextPatch = tools.ToolContextPatch;

export interface ToolContextHostServices {
  knowledgeBaseService: KnowledgeBaseService;
  databaseService: DatabaseService;
  workspaceMutationPublisher?: WorkspaceMutationPublisher;
  shellToolRuntime?: ShellToolRuntimePort;
  physicalFileReader?: PhysicalFileReaderPort;
  conversationWorkDirectoryAdmission?: ConversationWorkDirectoryAdmissionPort;
  managedImageIngress?: ToolContext['managedImageIngress'];
  toolResultAssetClaims?: ToolContext['toolResultAssetClaims'];
  commandRunPermission: CommandRunPermissionContext;
  signal?: AbortSignal;
}

export interface ToolContextHostPorts {
  createSubRunTracePublisher: CreateSubRunTracePublisher;
  registeredChildRunInvoker: RegisteredChildRunInvokerPort;
}

export interface CreateRuntimeEventToolContextHostPortsOptions {
  runtimeEventSink: graph.RuntimeEventSink;
  conversationId: string;
  turnId: string;
  registeredChildRunInvoker: RegisteredChildRunInvokerPort;
  subrunTraceHistoryProjector: SubrunTraceHistoryProjectorPort;
}

export interface ToolContextFactoryOptions {
  hostServices: ToolContextHostServices;
  hostPorts: ToolContextHostPorts;
  request: AgentInvokeRequest;
  runContext: RunContext;
  toolContextPatch: ToolContextPatch;
  history: RuntimeEvent[];
  conversationId: string;
  turnId: string;
}

export function createRuntimeEventToolContextHostPorts(
  options: CreateRuntimeEventToolContextHostPortsOptions,
): ToolContextHostPorts {
  return {
    registeredChildRunInvoker: options.registeredChildRunInvoker,
    createSubRunTracePublisher: (publisherOptions) =>
      new childRunTrace.RuntimeEventSubRunTracePublisher({
        runtimeEventSink: (event, source) => {
          const routed = options.runtimeEventSink(event, source);
          if (routed.type !== 'subrun_trace') {
            throw new Error('[ToolContextFactory] subrun trace publisher returned a non-trace event');
          }
          options.subrunTraceHistoryProjector.project(routed);
          return routed;
        },
        conversationId: options.conversationId,
        turnId: options.turnId,
        parentToolCallId: publisherOptions.parentToolCallId,
        subrunId: publisherOptions.subrunId,
        subrunParentId: publisherOptions.subrunParentId,
        source: publisherOptions.source,
        metadata: publisherOptions.metadata,
      }),
  };
}

/**
 * ToolContext 工厂只负责两件事：
 * 1. 把 host 注入的服务与端口投影到 ToolContext
 * 2. 安装 runtime-owned capability（conversationView / execution meta）
 *
 * 中文备注：
 * - host services / host ports 必须由宿主显式提供；
 * - runtime capability 仍由 runtime/tool 层定义，不在这里重新发明。
 */
export function createToolContext(options: ToolContextFactoryOptions): ToolContext {
  const patch = tools.stripRuntimeReservedToolContextPatch(options.toolContextPatch);
  const childRunContextInjections = createLinnyaChildRunContextInjections(options.request);

  const context: ToolContext = {
    ...patch,
    // Enricher 只能追加产品字段；宿主能力必须最后落位，避免 patch 伪造权限或替换受控端口。
    knowledgeBaseService: options.hostServices.knowledgeBaseService,
    userQuery: options.request.query,
    modelId: options.request.model_id,
    imageGenerationModelId: options.request.imageGenerationModelId,
    databaseService: options.hostServices.databaseService,
    workspaceMutationPublisher: options.hostServices.workspaceMutationPublisher,
    shellToolRuntime: options.hostServices.shellToolRuntime,
    physicalFileReader: options.hostServices.physicalFileReader,
    conversationWorkDirectoryAdmission: options.hostServices.conversationWorkDirectoryAdmission,
    managedImageIngress: options.hostServices.managedImageIngress,
    toolResultAssetClaims: options.hostServices.toolResultAssetClaims,
    commandRunPermission: options.hostServices.commandRunPermission,
    workspaceProjectId: options.request.project_metadata?.id,
    workspaceProjectMetadata: options.request.project_metadata,
    ...(childRunContextInjections.length > 0 ? { childRunContextInjections } : {}),
    createSubRunTracePublisher: options.hostPorts.createSubRunTracePublisher,
    registeredChildRunInvoker: options.hostPorts.registeredChildRunInvoker,
    abortSignal: options.hostServices.signal,
  };

  tools.ensureToolContextRuntimeCapability({
    context,
    persistedHistory: options.history,
    workingHistory: options.history,
    executionMeta: {
      conversationId: options.conversationId,
      turnId: options.turnId,
      runId: options.runContext.runId,
      parentRunId: options.runContext.parentId,
    },
  });

  return context;
}
