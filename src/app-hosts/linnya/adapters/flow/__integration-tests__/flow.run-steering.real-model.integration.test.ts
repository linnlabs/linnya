import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowScenario } from '../__test-helpers__/flowScenario';
import {
  REAL_MODEL_TEST_ENV,
  createRecordedRealModelInference,
  findConfiguredModelId,
  installDevelopmentModelServices,
} from '../__test-helpers__/realModelInference';

/**
 * 真实模型插话核对（会调用上游、产生费用）：只在设置 LINNYA_REAL_MODEL_TEST=1 时运行，
 * 用当前 checkout 开发实例已配置的模型与凭据。`LINNYA_REAL_MODEL_IDS` 可改要跑的 Provider 模型名，
 * `LINNYA_REAL_MODEL_REPORT=<文件>` 把每个模型的时间线追加写进该文件。
 *
 * 核对的是 Provider 格式与多轮回放：工具结果后紧跟插话、带思考内容的历史再次发给模型都不报错，
 * 模型确实读到插话；跨层不变量与脚本场景相同。
 */
const enabled = process.env[REAL_MODEL_TEST_ENV] === '1';
const providerModelIds = (process.env.LINNYA_REAL_MODEL_IDS ?? 'deepseek-v4.1-flash,glm-5.3-flash')
  .split(',').map(id => id.trim()).filter(Boolean);

const LOOKUP = {
  description: '查询城市今天的天气。每次只查一个城市。',
  parameters: {
    type: 'object' as const,
    properties: { city: { type: 'string' as const, description: '城市名' } },
    required: ['city'],
  },
};
const WEATHER: Readonly<Record<string, string>> = { 北京: '北京：晴，18 度', 上海: '上海：多云，23 度' };

function report(title: string, lines: readonly string[]): void {
  const file = process.env.LINNYA_REAL_MODEL_REPORT;
  if (file) appendFileSync(file, `## ${title}\n${lines.join('\n')}\n\n`);
}

describe.skipIf(!enabled)('Flow run steering with real models', () => {
  let workspaceRoot = '';
  let restore = () => {};

  beforeAll(async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'linnya-real-model-'));
    restore = await installDevelopmentModelServices({ instanceRoot: process.cwd(), workspaceRoot });
  });

  afterAll(() => {
    restore();
    if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
  });

  for (const providerModelId of providerModelIds) {
    it(`${providerModelId}：工具执行中插话，模型在同一次回复里照做；下一轮能接着用插话内容`, async () => {
      const modelId = findConfiguredModelId(providerModelId);
      if (!modelId) throw new Error(`开发实例没有配置 ${providerModelId}`);
      let steered = false;
      const scenario = await createFlowScenario({
        model: createRecordedRealModelInference(modelId),
        tools: {
          lookup: {
            ...LOOKUP,
            run: async ({ args }) => {
              if (!steered) {
                steered = true;
                await scenario.steer('另外也查一下上海，最后告诉我两个城市的天气。');
              }
              const city = String(args.city ?? '');
              return WEATHER[city] ?? `${city}：没有数据`;
            },
          },
        },
      });
      try {
        const first = await scenario.send('用 lookup 工具查一下北京今天的天气，然后用一句话告诉我。');
        expect(first).toMatchObject({ status: 'completed', undeliveredSteers: [] });
        const timeline = await scenario.timeline();
        report(`${providerModelId} 第一轮`, timeline);
        expect(timeline).toContain('steer "另外也查一下上海，最后告诉我两个城市的天气。"');
        // 模型确实读到插话：之后查了上海，或在回答里提到上海。
        expect(timeline.some(line => line.includes('上海') && !line.startsWith('steer'))).toBe(true);

        const second = await scenario.send('刚才两个城市哪个更暖和？只回答城市名。');
        expect(second.status).toBe('completed');
        const answers = (await scenario.timeline({ types: ['final_answer'] }));
        report(`${providerModelId} 第二轮`, (await scenario.timeline()).slice(timeline.length));
        expect(answers[answers.length - 1]).toContain('上海');
        await scenario.assertInvariants();
      } finally {
        await scenario.close();
      }
    }, 240_000);
  }
});
