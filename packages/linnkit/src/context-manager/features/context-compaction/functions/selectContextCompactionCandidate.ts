import type {
  AiMessage,
  ContextCompactionCandidate,
  ContextCompactionPlan,
} from '../../../../contracts';
import { buildToolInteractionGroupsFromMessages } from '../../../shared/toolInteractionGroup';
import type { SelectContextCompactionCandidateInput } from '../definitions/contextCompactionSelection';
import { CONTEXT_COMPACTION_REMINDER } from '../definitions/contextCheckpointFormat';

interface CandidateUnit {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly messages: readonly AiMessage[];
  readonly tokenEstimate: number;
  readonly toolGroupCount: 0 | 1;
}

interface CandidateSegment {
  readonly units: readonly CandidateUnit[];
  readonly tokenEstimate: number;
}

/**
 * 选择最老的一段可替换上下文，并把工具调用保持为不可拆分的原子组。
 *
 * 中文备注：这里不判断是否达到触发阈值。最终 Prompt 的真实触发只归 Graph 的
 * measure_prompt_usage；Context Manager 只提前准备一个足以从 trigger 水位降到 target
 * 水位的纯候选，避免 Graph 读取 Provider action 或 AiMessage 内部状态。
 */
export function selectContextCompactionCandidate(
  input: SelectContextCompactionCandidateInput,
): ContextCompactionCandidate | undefined {
  if (!input.policy.enabled || input.messages.length === 0) return undefined;

  const messages = [...input.messages];
  const replacementSourceMessages = dedupeMessages([
    ...(input.replacementSourceMessages ?? messages),
    ...messages,
  ]);
  const groups = buildToolInteractionGroupsFromMessages(messages);
  const completeGroups = groups.filter(group => group.isComplete);
  const retainedCompleteGroups = input.policy.keepLatestToolGroups === 0
    ? []
    : completeGroups.slice(-input.policy.keepLatestToolGroups);
  const retainedToolMessageIds = new Set(
    retainedCompleteGroups.flatMap(group => group.sourceMessageIds),
  );
  for (const group of groups) {
    if (!group.isComplete || group.messages.some(hasAttachments)) {
      for (const id of group.sourceMessageIds) retainedToolMessageIds.add(id);
    }
  }

  const earliestRetainedToolIndex = retainedCompleteGroups.length > 0
    ? Math.min(...retainedCompleteGroups.map(group => group.startIndex))
    : messages.length;
  const earliestIncompleteToolIndex = groups
    .filter(group => !group.isComplete)
    .reduce((earliest, group) => Math.min(earliest, group.startIndex), messages.length);
  const replaceableEndIndex = Math.min(earliestRetainedToolIndex, earliestIncompleteToolIndex);
  const latestUserIndex = findLatestUserInputIndex(messages);
  const latestSummary = findLatestHistorySummary(messages);
  const protectedMessageIds = collectProtectedMessageIds({
    messages,
    latestUserIndex,
    mustKeepPolicy: input.mustKeepPolicy,
    retainedToolMessageIds,
  });

  const toolMessageIds = new Set(groups.flatMap(group => group.sourceMessageIds));
  const units: CandidateUnit[] = [];
  for (const group of completeGroups) {
    if (group.startIndex >= replaceableEndIndex) continue;
    if (group.sourceMessageIds.some(id => retainedToolMessageIds.has(id))) continue;
    // 审批、HITL 等 must-keep fence 可能位于 tool call 与迟到 output 之间。
    // 这类完整组仍跨越了不可替换边界，不能把两端拼成一个连续压缩区段。
    if (
      messages
        .slice(group.startIndex, group.endIndex + 1)
        .some(message => protectedMessageIds.has(message.id))
    ) {
      continue;
    }
    units.push({
      startIndex: group.startIndex,
      endIndex: group.endIndex,
      messages: group.messages,
      tokenEstimate: group.messages.reduce(
        (total, message) => total + input.estimateTokens(message),
        0,
      ),
      toolGroupCount: 1,
    });
  }

  messages.forEach((message, index) => {
    if (index >= replaceableEndIndex || toolMessageIds.has(message.id)) return;
    if (protectedMessageIds.has(message.id)) return;
    if (message.type === 'history_summary' && message.id !== latestSummary?.id) return;
    units.push({
      startIndex: index,
      endIndex: index,
      messages: [message],
      tokenEstimate: input.estimateTokens(message),
      toolGroupCount: 0,
    });
  });
  units.sort((left, right) => left.startIndex - right.startIndex);

  const currentTokenEstimate = messages.reduce(
    (total, message) => total + input.estimateTokens(message),
    0,
  );
  const fixedPromptTokenEstimate = Math.max(0, input.inputBudgetTokens - input.totalBudget);
  const currentPromptTokenEstimate = currentTokenEstimate + fixedPromptTokenEstimate;
  const summaryReserve = Math.min(
    input.policy.maxOutputTokens,
    input.inputBudgetTokens,
  );
  const requiredReleaseTokens = Math.max(
    1,
    Math.ceil(
      Math.max(
        input.inputBudgetTokens * (input.policy.triggerRatio - input.policy.targetRatio),
        currentPromptTokenEstimate - input.inputBudgetTokens * input.policy.targetRatio,
      ) + summaryReserve,
    ),
  );
  const segments = buildContinuousSegments(units);
  const selectedSegment = segments.find(
    segment => segment.tokenEstimate >= requiredReleaseTokens,
  ) ?? segments.reduce<CandidateSegment | undefined>((largest, segment) => {
    if (!largest || segment.tokenEstimate > largest.tokenEstimate) return segment;
    return largest;
  }, undefined);
  if (!selectedSegment) return undefined;

  const selectedMessages: AiMessage[] = [];
  let selectedUnitCount = 0;
  let replacedTokenEstimate = 0;
  let replacedToolGroupCount = 0;
  for (const unit of selectedSegment.units) {
    selectedMessages.push(...unit.messages);
    selectedUnitCount += 1;
    replacedTokenEstimate += unit.tokenEstimate;
    replacedToolGroupCount += unit.toolGroupCount;
    if (replacedTokenEstimate >= requiredReleaseTokens) break;
  }
  if (selectedMessages.length === 0) return undefined;

  // HistoryPurification 只认最新 summary。每一代新摘要都必须显式吞掉上一代及其来源，
  // 否则提交新摘要后，旧摘要覆盖的原始历史会重新出现。
  const replacementMessages = dedupeMessages([
    ...(latestSummary ? [latestSummary] : []),
    ...selectedMessages,
  ]);
  const replacedMessageIds = collectReplacementClosure(
    replacementSourceMessages,
    replacementMessages,
  );
  // 压缩模型会看到本 tick 的完整最终 Prompt；plan 只负责 durable 替换范围，
  // 不再维护一份可能与真实模型输入漂移的“摘要锚点”消息子集。
  const sourceMessageIds = messages.map(message => message.id);
  const plan: ContextCompactionPlan = {
    fingerprint: fingerprintReplacementPlan(replacedMessageIds),
    sourceMessageIds,
    replacedMessageIds,
    originalMessageCount: replacementMessages.length,
    includedOldSummary: latestSummary !== undefined,
    nextSummarySeq: nextSummarySeq(replacementSourceMessages),
    sourceTokenEstimate: messages.reduce(
      (total, message) => total + input.estimateTokens(message),
      0,
    ),
    replacedTokenEstimate: replacementMessages.reduce(
      (total, message) => total + input.estimateTokens(message),
      0,
    ),
    replacedToolGroupCount,
    keptToolGroupCount: retainedCompleteGroups.length,
    replaceableRangeExhausted: selectedUnitCount === selectedSegment.units.length,
  };
  return {
    plan,
    policy: input.policy,
    reminder: CONTEXT_COMPACTION_REMINDER,
  };
}

