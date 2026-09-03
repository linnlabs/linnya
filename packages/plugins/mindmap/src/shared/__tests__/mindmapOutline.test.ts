import { describe, expect, it } from 'vitest';
import { normalizeMindmap, parseMindmapMarkdownOutline } from '../mindmapOutline';
import type { MindMapNodeData } from '../mindMapData';

type TopicTree = {
  readonly topic: string | undefined;
  readonly children: readonly TopicTree[];
};

function extractTopics(node: MindMapNodeData | undefined): TopicTree | null {
  if (!node) return null;
  return {
    topic: node.topic,
    children: node.children.map(extractTopics).filter((child): child is TopicTree => child !== null),
  };
}

describe('parseMindmapMarkdownOutline', () => {
  it('parses nested-list outline from deepseek-style output', () => {
    const outline = [
      '# 下一代储能技术商业化路径',
      '- 固态电池 (Solid-State Battery)',
      '  - 2023-2025年：原型开发与试点生产',
      '    - Quantum Scape 建立1GWh产能（2024年）',
      '    - CATL 硫化物固态电池样品（TRL4）',
      '  - 2025-2027年：初步商业化',
      '    - CATL 目标2025年市场引入硫化物固态电池[@Ydu3Lb]',
      '- 氢燃料电池 (Hydrogen Fuel Cell)',
      '  - 2024-2025年：重型卡车示范',
      '    - Cummins 100 kW PEMFC堆开发',
    ].join('\n');

    const result = normalizeMindmap(parseMindmapMarkdownOutline(outline, 'Fallback'), 'Fallback');

    expect(extractTopics(result.nodeData)).toEqual({
      topic: '下一代储能技术商业化路径',
      children: [
        {
          topic: '固态电池 (Solid-State Battery)',
          children: [
            {
              topic: '2023-2025年：原型开发与试点生产',
              children: [
                { topic: 'Quantum Scape 建立1GWh产能（2024年）', children: [] },
                { topic: 'CATL 硫化物固态电池样品（TRL4）', children: [] },
              ],
            },
            {
              topic: '2025-2027年：初步商业化',
              children: [
                { topic: 'CATL 目标2025年市场引入硫化物固态电池[@Ydu3Lb]', children: [] },
              ],
            },
          ],
        },
        {
          topic: '氢燃料电池 (Hydrogen Fuel Cell)',
          children: [
            {
              topic: '2024-2025年：重型卡车示范',
              children: [{ topic: 'Cummins 100 kW PEMFC堆开发', children: [] }],
            },
          ],
        },
      ],
    });
  });

  it('parses heading-plus-list outline from glm-style output', () => {
    const outline = [
      '# 三种储能技术商业化路径',
      '',
      '## 固态电池商业化路径',
      '### Gen 1 (2025-2027)',
      '- 目标能量密度: 200-300 Wh/kg',
      '- 使用现有NMC正极和Gr|Si/C负极',
      '### Gen 2 (2027-2030)',
      '- 目标能量密度: 400 Wh/kg, 800 Wh/L',
      '',
      '## 氢燃料电池商业化路径',
      '### 当前状态 (2024-2025)',
      '- 已商业化 (TRL9)',
      '- 主要应用: 重载商用车(卡车、客车)',
    ].join('\n');

    const result = normalizeMindmap(parseMindmapMarkdownOutline(outline, 'Fallback'), 'Fallback');

    expect(extractTopics(result.nodeData)).toEqual({
      topic: '三种储能技术商业化路径',
      children: [
        {
          topic: '固态电池商业化路径',
          children: [
            {
              topic: 'Gen 1 (2025-2027)',
              children: [
                { topic: '目标能量密度: 200-300 Wh/kg', children: [] },
                { topic: '使用现有NMC正极和Gr|Si/C负极', children: [] },
              ],
            },
            {
              topic: 'Gen 2 (2027-2030)',
              children: [{ topic: '目标能量密度: 400 Wh/kg, 800 Wh/L', children: [] }],
            },
          ],
        },
        {
          topic: '氢燃料电池商业化路径',
          children: [
            {
              topic: '当前状态 (2024-2025)',
              children: [
                { topic: '已商业化 (TRL9)', children: [] },
                { topic: '主要应用: 重载商用车(卡车、客车)', children: [] },
              ],
            },
          ],
        },
      ],
    });
  });

  it('parses heading-plus-list outline from minimax-style output', () => {
    const outline = [
      '# 下一代储能技术商业化路径',
      '',
      '## 固态电池 (SSB)',
      '',
      '### 2023-2025: 早期商业化',
      '- 特殊应用小批量生产',
      '- 聚合物SSB (BlueSolutions) 1.5GWh产能',
      '',
      '### 2025-2027: 量产启动',
      '- Toyota/Panasonic 硫化物SSB量产',
      '',
      '## 氢燃料电池',
      '',
      '### 2023-2025: 早期推广',
      '- 全球约50款商用车模型',
      '- 中国占FC公交车75%',
    ].join('\n');

    const result = normalizeMindmap(parseMindmapMarkdownOutline(outline, 'Fallback'), 'Fallback');

    expect(extractTopics(result.nodeData)).toEqual({
      topic: '下一代储能技术商业化路径',
      children: [
        {
          topic: '固态电池 (SSB)',
          children: [
            {
              topic: '2023-2025: 早期商业化',
              children: [
                { topic: '特殊应用小批量生产', children: [] },
                { topic: '聚合物SSB (BlueSolutions) 1.5GWh产能', children: [] },
              ],
            },
            {
              topic: '2025-2027: 量产启动',
              children: [{ topic: 'Toyota/Panasonic 硫化物SSB量产', children: [] }],
            },
          ],
        },
        {
          topic: '氢燃料电池',
          children: [
            {
              topic: '2023-2025: 早期推广',
              children: [
                { topic: '全球约50款商用车模型', children: [] },
                { topic: '中国占FC公交车75%', children: [] },
              ],
            },
          ],
        },
      ],
    });
  });
});
