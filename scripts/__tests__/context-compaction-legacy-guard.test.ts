import { describe, expect, it } from 'vitest';
import {
  analyzeContextCompactionLegacySource,
  runContextCompactionLegacyGuard,
} from '../guards/context-compaction-legacy-guard';

describe('context compaction legacy guard', () => {
  it('当前生产代码保持旧机制零基线', () => {
    expect(runContextCompactionLegacyGuard()).toEqual([]);
  });

  it('按业务含义识别成组退役的工具、步数、提醒与模型字段', () => {
    const source = [
      'const _checkpointStepReset = true;',
      'const maxCheckpoints = 12;',
      "const tool = 'context_checkpoint';",
      "const rule = 'context_budget_warning';",
      'const summary_model_id = "model-a";',
      "const purpose = 'history_compression';",
      'const prompt = PromptKeys.HISTORY_COMPRESSION;',
    ].join('\n');
    expect(analyzeContextCompactionLegacySource('src/example.ts', source).map(item => item.rule))
      .toEqual([
        'LEGACY-COMPACTION-01-step-reset',
        'LEGACY-COMPACTION-01-step-reset',
        'LEGACY-COMPACTION-03-checkpoint-tool',
        'LEGACY-COMPACTION-02-budget-warning',
        'LEGACY-COMPACTION-04-summary-model-field',
        'LEGACY-COMPACTION-05-summary-model-purpose',
        'LEGACY-COMPACTION-05-summary-model-purpose',
      ]);
  });

  it('不误报当前 Engine checkpoint 与工具历史压缩策略', () => {
    const source = [
      "const strategy = 'tool_history_compression';",
      'const checkpointRevision = 3;',
      'await checkpointer.save(checkpointKey, state);',
    ].join('\n');
    expect(analyzeContextCompactionLegacySource('src/example.ts', source)).toEqual([]);
  });

});