function buildContinuousSegments(units: readonly CandidateUnit[]): CandidateSegment[] {
  const segments: CandidateSegment[] = [];
  let currentUnits: CandidateUnit[] = [];
  let currentEndIndex = -1;
  let currentTokens = 0;
  const flush = () => {
    if (currentUnits.length === 0) return;
    segments.push({ units: currentUnits, tokenEstimate: currentTokens });
    currentUnits = [];
    currentEndIndex = -1;
    currentTokens = 0;
  };

  for (const unit of units) {
    if (currentUnits.length > 0 && unit.startIndex > currentEndIndex + 1) {
      flush();
    }
    currentUnits.push(unit);
    currentEndIndex = Math.max(currentEndIndex, unit.endIndex);
    currentTokens += unit.tokenEstimate;
  }
  flush();
  return segments;
}

function collectProtectedMessageIds(input: {
  messages: readonly AiMessage[];
  latestUserIndex: number;
  mustKeepPolicy: SelectContextCompactionCandidateInput['mustKeepPolicy'];
  retainedToolMessageIds: ReadonlySet<string>;
}): Set<string> {
  const protectedIds = new Set(input.retainedToolMessageIds);
  input.messages.forEach((message, index) => {
    const alwaysKeepType = input.mustKeepPolicy.alwaysKeepTypes.includes(message.type)
      && (message.type !== 'user_input' || index === input.latestUserIndex);
    const alwaysKeepFence = typeof message.metadata?.fenceKind === 'string'
      && input.mustKeepPolicy.alwaysKeepFenceKinds.includes(message.metadata.fenceKind);
    if (alwaysKeepType || alwaysKeepFence || hasAttachments(message)) {
      protectedIds.add(message.id);
    }
  });
  return protectedIds;
}

