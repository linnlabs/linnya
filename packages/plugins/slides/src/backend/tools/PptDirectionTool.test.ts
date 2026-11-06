import { describe, expect, it } from 'vitest';
import type { ToolContext } from '@plugin/backend/toolRuntime';
import { PptDirectionToolResultSchema } from '@plugin/slides/shared/designDirection';
import { attachPresentationCoordinatorToToolContext } from './toolContextBinding';
import { PptDirectionTool } from './PptDirectionTool';

const MOTIFS = [
  { text: '饕餮纹的对称展开', typicality: 0.7 },
  { text: '范铸法的陶范分块', typicality: 0.2 },
  { text: '铭文拓片的墨色', typicality: 0.4 },
];

function contextWithHistory(cardIds: string[]): ToolContext {
  const coordinator = {
    listRecentDirectionUses: async () => cardIds.map((cardId) => ({ cardId, accent: '#2255CC' })),
  };
  return attachPresentationCoordinatorToToolContext({} as ToolContext, coordinator as never);
}

async function run(args: Record<string, unknown>, context: ToolContext = {} as ToolContext) {
  const output = await new PptDirectionTool().run(args, context);
  return PptDirectionToolResultSchema.parse(JSON.parse(output));
}

describe('PptDirectionTool', () => {
  it('同一种子可复现，结果说明里不出现抽签说法', async () => {
    const first = await run({ scenario: 'culture', motifs: MOTIFS, seed: 'fixed-1' });
    const second = await run({ scenario: 'culture', motifs: MOTIFS, seed: 'fixed-1' });
    expect(second.data).toEqual(first.data);
    expect(first.data.drawId).toBe('fixed-1-1');
    expect(first.observation).toContain(`cardId 写 "${first.data.card.id}"`);
    expect(first.observation).not.toMatch(/抽签|签池/u);
  });

  it('退回的手法不会再次给出', async () => {
    const first = await run({ scenario: 'business', motifs: MOTIFS, seed: 'fixed-2' });
    const second = await run({
      scenario: 'business',
      motifs: MOTIFS,
      seed: 'fixed-2',
      rejected: [{ cardId: first.data.card.id, reason: '内容是财报，不适合这种手法' }],
    });
    expect(second.data.card.id).not.toBe(first.data.card.id);
    expect(second.data.rejectedCardIds).toEqual([first.data.card.id]);
  });

  it('读本机历史降权；历史读取失败时照常给出方向', async () => {
    const baseline = await run({ scenario: 'culture', motifs: MOTIFS, seed: 'fixed-3' });
    const withHistory = await run(
      { scenario: 'culture', motifs: MOTIFS, seed: 'fixed-3' },
      contextWithHistory([baseline.data.card.id]),
    );
    expect(withHistory.data.drawId).toBe('fixed-3-1');
    const failing = attachPresentationCoordinatorToToolContext({} as ToolContext, {
      listRecentDirectionUses: async () => { throw new Error('db closed'); },
    } as never);
    await expect(run({ scenario: 'culture', motifs: MOTIFS }, failing)).resolves.toBeDefined();
  });

  it('参数不合法时给出可修正的错误', () => {
    const tool = new PptDirectionTool() as unknown as {
      validateArguments(args: Record<string, unknown>): { success: boolean; error?: string };
    };
    const result = tool.validateArguments({ scenario: 'culture', motifs: MOTIFS.slice(0, 1) });
    expect(result.success).toBe(false);
    expect(result.error).toContain('PPT_DIRECTION_ARGUMENTS_INVALID');
  });
});
