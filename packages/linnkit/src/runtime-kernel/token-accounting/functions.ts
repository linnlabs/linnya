import type {
  CanonicalLlmUsage,
  CostBreakdown,
  ContextComponentTokenLedgerEntry,
  ContextTokenComponent,
  LlmUsageTokenLedgerEntry,
  RunTokenUsageAggregate,
  TokenCostComponent,
  TokenLedgerAggregate,
  TokenLedgerEntry,
  TokenPricing,
  TokenUsageTotals,
} from '../../contracts';

type LedgerEntryScope = Pick<
  LlmUsageTokenLedgerEntry,
  'runId' | 'parentRunId' | 'conversationId' | 'turnId' | 'stepId' | 'route' | 'createdAt'
>;

export interface CreateLlmUsageLedgerEntryInput extends LedgerEntryScope {
  id: string;
  modelId?: string;
  usage: CanonicalLlmUsage;
}

export interface CreateContextComponentLedgerEntryInput extends LedgerEntryScope {
  id: string;
  components: readonly ContextTokenComponent[];
}

const EMPTY_LEDGER_AGGREGATE: TokenLedgerAggregate = {
  contextTokens: 0,
  entryCount: 0,
  llmCallCount: 0,
  contextComponentCount: 0,
};

const TOKEN_PRICE_UNIT = 1_000_000;

function sumReportedOptional(values: readonly (number | undefined)[]): number | undefined {
  const reported = values.filter((value): value is number => value !== undefined);
  if (reported.length === 0) {
    return undefined;
  }
  return reported.reduce((total, value) => total + value, 0);
}

function sumTotalTokens(usages: readonly CanonicalLlmUsage[]): number | undefined {
  if (usages.length === 0 || usages.some((usage) => usage.totalTokens === undefined)) {
    return undefined;
  }
  return usages.reduce((total, usage) => total + (usage.totalTokens ?? 0), 0);
}

export function aggregateCanonicalUsage(usages: readonly CanonicalLlmUsage[]): TokenUsageTotals | undefined {
  if (usages.length === 0) {
    return undefined;
  }

  return {
    inputTokens: usages.reduce((total, usage) => total + usage.inputTokens, 0),
    imageInputTokens: sumReportedOptional(usages.map((usage) => usage.imageInputTokens)),
    outputTokens: usages.reduce((total, usage) => total + usage.outputTokens, 0),
    reasoningTokens: sumReportedOptional(usages.map((usage) => usage.reasoningTokens)),
    cacheReadTokens: sumReportedOptional(usages.map((usage) => usage.cacheReadTokens)),
    cacheWriteTokens: sumReportedOptional(usages.map((usage) => usage.cacheWriteTokens)),
    totalTokens: sumTotalTokens(usages),
    usageCount: usages.length,
  };
}

export function createLlmUsageLedgerEntry(input: CreateLlmUsageLedgerEntryInput): LlmUsageTokenLedgerEntry {
  return {
    ...input,
    kind: 'llm-usage',
  };
}

export function createContextComponentLedgerEntry(
  input: CreateContextComponentLedgerEntryInput,
): ContextComponentTokenLedgerEntry {
  return {
    ...input,
    kind: 'context-component',
    components: [...input.components],
    totalTokens: input.components.reduce((total, component) => total + component.tokens, 0),
  };
}

export function addUsageTotals(
  left: TokenUsageTotals | undefined,
  right: TokenUsageTotals | undefined,
): TokenUsageTotals | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return {
    inputTokens: left.inputTokens + right.inputTokens,
    imageInputTokens: sumReportedOptional([left.imageInputTokens, right.imageInputTokens]),
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: sumReportedOptional([left.reasoningTokens, right.reasoningTokens]),
    cacheReadTokens: sumReportedOptional([left.cacheReadTokens, right.cacheReadTokens]),
    cacheWriteTokens: sumReportedOptional([left.cacheWriteTokens, right.cacheWriteTokens]),
    totalTokens: left.totalTokens === undefined || right.totalTokens === undefined
      ? undefined
      : left.totalTokens + right.totalTokens,
    usageCount: left.usageCount + right.usageCount,
  };
}

export function addLedgerAggregate(left: TokenLedgerAggregate, right: TokenLedgerAggregate): TokenLedgerAggregate {
  return {
    llmUsage: addUsageTotals(left.llmUsage, right.llmUsage),
    contextTokens: left.contextTokens + right.contextTokens,
    entryCount: left.entryCount + right.entryCount,
    llmCallCount: left.llmCallCount + right.llmCallCount,
    contextComponentCount: left.contextComponentCount + right.contextComponentCount,
  };
}

