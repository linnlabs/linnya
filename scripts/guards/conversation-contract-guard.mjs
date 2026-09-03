import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const violations = [];

const canonicalFiles = new Map([
  [
    'packages/schemas/src/json-value.ts',
    ['JsonValueSchema', 'JsonRecordSchema'],
  ],
  [
    'packages/schemas/src/conversation/message-identity.ts',
    [
      'conversationMessageIdFromAnswerId',
      'conversationMessageIdFromToolIdentity',
      'run_id + tool_call_id',
    ],
  ],
  [
    'packages/schemas/src/conversation/message-metadata.ts',
    [
      'ConversationMessageExtensionSchema',
      'ConversationAnswerMessageMetadataSchema',
      'parseConversationAnswerMessageMetadata',
    ],
  ],
  [
    'packages/schemas/src/conversation/tool-message.ts',
    [
      'ConversationToolMessageMetadataSchema',
      'ConversationActiveToolInteractionSchema',
      'ConversationTerminalToolInteractionSchema',
      'ConversationInteractionResponseToolMetadataSchema',
      'loading tool message must not have completed_at',
    ],
  ],
  [
    'packages/schemas/src/api-dtos.ts',
    ['metadata: ConversationInteractionResponseToolMetadataSchema.optional()'],
  ],
  [
    'src/app-hosts/linnya/adapters/flow/interactive-run/functions/buildInteractionResponseIncomingEvent.ts',
    ['ConversationTerminalToolInteractionSchema.parse', 'metadata: { interaction }'],
  ],
  [
    'packages/schemas/src/conversation/ui-message.ts',
    ["z.discriminatedUnion('message_type'", 'ConversationUiMessageSchema', 'presentation: z.null()'],
  ],
  [
    'apps/renderer/domains/conversation/types/index.ts',
    ['export type BaseMessage =', 'export type AnswerMessage =', 'toolPresentation?: ToolCardPresentation'],
  ],
  [
    'apps/renderer/domains/conversation/message-window/functions/mapUiMessageDto.ts',
    ['parseConversationAnswerMessageMetadata', 'projectToolCardPresentation'],
  ],
  [
    'apps/renderer/domains/conversation/services/messageProjection/helpers/toolPatch.ts',
    ['prepareToolCallMessageCandidate', 'commitPreparedToolPatch'],
  ],
  [
    'apps/renderer/domains/conversation/services/messageProjection/helpers/prepareToolCallMessageCandidate.ts',
    ['projectToolCardPresentation', 'ConversationToolMessageMetadataSchema.parse', 'ToolMessageService.patchMetadata'],
  ],
  [
    'packages/plugin-host-contract/renderer/toolUi.ts',
    ['ToolCardPresentation', 'ToolPresentationProjector', 'ToolLocalizedTextDescriptor'],
  ],
  [
    'apps/renderer/domains/conversation/message-window/functions/uiMessagesDtoGuards.ts',
    ['ConversationUiMessageSchema.safeParse'],
  ],
  [
    'apps/renderer/domains/conversation/functions/cloneConversationMessage.ts',
    ['cloneConversationMessage', "case 'summarization_progress'"],
  ],
  [
    'apps/renderer/domains/conversation/testing/functions/createConversationTestMessage.ts',
    ['createTestThoughtMessage', 'createTestToolMessage', 'createTestAnswerMessage'],
  ],
  [
    'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/projectEvent.ts',
    ['ConversationTerminalAnswerPayloadSchema', 'ConversationToolPreamblePayloadSchema'],
  ],
  [
    'packages/schemas/src/conversation/visual-turn-identity.ts',
    [
      'ConversationVisualTurnIdSchema',
      'ConversationCompleteVisualTurnIdSchema',
      'ConversationPartialVisualTurnIdSchema',
      'conversationVisualTurnIdFromUserMessageId',
      'conversationPartialVisualTurnIdFromMessageId',
    ],
  ],
  [
    'apps/renderer/domains/conversation/ui/messageCanvas/components/ConversationMessageCanvas.vue',
    [
      'ConversationVisualRow',
      'indexConversationVisualTurnMessages',
      'ConversationAnswerRenderHost',
    ],
  ],
  [
    'apps/renderer/domains/conversation/ui/messageCanvas/components/ConversationVisualRow.vue',
    ['<Message', 'ConversationVisualRowActions', 'conversation-visual-row'],
  ],
  [
    'apps/renderer/domains/conversation/ui/conversationView/components/VirtualConversationCanvas.vue',
    ['ConversationMessageCanvas', 'offsetPx: entry.virtualItem.start - props.scrollMargin'],
  ],
  [
    'apps/renderer/domains/conversation/features/subrun-detail/ui/SubrunDetailSurface.vue',
    ['ConversationMessageCanvas', 'useAppendOnlyConversationVisualRows'],
  ],
  [
    'apps/renderer/domains/conversation/features/timeline/functions/timelineMarkers.ts',
    ['conversationVisualTurnIdFromUserMessageId(message.id)'],
  ],
  [
    'apps/renderer/domains/conversation/features/user-input-admission/orchestration/createConversationUserInputAdmission.ts',
    ['assertConversationUserInputCommit', 'durable commit ack received more than once'],
  ],
  [
    'apps/renderer/domains/conversation/functions/committedUserInput.ts',
    ['mapCommittedUserInputToMessage'],
  ],
  [
    'apps/renderer/domains/conversation/services/messageProjection/projectors/userInput.ts',
    ['id: event.id', "type: 'user_input'"],
  ],
  [
    'packages/schemas/src/conversation/summary-message.ts',
    [
      'ConversationHistorySummaryPayloadSchema',
      'ConversationSummarizationPresentationIdSchema',
      'ConversationSummarizationProgressMetadataSchema',
    ],
  ],
  [
    'apps/renderer/domains/conversation/services/messageProjection/projectors/summary.ts',
    ["message.type !== 'summarization_progress'", "type: 'history_summary'"],
  ],
  [
    'packages/linnkit/src/contracts/sse.ts',
    ['summarization_id: RuntimeEventIdSchema', 'original_message_count', 'compressed_message_count'],
  ],
  [
    'packages/linnkit/src/contracts/events.ts',
    ['original_message_count: z.number().int().nonnegative()', 'original_message_count: originalMessageCount'],
  ],
  [
    'packages/linnkit/src/contracts/summarization.ts',
    ['interface SummarizationCallbacks', "Extract<RuntimeEvent, { type: 'history_summary' }>"],
  ],
  [
    'src/app-hosts/linnya/adapters/flow/agent-runner/summarizationEventEmitter.ts',
    ['summarization_id: summarizationId', 'run_id: options.runId', 'execution_id: options.executionId'],
  ],
  [
    'src/tools/tool_output/definitions/toolOutputBlob.ts',
    ['ToolOutputBlobManifestSchema', 'instance_id:', 'ToolOutputBlobSourceNameSchema'],
  ],
  [
    'src/tools/tool_output/orchestration/createToolOutputTextBlobWriter.ts',
    ['ToolOutputBlobManifestSchema.parse', 'computeToolOutputBlobId(manifest)'],
  ],
  [
    'src/tools/tool_output/orchestration/readToolOutputTextWindow.ts',
    ['parseToolOutputBlobId', 'computeToolOutputBlobId(manifest)'],
  ],
  [
    'packages/linnkit/src/contracts/sub-run-trace-payload.ts',
    ['export const SubRunTraceKind', 'kind: SubRunTraceKind'],
  ],
  [
    'apps/renderer/domains/conversation/features/subrun-trace/definitions/subrunTracePresentation.ts',
    ['readonly toolCallId: string'],
  ],
  [
    'apps/renderer/domains/conversation/features/subrun-trace/ui/SubrunTracePanel.vue',
    [':key="s.toolCallId"'],
  ],
  [
    'src/features/conversation/history/ui-messages.schemas.ts',
    ['SubrunTraceKindSchema = RuntimeSubRunTraceKindSchema'],
  ],
  [
    'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteUiMessagesReader.ts',
    [
      'visual_turn_id: conversationVisualTurnIdFromUserMessageId(row.message_id)',
      'decodeSubrunTraceHistoryEvent',
      'SubRunTraceKindSchema.parse',
      'requestedKinds ?? []',
    ],
  ],
  [
    'src/app-hosts/linnya/adapters/persistence/subrun-trace-history/functions/subrunTraceHistoryPayload.ts',
    ['RuntimeEvent.parse', "parsed.type !== 'subrun_trace'"],
  ],
  [
    'packages/plugin-host-contract/renderer/subrunToolUi.ts',
    ["HistoricalSubrunTraceKind = SubRunTraceEvent['kind']"],
  ],
  [
    'packages/schemas/src/tools/tool-output-read.ts',
    ['start_offset:', 'end_offset_exclusive:', 'next_offset:', 'first unread character offset'],
  ],
  [
    'src/tools/tool_output/definitions/toolOutputRead.ts',
    ['ToolOutputReadArgsSchema', 'offset:', 'limit:'],
  ],
  [
    'src/tools/tool_output/functions/sliceToolOutputWindow.ts',
    ['nextOffset: endOffsetExclusive < candidate.totalChars ? endOffsetExclusive : null'],
  ],
]);