function collectReplacementClosure(
  allMessages: readonly AiMessage[],
  selectedMessages: readonly AiMessage[],
): string[] {
  const messageById = new Map(allMessages.map(message => [message.id, message]));
  const ids = new Set<string>();
  const visit = (id: string): void => {
    if (ids.has(id)) return;
    ids.add(id);
    const message = messageById.get(id);
    if (!message) return;
    for (const sourceId of readStringArray(message.metadata, 'replacementSourceIds')) {
      visit(sourceId);
    }
    if (message.type === 'history_summary') {
      for (const sourceId of message.metadata?.replacedMessageIds ?? []) visit(sourceId);
    }
  };
  for (const message of selectedMessages) visit(message.id);
  return [...ids];
}

function dedupeMessages(messages: readonly AiMessage[]): AiMessage[] {
  const seen = new Set<string>();
  return messages.filter(message => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function findLatestUserInputIndex(messages: readonly AiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === 'user_input') return index;
  }
  return -1;
}

function findLatestHistorySummary(messages: readonly AiMessage[]): AiMessage | undefined {
  return messages
    .filter(message => message.type === 'history_summary')
    .reduce<AiMessage | undefined>((latest, message) => {
      if (!latest) return message;
      return (message.metadata?.summarySeq ?? -1) > (latest.metadata?.summarySeq ?? -1)
        ? message
        : latest;
    }, undefined);
}

function nextSummarySeq(messages: readonly AiMessage[]): number {
  return messages.reduce(
    (latest, message) => message.type === 'history_summary'
      ? Math.max(latest, message.metadata?.summarySeq ?? 0)
      : latest,
    0,
  ) + 1;
}

function hasAttachments(message: AiMessage): boolean {
  if (message.role === 'user' && message.type === 'user_input') {
    return (message.attachments?.length ?? 0) > 0;
  }
  if (message.role === 'tool') {
    return (message.attachments?.length ?? 0) > 0;
  }
  return false;
}

function readStringArray(value: unknown, key: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const candidate = Reflect.get(value, key);
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === 'string')
    : [];
}

function fingerprintReplacementPlan(ids: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const character of ids.join('\u0000')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `context_compaction_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