export function aggregateTokenLedgerEntries(entries: readonly TokenLedgerEntry[]): TokenLedgerAggregate {
  const llmUsages = entries
    .filter((entry): entry is LlmUsageTokenLedgerEntry => entry.kind === 'llm-usage')
    .map((entry) => entry.usage);

  return entries.reduce<TokenLedgerAggregate>((aggregate, entry) => {
    if (entry.kind === 'llm-usage') {
      return {
        ...aggregate,
        entryCount: aggregate.entryCount + 1,
        llmCallCount: aggregate.llmCallCount + 1,
      };
    }

    return {
      ...aggregate,
      contextTokens: aggregate.contextTokens + entry.totalTokens,
      entryCount: aggregate.entryCount + 1,
      contextComponentCount: aggregate.contextComponentCount + entry.components.length,
    };
  }, {
    ...EMPTY_LEDGER_AGGREGATE,
    llmUsage: aggregateCanonicalUsage(llmUsages),
  });
}

export function createRunTokenUsageAggregate(input: {
  ownEntries: readonly TokenLedgerEntry[];
  childAggregates?: readonly TokenLedgerAggregate[];
}): RunTokenUsageAggregate {
  const children = input.childAggregates?.reduce<TokenLedgerAggregate>(
    (aggregate, child) => addLedgerAggregate(aggregate, child),
    EMPTY_LEDGER_AGGREGATE,
  );

  return children && children.entryCount > 0
    ? { own: aggregateTokenLedgerEntries(input.ownEntries), children }
    : { own: aggregateTokenLedgerEntries(input.ownEntries) };
}

function componentCost(tokens: number, pricePerMillion: number): number {
  return (tokens / TOKEN_PRICE_UNIT) * pricePerMillion;
}

function needsPrice(tokens: number | undefined): boolean {
  return tokens !== undefined && tokens > 0;
}

function missingPriceComponents(usage: CanonicalLlmUsage, pricing: TokenPricing | undefined): TokenCostComponent[] {
  const missing: TokenCostComponent[] = [];
  if (!pricing) {
    if (needsPrice(usage.inputTokens)) {
      missing.push('input');
    }
    if (needsPrice(usage.outputTokens)) {
      missing.push('output');
    }
    if (needsPrice(usage.reasoningTokens)) {
      missing.push('reasoning');
    }
    if (needsPrice(usage.cacheReadTokens)) {
      missing.push('cacheRead');
    }
    if (needsPrice(usage.cacheWriteTokens)) {
      missing.push('cacheWrite');
    }
    return missing;
  }

  if (needsPrice(usage.inputTokens) && pricing.input === undefined) {
    missing.push('input');
  }
  if (needsPrice(usage.outputTokens) && pricing.output === undefined) {
    missing.push('output');
  }
  if (needsPrice(usage.reasoningTokens) && pricing.reasoning === undefined) {
    missing.push('reasoning');
  }
  if (needsPrice(usage.cacheReadTokens) && pricing.cacheRead === undefined) {
    missing.push('cacheRead');
  }
  if (needsPrice(usage.cacheWriteTokens) && pricing.cacheWrite === undefined) {
    missing.push('cacheWrite');
  }
  return missing;
}

function reportedComponentCost(tokens: number | undefined, pricePerMillion: number | undefined): number | undefined {
  if (tokens === undefined) {
    return undefined;
  }
  if (tokens === 0) {
    return 0;
  }
  return pricePerMillion === undefined ? undefined : componentCost(tokens, pricePerMillion);
}

function requiredComponentCost(tokens: number, pricePerMillion: number | undefined): number {
  if (tokens === 0) {
    return 0;
  }
  return componentCost(tokens, pricePerMillion ?? 0);
}

function sumComputedCosts(costs: readonly (number | undefined)[]): number {
  let total = 0;
  for (const cost of costs) {
    total += cost ?? 0;
  }
  return total;
}

export function computeCost(usage: CanonicalLlmUsage, pricing?: TokenPricing): CostBreakdown {
  const missing = missingPriceComponents(usage, pricing);
  if (!pricing || missing.length > 0) {
    return {
      status: 'unknown',
      ...(pricing ? { currency: pricing.currency } : {}),
      ...(missing.length > 0 ? { missingPriceComponents: missing } : {}),
    };
  }

  const inputCost = requiredComponentCost(usage.inputTokens, pricing.input);
  const outputCost = requiredComponentCost(usage.outputTokens, pricing.output);
  const reasoningCost = reportedComponentCost(usage.reasoningTokens, pricing.reasoning);
  const cacheReadCost = reportedComponentCost(usage.cacheReadTokens, pricing.cacheRead);
  const cacheWriteCost = reportedComponentCost(usage.cacheWriteTokens, pricing.cacheWrite);

  return {
    status: 'computed',
    currency: pricing.currency,
    inputCost,
    outputCost,
    reasoningCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: sumComputedCosts([
      inputCost,
      outputCost,
      reasoningCost,
      cacheReadCost,
      cacheWriteCost,
    ]),
  };
}