for (const [relativePath, requiredFragments] of canonicalFiles) {
  const source = readRequiredFile(relativePath);
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) {
      violations.push(`${relativePath}: 缺少权威合同调用 ${fragment}`);
    }
  }
}

const replayContractPath = 'apps/renderer/domains/conversation/services/messageProjection/guards/replayEvents.ts';
if (fs.existsSync(path.join(repoRoot, replayContractPath))) {
  violations.push(`${replayContractPath}: 禁止恢复私有 replay 事件合同`);
}

// Todo 是普通工具。旧 Runtime/Conversation 专属状态已物理删除，生产代码不得重新引入第二条状态链。
const removedTodoRuntimePatterns = [
  { pattern: /\btodo_updated\b/, message: '禁止恢复 Todo RuntimeEvent/SSE variant' },
  { pattern: /\bagent_todo_json\b/, message: '禁止恢复 Conversation Todo 持久化快照' },
  { pattern: /\bAgentTodoSnapshot\b/, message: '禁止恢复 Linnkit Todo snapshot contract' },
  { pattern: /\bagentTodo\b/, message: '禁止恢复 Conversation agentTodo 状态镜像' },
  { pattern: /\bTodoEventId\b/, message: '禁止恢复 Todo Runtime identity' },
  { pattern: /\bcreateTodoUpdated\b/, message: '禁止恢复 Todo 事件工厂' },
];
const todoRuntimeBoundaryRoots = [
  'packages/linnkit/src',
  'src/app-hosts/linnya',
  'apps/renderer/domains/conversation',
];
for (const root of todoRuntimeBoundaryRoots) {
  for (const relativePath of productionFiles(root)) {
    const source = readRequiredFile(relativePath);
    for (const { pattern, message } of removedTodoRuntimePatterns) {
      if (pattern.test(source)) violations.push(`${relativePath}: ${message}`);
    }
  }
}

