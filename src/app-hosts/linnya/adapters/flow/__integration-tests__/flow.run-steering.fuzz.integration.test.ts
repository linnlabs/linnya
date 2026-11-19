import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import { createFlowScenario } from '../__test-helpers__/flowScenario';

/**
 * 插话随机组合：工具批次数、每批工具数、每个工具执行时用户做什么（不动 / 插话 / 插话后撤回 / 插话后暂停），
 * 以及最后一次模型调用中是否插话。不写死期望时间线，只要求跨层不变量始终成立。
 *
 * 复现：失败时 fast-check 打印 seed 与 path，用
 *   pnpm -s scenario replay <seed> [path]
 * 或 SCENARIO_SEED=<seed> SCENARIO_PATH=<path> 重跑本文件。
 * 加量：pnpm -s scenario fuzz --runs 200。
 */
type ToolAction = 'none' | 'steer' | 'steer_withdraw' | 'steer_pause';

const action = fc.constantFrom<ToolAction>('none', 'steer', 'steer_withdraw', 'steer_pause');
const plan = fc.record({
  batches: fc.array(fc.array(action, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 3 }),
  steerInFinalCall: fc.boolean(),
});

function readNumber(name: string): number | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : Number(value);
}

describe('Flow run steering combinations', () => {
  it('任意组合下：实时与重载一致、每条插话恰好一个去向、模型按顺序恰好看到一次', async () => {
    await fc.assert(fc.asyncProperty(plan, async ({ batches, steerInFinalCall }) => {
      // 一次运行最多暂停一次：只保留第一个暂停，其余当作普通插话。
      let pauseUsed = false;
      const actions = batches.flat().map(item => {
        if (item !== 'steer_pause') return item;
        if (pauseUsed) return 'steer';
        pauseUsed = true;
        return item;
      });
      let toolCount = 0;
      const turns: ScriptedLlmTurn[] = [
        ...batches.map(batch => ({ toolCalls: batch.map(() => ({ name: 'lookup' })) })),
        {
          contentChunks: ['done'],
          assertCall: async () => { if (steerInFinalCall) await scenario.steer('最后一次调用中插话'); },
        },
      ];
      const scenario = await createFlowScenario({
        model: turns,
        tools: {
          lookup: async () => {
            const current = actions[toolCount] ?? 'none';
            toolCount += 1;
            if (current === 'none') return 'ok';
            const { inputId } = await scenario.steer(`插话${toolCount}`);
            if (current === 'steer_withdraw') await scenario.withdraw(inputId);
            if (current === 'steer_pause') await scenario.pause();
            return 'ok';
          },
        },
      });
      try {
        let run = await scenario.send('开始');
        while (run.status === 'paused') run = await scenario.continue();
        expect(run.status).toBe('completed');
        if (steerInFinalCall) expect(run.undeliveredSteers).toContain('最后一次调用中插话');
        await scenario.assertInvariants();
      } finally {
        await scenario.close();
      }
    }), {
      numRuns: readNumber('SCENARIO_RUNS') ?? 12,
      seed: readNumber('SCENARIO_SEED'),
      path: process.env.SCENARIO_PATH || undefined,
      endOnFailure: true,
    });
  }, 120_000);
});
