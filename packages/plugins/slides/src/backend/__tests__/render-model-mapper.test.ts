import { describe, expect, it } from 'vitest';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper.js';
import { applyTextLayoutToRenderModel } from '../engine/text/renderModelTextLayout.js';
import type { DeckSpec } from '@plugin/slides/shared';
import type { CanonicalDeck } from '@plugin/slides/shared';

const mapper = new RenderModelMapper();

describe('RenderModelMapper', () => {
  it('maps generated structured deck directly from DeckSpec without PPTX parse loss', () => {
    const deckSpec: DeckSpec = {
      title: 'Structured Render',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          background: { color: '#112233' },
          elements: [
            {
              type: 'title',
              content: 'Quarterly Review',
              style: { fontSize: 28, bold: true, color: '#123456' },
              position: { x: 0.8, y: 0.6, w: 8.4, h: 0.8 },
            },
            {
              type: 'chart',
              chartType: 'bar',
              data: {
                categories: ['Q1', 'Q2'],
                series: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [10, 20] }],
              },
              position: { x: 0.8, y: 1.8, w: 5.5, h: 3.2 },
            },
            {
              type: 'table',
              headers: ['Region', 'Growth'],
              rows: [[{ text: 'NA' }, { text: '18%' }]],
              position: { x: 6.6, y: 1.8, w: 2.6, h: 1.8 },
            },
          ],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-1',
      3,
      'Structured Render',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.capabilities.hasSemanticRender).toBe(true);
    expect(model.slides[0].background.paint).toEqual({ type: 'solid', color: '#112233' });
    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'text',
      paragraphs: [{ runs: [{ text: 'Quarterly Review', fontWeight: 'bold', color: '#123456' }] }],
      editableTarget: {
        slideNumber: 1,
        elementId: 's1-generated-0',
        operations: ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer'],
      },
    });
    expect(model.slides[0].elements[1]).toMatchObject({
      kind: 'chart',
      chartType: 'column',
      categories: ['Q1', 'Q2'],
      series: [{ name: 'Revenue', values: [10, 20] }],
      palette: ['#B64646', '#4776B1', '#59714B', '#7A548E', '#41A5B4', '#D88C3A'],
      legend: { visible: false },
    });
    expect(model.slides[0].elements[2]).toMatchObject({
      kind: 'table',
      headerRows: 1,
      columns: [1.224, 1.376],
      rows: [0.28, 1.52],
    });
  });

  it('preserves generated background gradient source semantics', () => {
    const deckSpec: DeckSpec = {
      title: 'Gradient Render',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          background: {
            color: '#101820',
            gradient: {
              type: 'linear',
              angle: 135,
              stops: [
                { color: '#101820', position: 0 },
                { color: '#2A9D8F', position: 1 },
              ],
            },
          },
          elements: [],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-gradient',
      1,
      'Gradient Render',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].background.paint).toEqual({
      type: 'linear',
      angle: 135,
      stops: [
        { color: '#101820', position: 0 },
        { color: '#2A9D8F', position: 1 },
      ],
    });
    expect(model.slides[0].background.imageSrc).toBeUndefined();
  });

  it('surfaces generated shape gradient fills in render model', () => {
    const deckSpec: DeckSpec = {
      title: 'Gradient Shape Render',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{
            type: 'shape',
            geometry: 'rect',
            position: { x: 1, y: 1, w: 3, h: 1 },
            style: {
              gradient: {
                type: 'linear',
                angle: 45,
                stops: [
                  { color: '#0F2747', position: 0 },
                  { color: '#F97316', position: 1 },
                ],
              },
            },
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-gradient-shape',
      1,
      'Gradient Shape Render',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'shape',
      fill: {
        type: 'linear',
        angle: 45,
        stops: [
          { color: '#0F2747', position: 0 },
          { color: '#F97316', position: 1 },
        ],
      },
    });
  });

  it('maps generated freeform group children with compiler-compatible transforms', () => {
    const deckSpec: DeckSpec = {
      title: 'Freeform Render',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{
            type: 'group',
            position: { x: 1, y: 1, w: 6, h: 2 },
            _semanticNodeId: 'milestone-0',
            _semanticRole: 'milestone',
            children: [
              {
                type: 'text',
                position: { x: 0, y: 0, w: 4, h: 1 },
                content: 'Child 1',
                _semanticNodeId: 'milestone-0',
                _semanticRole: 'milestone',
              },
              {
                type: 'shape',
                geometry: 'rect',
                position: { x: 4, y: 0, w: 4, h: 1 },
                style: { fill: '#FF0000' },
                _semanticNodeId: 'milestone-0',
                _semanticRole: 'milestone',
              },
            ],
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-2',
      1,
      'Freeform Render',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements).toHaveLength(1);
    // B10：children.box 是相对 group origin 的英寸偏移；group 自己的 box 是 slide 全局
    // group = (1,1,6,2)，DSL children base bounds=(0,0,8,1)
    // scaleX = 6/8 = 0.75, scaleY = 2/1 = 2
    // child0 DSL=(0,0,4,1) → global (1,1,3,2) → relative (0,0,3,2)
    // child1 DSL=(4,0,4,1) → global (4,1,3,2) → relative (3,0,3,2)
    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'group',
      box: { x: 1, y: 1, w: 6, h: 2, unit: 'in' },
      children: [
        {
          kind: 'text',
          box: { x: 0, y: 0, w: 3, h: 2, unit: 'in' },
          editableTarget: {
            slideNumber: 1,
            elementId: 's1-freeform-0',
            semanticNodeId: 'milestone-0',
            semanticRole: 'milestone',
            operations: ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer', 'relayout_slide'],
          },
        },
        {
          kind: 'shape',
          box: { x: 3, y: 0, w: 3, h: 2, unit: 'in' },
          fill: { type: 'solid', color: '#FF0000' },
          editableTarget: {
            slideNumber: 1,
            semanticNodeId: 'milestone-0',
            semanticRole: 'milestone',
            operations: ['modify_style', 'modify_geometry', 'reorder_layer', 'relayout_slide'],
          },
        },
      ],
    });
  });

  it('does not advertise relayout_slide for unstamped generated elements', () => {
    const deckSpec: DeckSpec = {
      title: 'Unstamped Generated',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{
            type: 'text',
            position: { x: 1, y: 1, w: 3, h: 1 },
            content: 'Standalone text',
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-unstamped',
      1,
      'Unstamped Generated',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'text',
      editableTarget: {
        slideNumber: 1,
        elementId: 's1-freeform-0',
        operations: ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer'],
      },
    });
  });

  it('maps canonical imported elements with editable targets from patch metadata', () => {
    const canonical: CanonicalDeck = {
      nodeId: 'node-imported',
      versionNumber: 4,
      title: 'Imported Deck',
      slideSize: { width: 10, height: 5.625 },
      theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
      masterCount: 0,
      slides: [{
        slideId: 's1',
        number: 1,
        layoutName: 'DEFAULT',
        elements: [{
          elementId: 'cid-123',
          role: 'image',
          position: { x: 1, y: 1, w: 3, h: 2 },
          zOrder: 0,
          imageRef: '../media/image1.png',
          patchMeta: { creationId: '123', elementName: 'Picture 1' },
        }],
      }],
    };

    const model = mapper.fromCanonicalDeck(
      canonical,
      { title: 'Imported Deck', slides: [] },
      'imported',
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'image',
      editableTarget: {
        elementId: 'cid-123',
        creationId: '123',
        elementName: 'Picture 1',
        operations: ['edit_image', 'modify_geometry', 'reorder_layer'],
        imageEditCapabilities: {
          replaceSource: true,
          editVisuals: false,
        },
      },
    });
  });

  // ─── B9 chart palette 三端取色契约 ────────────────────────────────
  it('B9: chart series.color / chart.palette / canonical fallback 都来自同一 resolveChartPalette(theme)', () => {
    const theme = {
      colors: {},
      fonts: { major: 'Arial', minor: 'Arial' },
      chart: { palette: ['#AA0001', '#AA0002', '#AA0003'] },
    };

    // generated 路径：structured chart 的 series.color 与 chart.palette 都用 theme.chart.palette
    const deckSpec: DeckSpec = {
      title: 'Palette Lock',
      theme: theme as DeckSpec['theme'],
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'chart',
            chartType: 'bar',
            position: { x: 0, y: 0, w: 4, h: 3 },
            data: {
              categories: ['A', 'B'],
              series: [
                { name: 's1', values: [1, 2] },
                { name: 's2', values: [3, 4] },
              ],
            },
          }],
        },
      }],
    };
    const generated = mapper.fromGeneratedDeck(
      'node-palette',
      1,
      'Palette Lock',
      deckSpec,
      { width: 10, height: 5.625 },
    );
    const chartNode = generated.slides[0].elements[0] as { kind: string; palette: string[]; series: Array<{ color: string }> };
    expect(chartNode.kind).toBe('chart');
    expect(chartNode.palette).toEqual(['#AA0001', '#AA0002', '#AA0003']);
    expect(chartNode.series[0].color).toBe('#AA0001');
    expect(chartNode.series[1].color).toBe('#AA0002');

    // imported fallback chart：palette 也走 theme.chart.palette
    const canonical: CanonicalDeck = {
      nodeId: 'node-palette-imported',
      versionNumber: 1,
      title: 'Palette Imported',
      slideSize: { width: 10, height: 5.625 },
      theme: theme as CanonicalDeck['theme'],
      masterCount: 0,
      slides: [{
        slideId: 's1',
        number: 1,
        layoutName: 'DEFAULT',
        elements: [{
          elementId: 'cid-chart',
          role: 'chart',
          position: { x: 1, y: 1, w: 3, h: 2 },
          zOrder: 0,
          chartType: 'bar',
          patchMeta: { creationId: 'c1', elementName: 'Chart 1' },
        }],
      }],
    };
    const imported = mapper.fromCanonicalDeck(canonical, { title: 'X', slides: [] }, 'imported');
    const importedChart = imported.slides[0].elements[0] as { kind: string; palette: string[] };
    expect(importedChart.kind).toBe('chart');
    expect(importedChart.palette).toEqual(['#AA0001', '#AA0002', '#AA0003']);
  });

  // ─── B12 valign 贯通契约：imported 路径 ───────────────────────────
  it('B12: imported text 节点透传 OOXML bodyPr@anchor 提取的 verticalAlign', () => {
    const cases: Array<{ anchor: 'top' | 'middle' | 'bottom'; expected: 'top' | 'middle' | 'bottom' }> = [
      { anchor: 'top', expected: 'top' },
      { anchor: 'middle', expected: 'middle' },
      { anchor: 'bottom', expected: 'bottom' },
    ];

    for (const { anchor, expected } of cases) {
      const canonical: CanonicalDeck = {
        nodeId: `node-imported-valign-${anchor}`,
        versionNumber: 1,
        title: 'Imported Valign Deck',
        slideSize: { width: 10, height: 5.625 },
        theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
        masterCount: 0,
        slides: [{
          slideId: 's1',
          number: 1,
          layoutName: 'DEFAULT',
          elements: [{
            elementId: 'txt-1',
            role: 'body',
            position: { x: 1, y: 1, w: 3, h: 2 },
            zOrder: 0,
            text: 'Hello',
            visual: { textVerticalAlign: anchor },
            patchMeta: { creationId: '1', elementName: 'TextBox 1' },
          }],
        }],
      };

      const model = mapper.fromCanonicalDeck(canonical, { title: 'X', slides: [] }, 'imported');
      const node = model.slides[0].elements[0];
      expect(node.kind).toBe('text');
      expect((node as { verticalAlign?: string }).verticalAlign).toBe(expected);
    }
  });

  // ─── B13 shape innerText 三路一致性契约 ─────────────────────────────
  it('B13: imported shape innerText 与 generated 一致：有 padding + autoFitPolicy=shrink-text', () => {
    const canonical: CanonicalDeck = {
      nodeId: 'node-imported-inner-padding',
      versionNumber: 1,
      title: 'Imported Inner Padding Deck',
      slideSize: { width: 10, height: 5.625 },
      theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
      masterCount: 0,
      slides: [{
        slideId: 's1',
        number: 1,
        layoutName: 'DEFAULT',
        elements: [{
          elementId: 'shape-1',
          role: 'shape',
          position: { x: 1, y: 1, w: 3, h: 2 },
          zOrder: 0,
          text: 'Inside imported shape',
          visual: { shapeKind: 'rect' },
          patchMeta: { creationId: '99', elementName: 'Rect 1' },
        }],
      }],
    };

    const model = mapper.fromCanonicalDeck(canonical, { title: 'X', slides: [] }, 'imported');
    const node = model.slides[0].elements[0];
    expect(node.kind).toBe('shape');
    const innerText = (node as { innerText?: { padding?: { top: number; right: number; bottom: number; left: number }; autoFitPolicy?: string; verticalAlign?: string } }).innerText;
    // imported inner text 必须有 padding（pt → in 转换）：B13 修复前是 undefined
    expect(innerText?.padding).toBeDefined();
    expect(innerText?.padding?.top).toBeGreaterThan(0);
    expect(innerText?.padding?.left).toBeGreaterThan(0);
    // autoFit 行为必须与 generated shape inner text 一致
    expect(innerText?.autoFitPolicy).toBe('shrink-text');
  });

  it('B12: imported shape 内文本（innerText）也透传 verticalAlign', () => {
    const canonical: CanonicalDeck = {
      nodeId: 'node-imported-shape-valign',
      versionNumber: 1,
      title: 'Imported Shape Valign Deck',
      slideSize: { width: 10, height: 5.625 },
      theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
      masterCount: 0,
      slides: [{
        slideId: 's1',
        number: 1,
        layoutName: 'DEFAULT',
        elements: [{
          elementId: 'shape-1',
          role: 'shape',
          position: { x: 1, y: 1, w: 3, h: 2 },
          zOrder: 0,
          text: 'Inside shape',
          visual: { shapeKind: 'rect', textVerticalAlign: 'bottom' },
          patchMeta: { creationId: '2', elementName: 'Rect 1' },
        }],
      }],
    };

    const model = mapper.fromCanonicalDeck(canonical, { title: 'X', slides: [] }, 'imported');
    const node = model.slides[0].elements[0];
    expect(node.kind).toBe('shape');
    const innerText = (node as { innerText?: { verticalAlign?: string } }).innerText;
    expect(innerText?.verticalAlign).toBe('bottom');
  });

  it('maps canonical group children recursively for imported decks', () => {
    const canonical: CanonicalDeck = {
      nodeId: 'node-imported-group',
      versionNumber: 5,
      title: 'Imported Group Deck',
      slideSize: { width: 10, height: 5.625 },
      theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
      masterCount: 0,
      slides: [{
        slideId: 's1',
        number: 1,
        layoutName: 'DEFAULT',
        elements: [{
          elementId: 'cid-group',
          role: 'group',
          position: { x: 1, y: 1, w: 4, h: 2 },
          zOrder: 0,
          patchMeta: { creationId: 'group', elementName: 'Group 1' },
          children: [{
            elementId: 'cid-text',
            role: 'body',
            text: 'Grouped imported text',
            position: { x: 1.2, y: 1.3, w: 1.8, h: 0.5 },
            zOrder: 0,
            patchMeta: { creationId: 'child', elementName: 'Grouped Text' },
          }],
        }],
      }],
    };

    const model = mapper.fromCanonicalDeck(
      canonical,
      { title: 'Imported Group Deck', slides: [] },
      'imported',
    );

    expect(model.slides[0].elements).toHaveLength(1);
    // B10：children.box 是相对 group origin 的偏移；详见 CONTRACTS §4.7
    // group at (1,1)，child 全局 (1.2, 1.3) → 相对 (0.2, 0.3)
    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'group',
      box: { x: 1, y: 1, w: 4, h: 2, unit: 'in' },
      children: [{
        kind: 'text',
        // 坐标变换保留完整精度；断言业务位置，不要求提前截到三位小数。
        box: { x: expect.closeTo(0.2, 12), y: expect.closeTo(0.3, 12), w: 1.8, h: 0.5, unit: 'in' },
        editableTarget: {
          elementId: 'cid-text',
          creationId: 'child',
          elementName: 'Grouped Text',
          operations: ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer'],
        },
      }],
    });
  });

  // ─── B10 group children 坐标契约：嵌套 group 多层 transform ──────────
  it('B10: 嵌套 group children 都是相对父 group origin 的偏移（递归契约）', () => {
    const canonical: CanonicalDeck = {
      nodeId: 'node-nested-group',
      versionNumber: 1,
      title: 'Nested Group Deck',
      slideSize: { width: 10, height: 5.625 },
      theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
      masterCount: 0,
      slides: [{
        slideId: 's1',
        number: 1,
        layoutName: 'DEFAULT',
        elements: [{
          elementId: 'g-outer',
          role: 'group',
          position: { x: 1, y: 1, w: 6, h: 4 },
          zOrder: 0,
          patchMeta: { creationId: 'g1', elementName: 'OuterGroup' },
          children: [
            {
              elementId: 't-direct',
              role: 'body',
              text: 'direct child',
              position: { x: 1.5, y: 1.5, w: 1, h: 0.5 },
              zOrder: 0,
              patchMeta: { creationId: 't1', elementName: 'DirectText' },
            },
            {
              elementId: 'g-inner',
              role: 'group',
              position: { x: 3, y: 2, w: 3, h: 2 },
              zOrder: 1,
              patchMeta: { creationId: 'g2', elementName: 'InnerGroup' },
              children: [{
                elementId: 't-deep',
                role: 'body',
                text: 'deep child',
                position: { x: 4, y: 3, w: 1, h: 0.5 },
                zOrder: 0,
                patchMeta: { creationId: 't2', elementName: 'DeepText' },
              }],
            },
          ],
        }],
      }],
    };

    const model = mapper.fromCanonicalDeck(canonical, { title: 'X', slides: [] }, 'imported');
    const outer = model.slides[0].elements[0] as { kind: string; box: { x: number; y: number }; children: Array<{ id: string; kind: string; box: { x: number; y: number }; children?: Array<{ id: string; box: { x: number; y: number } }> }> };
    expect(outer.kind).toBe('group');
    expect(outer.box).toMatchObject({ x: 1, y: 1 });

    // direct child 全局 (1.5, 1.5)，相对 outer (1,1) → (0.5, 0.5)
    const direct = outer.children.find((c) => c.kind === 'text');
    expect(direct?.box).toMatchObject({ x: 0.5, y: 0.5 });

    // inner group 全局 (3, 2)，相对 outer (1,1) → (2, 1)
    const inner = outer.children.find((c) => c.kind === 'group');
    expect(inner?.box).toMatchObject({ x: 2, y: 1 });

    // deep child 全局 (4, 3)，相对 inner（自身相对 outer 已是 (2,1)，原绝对是 (3,2)） → (4-3, 3-2) = (1, 1)
    const deep = inner?.children?.[0];
    expect(deep?.box).toMatchObject({ x: 1, y: 1 });
  });

  it('B10: generated freeform group children 同样按相对 origin 输出', () => {
    const deckSpec: DeckSpec = {
      title: 'Generated Group Deck',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{
            type: 'group',
            position: { x: 2, y: 1, w: 4, h: 3 },
            children: [
              { type: 'text', content: 'a', position: { x: 0, y: 0, w: 1, h: 1 } },
              { type: 'text', content: 'b', position: { x: 2, y: 1, w: 1, h: 1 } },
            ],
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-generated-group',
      1,
      'Generated Group Deck',
      deckSpec,
      { width: 10, height: 5.625 },
    );
    const group = model.slides[0].elements[0] as { kind: string; box: { x: number; y: number }; children: Array<{ box: { x: number; y: number } }> };
    expect(group.kind).toBe('group');
    expect(group.box).toMatchObject({ x: 2, y: 1 });
    // children 相对 group origin：第一个 child 应在 (0,0)，第二个在 (2,1)
    // freeform group transform 会基于 children bounds 做缩放，但相对契约依然保持
    // child0 全局 ≈ group.x + 0*scaleX = group.x，child0.relative = 0
    expect(group.children[0].box.x).toBeCloseTo(0, 2);
    expect(group.children[0].box.y).toBeCloseTo(0, 2);
    // child1 相对：(2-0)*scaleX, (1-0)*scaleY，scaleX=group.w/bounds.w=4/3, scaleY=group.h/bounds.h=3/2
    expect(group.children[1].box.x).toBeCloseTo(2 * (4 / 3), 2);
    expect(group.children[1].box.y).toBeCloseTo(1 * (3 / 2), 2);
  });

  it('defers generated resize-shape expansion until the single text finalization pass', () => {
    const deckSpec: DeckSpec = {
      title: 'Generated Text Box',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'text',
            content: 'Three wedges can unlock +$42M revenue and +$11M EBITDA by FY27 if capability build, GTM activation, and delivery industrialization are sequenced in Year 1.',
            style: { fontSize: 12, bold: true, color: '#2D3748' },
            position: { x: 0.7, y: 3.267, w: 8.6, h: 0.027 },
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-text-box',
      1,
      'Generated Text Box',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'text',
      box: {
        x: 0.7,
        y: 3.267,
        w: 8.6,
        unit: 'in',
      },
    });
    expect(model.slides[0].elements[0].kind).toBe('text');
    if (model.slides[0].elements[0].kind !== 'text') {
      throw new Error('Expected text render node');
    }
    expect(model.slides[0].elements[0].box.h).toBe(0.027);

    applyTextLayoutToRenderModel(model);
    expect(model.slides[0].elements[0].box.h).toBeGreaterThan(0.027);
    expect(model.slides[0].elements[0].layout).toBeDefined();
  });

  it('keeps thin shape text on compiler-compatible shrink policy instead of inventing a larger preview-only box', () => {
    const deckSpec: DeckSpec = {
      title: 'Generated Shape Text',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'shape',
            geometry: 'rect',
            text: 'Lead with wedge-specific ROI narratives, not a horizontal platform pitch.',
            style: { fill: '#F1F5F9' },
            position: { x: 0.7, y: 3.544, w: 3.5, h: 0.035 },
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-shape-text',
      1,
      'Generated Shape Text',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0].kind).toBe('shape');
    if (model.slides[0].elements[0].kind !== 'shape') {
      throw new Error('Expected shape render node');
    }

    expect(model.slides[0].elements[0].innerText).toMatchObject({
      autoFitPolicy: 'shrink-text',
      box: { h: 0.035 },
    });

    applyTextLayoutToRenderModel(model);
    expect(model.slides[0].elements[0].innerText?.box.h).toBe(0.035);
    expect(model.slides[0].elements[0].innerText?.layout).toBeDefined();
  });

  it('maps explicit chart legend settings from structured chart options', () => {
    const deckSpec: DeckSpec = {
      title: 'Chart Legend',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'chart',
            chartType: 'bar',
            data: {
              categories: ['2025', '2026'],
              series: [
                { name: 'Revenue', labels: ['2025', '2026'], values: [42, 58] },
                { name: 'EBITDA', labels: ['2025', '2026'], values: [8, 13] },
              ],
            },
            position: { x: 0.8, y: 1.2, w: 5.4, h: 3.0 },
            options: {
              showLegend: true,
              legendPos: 'b',
            },
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-legend',
      1,
      'Chart Legend',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'chart',
      legend: {
        visible: true,
        position: 'bottom',
      },
    });
  });

  it('maps generated chart palette from deck theme accents in compiler order', () => {
    const deckSpec: DeckSpec = {
      title: 'Chart Theme',
      theme: {
        colors: {
          accent1: '#1122EE',
          accent2: '#CC3333',
          accent3: '#999999',
          accent4: '#FFC000',
        },
      },
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'chart',
            chartType: 'bar',
            data: {
              categories: ['2025', '2026'],
              series: [
                { name: 'Revenue', labels: ['2025', '2026'], values: [42, 58] },
                { name: 'EBITDA', labels: ['2025', '2026'], values: [8, 13] },
              ],
            },
            position: { x: 0.8, y: 1.2, w: 5.4, h: 3.0 },
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-theme',
      1,
      'Chart Theme',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'chart',
      palette: ['#CC3333', '#1122EE', '#999999', '#FFC000', '#41A5B4', '#D88C3A'],
    });
  });

  it('prefers explicit theme chart palette over derived accent order', () => {
    const deckSpec: DeckSpec = {
      title: 'Explicit Chart Palette',
      theme: {
        colors: {
          accent1: '#1122EE',
          accent2: '#CC3333',
        },
        chart: {
          palette: ['#101010', '#202020', '#303030'],
        },
      },
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'chart',
            chartType: 'bar',
            data: {
              categories: ['2025', '2026'],
              series: [
                { name: 'Revenue', labels: ['2025', '2026'], values: [42, 58] },
                { name: 'EBITDA', labels: ['2025', '2026'], values: [8, 13] },
              ],
            },
            position: { x: 0.8, y: 1.2, w: 5.4, h: 3.0 },
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-explicit-theme',
      1,
      'Explicit Chart Palette',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'chart',
      palette: ['#101010', '#202020', '#303030'],
    });
  });

  it('maps bullet paragraphs with pptxgen-compatible hanging indent semantics', () => {
    const deckSpec: DeckSpec = {
      title: 'Bullet Layout',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'bulletList',
            items: [
              { text: 'Lead with wedge-specific ROI narratives' },
              { text: 'Fund blueprint factory before GTM scale', level: 1 },
            ],
            position: { x: 0.8, y: 1.4, w: 4.8, h: 1.8 },
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-bullet',
      1,
      'Bullet Layout',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'text',
      paragraphs: [
        {
          indent: 0.375,
          bullet: { type: 'disc', level: 0 },
        },
        {
          indent: 0.75,
          bullet: { type: 'disc', level: 1 },
        },
      ],
    });
  });

  it('freeform shape borderRadius 透传到 cornerRadius（与 structured / FreeformCompiler.rectRadius 三端对齐）', () => {
    // 回归：曾经此处错误地锁定 cornerRadius=undefined，导致 freeform pill 在前端
    // 走 OOXML roundRect 默认 adj = 16667/100000（约短边/6）的小圆角，而 pptx 导出
    // 经 FreeformCompiler.rectRadius 是真正的全圆角，前端预览与导出明显不一致。
    // 现在契约：mapFreeformShapeNode 与 mapStructuredElement 'shape' 分支必须一致透传。
    const deckSpec: DeckSpec = {
      title: 'Freeform Radius',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [
            // freeform pill：roundRect + borderRadius = h/2，期望渲染为完美胶囊
            {
              type: 'shape',
              geometry: 'roundRect',
              position: { x: 2, y: 1.2, w: 6, h: 0.36 },
              style: { fill: '#5A1620', borderRadius: 0.18 },
            },
            // freeform rect：保留原始 borderRadius，不做 cap，cap 是 shapeBuilder 职责
            {
              type: 'shape',
              geometry: 'rect',
              position: { x: 1, y: 1, w: 3, h: 0.3 },
              style: { fill: '#DDE4ED', borderRadius: 8 },
            },
          ],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-3',
      1,
      'Freeform Radius',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'shape',
      geometry: { type: 'preset', name: 'roundRect' },
      fill: { type: 'solid', color: '#5A1620' },
      cornerRadius: 0.18,
    });
    expect(model.slides[0].elements[1]).toMatchObject({
      kind: 'shape',
      geometry: { type: 'preset', name: 'rect' },
      fill: { type: 'solid', color: '#DDE4ED' },
      cornerRadius: 8,
    });
  });

  it('maps structured shape text with compiler-compatible font sizing and shrink policy', () => {
    const deckSpec: DeckSpec = {
      title: 'Structured Shape Text',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'shape',
            geometry: 'rect',
            position: { x: 7.1, y: 1.139, w: 2.2, h: 0.899 },
            style: { fill: '#F1F5F9', borderRadius: 4 },
            text: 'Stand up a repeatable delivery engine',
          }],
        },
      }],
    };

    const model = mapper.fromGeneratedDeck(
      'node-4',
      1,
      'Structured Shape Text',
      deckSpec,
      { width: 10, height: 5.625 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'shape',
      cornerRadius: 4,
      innerText: {
        autoFitPolicy: 'shrink-text',
        verticalAlign: 'top',
        padding: {
          top: 0.08333333333333333,
          right: 0.1111111111111111,
          bottom: 0.08333333333333333,
          left: 0.1111111111111111,
        },
        paragraphs: [{
          runs: [{
            text: 'Stand up a repeatable delivery engine',
            fontSize: 9,
            fontFamily: 'Calibri',
          }],
          align: 'left',
        }],
      },
    });
  });

  it('keeps canonical path semantic capability disabled for imported decks', () => {
    const canonical: CanonicalDeck = {
      nodeId: 'node-5',
      versionNumber: 2,
      title: 'Imported Deck',
      slideSize: { width: 10, height: 5.625 },
      slides: [{
        slideId: 's1',
        number: 1,
        layoutName: 'DEFAULT',
        elements: [{
          elementId: 'img-1',
          role: 'image',
          imageRef: '../media/image1.png',
          position: { x: 1, y: 1, w: 4, h: 3 },
          zOrder: 0,
          patchMeta: { elementName: 'Picture 1' },
        }],
      }],
      theme: { colors: {}, fonts: { major: 'Arial', minor: 'Calibri' } },
      masterCount: 1,
    };

    const deckSpec: DeckSpec = { title: 'Imported Deck', slides: [] };
    const model = mapper.fromCanonicalDeck(canonical, deckSpec, 'imported');

    expect(model.capabilities.hasSemanticRender).toBe(false);
    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'image',
      assetRef: { type: 'embedded', partPath: '../media/image1.png' },
    });
  });

  it('does not let canonical image refs bypass the remote asset ban', () => {
    const canonical: CanonicalDeck = {
      nodeId: 'node-remote-image',
      versionNumber: 1,
      title: 'Imported Deck',
      slideSize: { width: 10, height: 5.625 },
      slides: [{
        slideId: 's1',
        number: 1,
        elements: [{
          elementId: 'img-1',
          role: 'image',
          imageRef: 'https://example.com/image.png',
          position: { x: 1, y: 1, w: 4, h: 3 },
          zOrder: 0,
          patchMeta: {},
        }],
      }],
      theme: { colors: {}, fonts: { major: 'Arial', minor: 'Calibri' } },
      masterCount: 1,
    };

    expect(() => mapper.fromCanonicalDeck(
      canonical,
      { title: 'Imported Deck', slides: [] },
      'imported',
    )).toThrow(/does not use remote image URLs/);
  });

  it('maps only resolved owned SVG content into the generated RenderModel', () => {
    const assetRef = {
      kind: 'owned_svg' as const,
      assetId: 'svg-asset-1',
      contentHash: 'd'.repeat(64),
      byteLength: 96,
      viewBox: { width: 100, height: 50 },
    };
    const deckSpec: DeckSpec = {
      title: 'SVG Render',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{
            type: 'svgGraphic',
            asset: assetRef,
            position: { x: 1, y: 1, w: 6, h: 3 },
            fit: 'contain',
            opacity: 0.8,
            rotate: 5,
            decorative: true,
          }],
        },
      }],
    };
    const canonicalSvg = '<svg viewBox="0 0 100 50"><path d="M0 0L100 50"/></svg>';

    const model = mapper.fromGeneratedDeck(
      'node-svg',
      1,
      deckSpec.title,
      deckSpec,
      { width: 10, height: 5.625 },
      {},
      new Map([[assetRef.assetId, { ...assetRef, canonicalSvg }]]),
    );

    expect(model.slides[0].elements[0]).toEqual(expect.objectContaining({
      kind: 'svgGraphic',
      canonicalSvg,
      contentHash: assetRef.contentHash,
      viewBox: assetRef.viewBox,
      fit: 'contain',
      opacity: 0.8,
      rotation: 5,
      decorative: true,
      editableTarget: expect.objectContaining({
        operations: ['modify_geometry', 'reorder_layer'],
      }),
    }));
  });
});