// Resource 是已经退役的跨领域 executable。历史 schema 与旧事件卡片只允许留在
// packages/schemas 和 Renderer replay/projector；执行内核、Host、领域工具与插件不得
// 再生产该工具名，否则会重新把 VFS、Skill、Knowledge、Web 等边界耦合到一起。
const retiredResourceExecutableRoots = [
  'packages/linnkit/src',
  'packages/plugin-host-contract/backend',
  'packages/plugins',
  'src/features',
  'src/tools',
  'src/app-hosts/linnya',
];
for (const root of retiredResourceExecutableRoots) {
  for (const relativePath of productionFiles(root)) {
    if (relativePath.includes('/__tests__/') || relativePath.includes('/__fixtures__/')) continue;
    const source = readRequiredFile(relativePath);
    if (/['"]resource_read['"]/.test(source)) {
      violations.push(`${relativePath}: resource_read 只允许历史 replay/projector 使用，禁止恢复 live executable 或 producer`);
    }
  }
}

// INV-57：后端工具不得通过 definition 或 RuntimeEvent metadata 驱动 Renderer 展示。
const removedBackendToolUiPatterns = [
  { pattern: /\bToolDisplayOptions\b/, message: '禁止恢复后端 ToolDisplayOptions 合同' },
  { pattern: /\bToolPresentationPort\b/, message: '禁止恢复 runtime ToolPresentationPort' },
  { pattern: /\bdisplayOptions\b/, message: '禁止把工具展示配置写入 definition 或事件 metadata' },
  { pattern: /\bgetDisplayOptions\b/, message: '禁止恢复后端工具展示查询端口' },
];
const backendToolUiBoundaryRoots = [
  'packages/linnkit/src',
  'packages/plugin-host-contract/backend',
  'packages/plugins',
  'src/tools',
  'src/plugin-sdk/backend',
  'src/app-hosts/linnya',
];
for (const root of backendToolUiBoundaryRoots) {
  for (const relativePath of productionFiles(root)) {
    const source = readRequiredFile(relativePath);
    for (const { pattern, message } of removedBackendToolUiPatterns) {
      if (pattern.test(source)) violations.push(`${relativePath}: ${message}`);
    }
  }
}

const toolMessageContractSource = readRequiredFile(
  'packages/schemas/src/conversation/tool-message.ts',
);
if (/^\s*ui\s*:/m.test(toolMessageContractSource)) {
  violations.push(
    'packages/schemas/src/conversation/tool-message.ts: 工具 metadata 禁止恢复 ui 展示控制字段',
  );
}

const identityCriticalFiles = [
  ...productionFiles('apps/renderer/domains/conversation/features/timeline'),
  ...productionFiles('apps/renderer/domains/conversation/ui/components/timeline'),
  ...productionFiles('apps/renderer/domains/conversation/ui/messageCanvas'),
  ...productionFiles('apps/renderer/domains/conversation/ui/conversationView/logic'),
  'apps/renderer/domains/conversation/ui/conversationView/composables/useTanstackConversationVirtualizer.ts',
  'apps/renderer/domains/conversation/ui/conversationView/composables/useConversationTimelinePositions.ts',
  'apps/renderer/domains/conversation/ui/conversationView/composables/useConversationScrollController.ts',
  'apps/renderer/domains/conversation/ui/conversationView/components/VirtualConversationCanvas.vue',
  'apps/renderer/domains/conversation/ui/ConversationView.vue',
  'apps/renderer/domains/conversation/ui/ConversationHost.vue',
];

const forbiddenIdentityPatterns = [
  { pattern: /\bturnId\b/, message: 'visual/timeline 链路禁止使用含糊 turnId' },
  { pattern: /\bscrollToTurn\b/, message: '导航必须使用 scrollToVisualTurn' },
  { pattern: /\bwaitForTurnMounted\b/, message: '挂载等待必须使用 waitForVisualTurnMounted' },
  { pattern: /\bnavigateToTimelineTurn\b/, message: '导航编排必须使用 navigateToTimelineVisualTurn' },
  { pattern: /\bactiveTurnId\b/, message: '激活身份必须使用 activeVisualTurnId' },
  { pattern: /`turn_\$\{/, message: '禁止手工拼接 visual turn identity' },
];

for (const relativePath of identityCriticalFiles) {
  const source = readRequiredFile(relativePath);
  for (const { pattern, message } of forbiddenIdentityPatterns) {
    if (pattern.test(source)) violations.push(`${relativePath}: ${message}`);
  }
}

// INV-59：共享画布只拥有展示语义；主时间线和 Subrun 分别拥有虚拟化/导航编排。
for (const relativePath of productionFiles('apps/renderer/domains/conversation/ui/messageCanvas')) {
  const source = readRequiredFile(relativePath);
  if (/from ['"][^'"]*(?:\/store\/|\/message-window\/|\/features\/timeline\/|@tanstack)/.test(source)) {
    violations.push(`${relativePath}: 共享 message canvas 禁止读取 store、窗口、timeline 或 TanStack`);
  }
  if (/from ['"][^'"]*tools\/knowledge\/clipboard\//.test(source)) {
    violations.push(`${relativePath}: 共享 message canvas 只能消费 clipboard feature 的公开出口`);
  }
}
const subrunDetailSurfaceSource = readRequiredFile(
  'apps/renderer/domains/conversation/features/subrun-detail/ui/SubrunDetailSurface.vue',
);
if (/import\s+Message\s+from|subrun-detail__messages|@tanstack/.test(subrunDetailSurfaceSource)) {
  violations.push('SubrunDetailSurface: 完整 child messages 必须复用共享 message canvas，禁止自建消息循环或 virtualizer');
}

const turnIndexContractFiles = [
  'src/features/conversation/history/ui-messages.schemas.ts',
  'apps/renderer/domains/conversation/features/timeline/definitions/timelineTurnIndex.ts',
  'apps/renderer/domains/conversation/features/timeline/functions/timelineTurnIndexDtoGuard.ts',
];
for (const relativePath of turnIndexContractFiles) {
  const source = readRequiredFile(relativePath);
  if (/\bturn_id\b/.test(source)) {
    violations.push(`${relativePath}: timeline wire 禁止使用 Runtime 名称 turn_id`);
  }
}

const projectionRoot = 'apps/renderer/domains/conversation/services/messageProjection';
for (const relativePath of productionFiles(projectionRoot)) {
  const source = readRequiredFile(relativePath);
  if (/\binterface\s+Replay[A-Za-z0-9_]*Event\b/.test(source)) {
    violations.push(`${relativePath}: 禁止手写 Replay*Event，必须消费正式事件合同`);
  }
}

const userInputAdmissionRoots = [
  'apps/renderer/domains/conversation',
  'apps/renderer/app/workflows',
  'apps/renderer/app/plugins/builtin',
];
for (const root of userInputAdmissionRoots) {
  for (const relativePath of productionFiles(root)) {
    const source = readRequiredFile(relativePath);
    if (/\baddUserMessage\b/.test(source)) {
      violations.push(
        `${relativePath}: 禁止在 Renderer 创建正式用户消息；必须等待 user_input_committed`,
      );
    }
    if (/\bprepare[A-Za-z0-9]*RunHeader\b/.test(source)) {
      violations.push(`${relativePath}: RunHeader 旧 API 会在 durable ack 前制造消息，禁止恢复`);
    }
  }
}

const summaryContractFiles = [
  ...productionFiles('apps/renderer/domains/conversation'),
  'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/projectEvent.ts',
];
for (const relativePath of summaryContractFiles) {
  const source = readRequiredFile(relativePath);
  if (/\bas\s+SummaryMessage\b/.test(source)) {
    violations.push(`${relativePath}: summary 必须由正式判别字段和 schema 收窄，禁止类型断言`);
  }
  if (/\btype\s+SummaryStatus\b/.test(source)) {
    violations.push(`${relativePath}: 禁止重复声明 SummaryStatus`);
  }
  if (/\bsummaryStatus\s*:|\bsummaryInfo\s*:/.test(source)) {
    violations.push(`${relativePath}: 禁止恢复旧顶层 summaryStatus/summaryInfo payload`);
  }
  if (/\b(?:createSummaryMessage|updateSummaryMessage)\b/.test(source)) {
    violations.push(`${relativePath}: summarization presentation 不得伪装成 durable summary message`);
  }
}

const summarizationProtocolFiles = [
  'packages/linnkit/src/contracts/sse.ts',
  'src/app-hosts/linnya/adapters/flow/agent-runner/summarizationEventEmitter.ts',
];
for (const relativePath of summarizationProtocolFiles) {
  const source = readRequiredFile(relativePath);
  if (/\boriginalMessages\s*:|\bcompressedMessages\s*:|\bcompressionRatio\s*:/.test(source)) {
    violations.push(`${relativePath}: summarization wire 禁止恢复旧 camelCase 统计字段`);
  }
}

const summaryProjectorSource = readRequiredFile(
  'apps/renderer/domains/conversation/services/messageProjection/projectors/summary.ts',
);
if (/event\.(?:originalMessages|compressedMessages|compressionRatio)\b/.test(summaryProjectorSource)) {
  violations.push('summary projector: 禁止读取旧 camelCase summarization wire 字段');
}

const runtimeSummaryContractSources = [
  readRequiredFile('packages/linnkit/src/contracts/sse.ts'),
  readRequiredFile('src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/projectEvent.ts'),
].join('\n');
if (/original_message_count\s*\?\?/.test(runtimeSummaryContractSources)) {
  violations.push('history_summary: original_message_count 是必填事实，消费层禁止猜值');
}

const summarizationEmitterSource = readRequiredFile(
  'src/app-hosts/linnya/adapters/flow/agent-runner/summarizationEventEmitter.ts',
);
if (/Math\.random|\.\.\.summaryInfo/.test(summarizationEmitterSource)) {
  violations.push('summarizationEventEmitter: 禁止随机 presentation identity 或展开 callback 对象');
}
const flowSchemasSource = readRequiredFile('src/app-hosts/linnya/adapters/flow/flow.schemas.ts');
if (/\b(?:interface|type)\s+SummarizationInfo\b/.test(flowSchemasSource)) {
  violations.push('flow.schemas.ts: 禁止复制 Linnkit SummarizationCallbacks 合同');
}

const canonicalSummarizationCallbacksPath = 'packages/linnkit/src/contracts/summarization.ts';
for (const relativePath of productionFiles('packages/linnkit/src')) {
  if (relativePath === canonicalSummarizationCallbacksPath) continue;
  const source = readRequiredFile(relativePath);
  if (/\binterface\s+SummarizationCallbacks\b/.test(source)) {
    violations.push(`${relativePath}: SummarizationCallbacks 只能在 Linnkit contracts 定义`);
  }
  if (/onSummarizationEnd\?\s*:\s*\([^)]*:\s*unknown\)/.test(source)) {
    violations.push(`${relativePath}: summary callback 禁止退化为 unknown`);
  }
}

const conversationTypesSource = readRequiredFile(
  'apps/renderer/domains/conversation/types/index.ts',
);
if (/onSummarization(?:Start|End)\?/.test(conversationTypesSource)) {
  violations.push('conversation types: 调用方 callbacks 不得复制 realtime summary 生命周期');
}

const messageFieldsMatch = conversationTypesSource.match(
  /interface\s+ConversationMessageFields\s*\{([\s\S]*?)\n\}/,
);
if (!messageFieldsMatch) {
  violations.push('conversation types: 缺少 ConversationMessageFields 权威定义');
} else {
  const messageFields = messageFieldsMatch[1];
  if (/\[key:\s*string\]\s*:\s*unknown/.test(messageFields)) {
    violations.push('conversation types: BaseMessage metadata 禁止恢复开放索引签名');
  }
  if (/\bstatus\??\s*:/.test(messageFields)) {
    violations.push('conversation types: 工具状态只能存在于 tool metadata，禁止恢复顶层 status');
  }
}

const pluginInvocationContracts = [
  'packages/plugin-host-contract/renderer/aiInvocationPort.ts',
  'packages/plugin-host-contract/renderer/conversationSubrunInvocationPort.ts',
];
for (const relativePath of pluginInvocationContracts) {
  const source = readRequiredFile(relativePath);
  if (/\b(?:messageMetadata|userInputMetadata)\??\s*:/.test(source)) {
    violations.push(`${relativePath}: 插件输入只能使用 messageExtension`);
  }
  if (/interface\s+(?:RendererConversationMessageExtension|ConversationSubrunMessageExtension)\b/.test(source)) {
    violations.push(`${relativePath}: 插件扩展必须从 @app/schemas 派生，禁止重列字段`);
  }
  if (!/ConversationMessageExtension/.test(source)) {
    violations.push(`${relativePath}: 缺少权威 ConversationMessageExtension 引用`);
  }
}

const toolTimestampOwners = [
  'apps/renderer/domains/conversation/services/messageProjection/projectors/tool.ts',
  'apps/renderer/domains/conversation/features/subrun-card/functions/projectSubrunTraceEvent.ts',
  'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/toolProjection.ts',
];
for (const relativePath of toolTimestampOwners) {
  const source = readRequiredFile(relativePath);
  if (/Date\.now\(\)/.test(source)) {
    violations.push(`${relativePath}: 工具 started_at/completed_at 必须来自事件 timestamp`);
  }
}

const canonicalToolMessageIdentityOwners = [
  'apps/renderer/domains/conversation/services/messageProjection/projectors/tool.ts',
  'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/projectEvent.ts',
];
for (const relativePath of canonicalToolMessageIdentityOwners) {
  const source = readRequiredFile(relativePath);
  if (!source.includes('conversationMessageIdFromToolIdentity')) {
    violations.push(`${relativePath}: Tool UI message identity 必须从 run_id + tool_call_id 派生`);
  }
  if (/`\$\{event\.id\}_\$\{call\.id\}`/.test(source)) {
    violations.push(`${relativePath}: batch Tool message 禁止从 event id 与 tool call id 拼接身份`);
  }
}

const rendererToolProjectorSource = readRequiredFile(
  'apps/renderer/domains/conversation/services/messageProjection/projectors/tool.ts',
);
if (/messageId:\s*event\.id/.test(rendererToolProjectorSource)) {
  violations.push('Renderer Tool projector: 禁止使用首个到达的 event id 作为 message identity');
}

const hostToolProjectorSource = readRequiredFile(
  'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/projectEvent.ts',
);
if (/function\s+toolMergeKey\(toolCallId/.test(hostToolProjectorSource)) {
  violations.push('Host Tool projector: merge_key 必须包含 run scope，禁止退回裸 tool_call_id');
}

const flowOrchestratorSource = readRequiredFile(
  'src/app-hosts/linnya/adapters/flow/flow.orchestrator.ts',
);
if (/metadata\s*:\s*\{\s*interaction\s*:/.test(flowOrchestratorSource)) {
  violations.push('FlowOrchestrator: HITL committed fact 必须由 interactive-run feature 创建，禁止手写 interaction metadata');
}
if (!flowOrchestratorSource.includes('buildInteractionResponseIncomingEvent')) {
  violations.push('FlowOrchestrator: 缺少 interactive-run 唯一 HITL committed fact 创建入口');
}

const toolOutputContractFiles = [
  ...productionFiles('src/tools/tool_output'),
  'src/electron-main/services/workspace/workspace-maintenance.ts',
];
for (const relativePath of toolOutputContractFiles) {
  const source = readRequiredFile(relativePath);
  if (/unknown_tool/.test(source)) {
    violations.push(`${relativePath}: ToolOutputStore 禁止补造 unknown_tool`);
  }
  if (/ToolOutputBlobRecordV[0-9]|version\s*!==\s*[12]/.test(source)) {
    violations.push(`${relativePath}: ToolOutputStore 只接受当前严格 blob schema，禁止恢复版本兼容联合`);
  }
  if (/['"]ToolOutputStore['"]\s*,\s*['"]v1['"]/.test(source)) {
    violations.push(`${relativePath}: ToolOutputStore 禁止扫描旧磁盘路径`);
  }
}

const subrunKindConsumers = [
  'src/features/conversation/history/ui-messages.schemas.ts',
  'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteUiMessagesReader.ts',
  'packages/plugin-host-contract/renderer/subrunToolUi.ts',
];
for (const relativePath of subrunKindConsumers) {
  const source = readRequiredFile(relativePath);
  if (/z\.enum\(\[\s*['"]thought_delta['"]/.test(source)) {
    violations.push(`${relativePath}: subrun trace kind 必须派生自 Linnkit，禁止重列 enum`);
  }
  if (/isSubrunTraceRuntimeEvent|isReadableSubrunTraceKind/.test(source)) {
    violations.push(`${relativePath}: subrun trace 必须使用正式 RuntimeEvent schema，禁止手写 guard`);
  }
}

for (const relativePath of productionFiles('src/tools/tool_output')) {
  const source = readRequiredFile(relativePath);
  if (/\b(?:offset_line|next_offset_line|max_lines|max_units)\b/.test(source)) {
    violations.push(`${relativePath}: ToolOutput 续读只允许字符 offset/limit/next_offset`);
  }
}

if (violations.length > 0) {
  console.error('[conversation-contract-guard] Conversation 合同门禁失败：');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('[conversation-contract-guard] identity、消息联合、工具语义、插件扩展、摘要与 projection 合同无旁路。');

function readRequiredFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    violations.push(`${relativePath}: 关键文件不存在`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function productionFiles(relativeRoot) {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const result = [];
  visit(absoluteRoot);
  return result;

  function visit(currentPath) {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile() || !/\.(ts|vue)$/.test(entry.name)) continue;
      if (/\.(test|spec)\.ts$/.test(entry.name)) continue;
      result.push(path.relative(repoRoot, entryPath));
    }
  }
}
