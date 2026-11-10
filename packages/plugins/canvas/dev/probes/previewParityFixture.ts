import { DocumentPreviewResultSchema } from '@app/schemas';
import { CanvasCardSchema } from '../../src/shared';

const text = (value: string) => ({ type: 'text', text: value });
const root = (id: string, type: string, attrs: Record<string, unknown>, content: unknown[] = []) => ({
  type: 'rootBlock', attrs: { id }, content: [{ type, attrs: { id: `${id}-body`, ...attrs }, ...(content.length ? { content } : {}) }],
});

/** 彩色图片在本地生成；只给正式 DTO 的准入资源，不联网、不读取用户文档。 */
export function previewParityFixture(document: Document) {
  const image = document.createElement('canvas'); image.width = 240; image.height = 100;
  const context = image.getContext('2d');
  if (!context) throw new Error('preview_parity_canvas_missing');
  context.fillStyle = '#e9c45c'; context.fillRect(0, 0, 240, 100);
  context.fillStyle = '#386d9c'; context.fillRect(20, 15, 80, 70);
  context.fillStyle = '#bf4e4e'; context.beginPath(); context.arc(165, 50, 33, 0, Math.PI * 2); context.fill();
  return DocumentPreviewResultSchema.parse({
    documentId: 'preview-parity', nodeType: 'document', status: 'ready', title: '同源用户预览 · 图片图表公式',
    content: { revisionKey: 'fixture-1', summary: '完整正文不会替换成摘要', detail: {
      format: 'workspace-markdown', assets: { 'image-1': image.toDataURL('image/png') },
      references: { target: { documentId: 'target', status: 'available', nodeType: 'document', title: '稳定标签当前标题' } },
      document: { type: 'doc', content: [
        root('heading', 'headingBlock', { level: 1 }, [text('可读预览必须保持一致')]),
        root('intro', 'baseBlock', {}, [text('中文、English 与标点需要按卡宽换行。空格  保留，'), { type: 'text', text: '作者红色', marks: [{ type: 'textColor', attrs: { color: '#d55252' } }] },
          { type: 'hardBreak' }, text('第二行与引用：'), { type: 'documentReference', attrs: { documentId: 'target', referenceId: 'reference-1' } }]),
        root('image', 'imageBlock', { assetId: 'image-1', src: 'media://approved/image-1', width: 240, height: 100, caption: '图片、图注与原文同源' }),
        root('inline-math', 'baseBlock', {}, [text('行内公式 '), { type: 'inlineLatex', attrs: { latexSource: 'E=mc^2' } }, text(' 和正文一起排版。')]),
        root('math', 'latexBlock', { latexSource: '\\frac{a+b}{c}=\\sqrt{x}' }),
        root('list-a', 'listItemBlock', { listType: 'ordered', start: 3 }, [text('第三项')]),
        root('list-b', 'listItemBlock', { listType: 'ordered', level: 1 }, [text('嵌套第一项')]),
        root('list-c', 'listItemBlock', { listType: 'ordered' }, [text('第四项')]),
        root('quote', 'quoteBlock', { indent: 1 }, [text('引用缩进与颜色需要一致。')]),
        root('chart', 'chartBlock', { spec: { chartType: 'bar', title: '真实图表', categories: ['一月', '二月', '三月'], series: [{ name: '收入', values: [2, 4, 3] }] } }),
        root('table', 'table', {}, [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { style: 'text-align:right', colwidth: [120] }, content: [{ type: 'tableCellContentBlock', content: [text('正式表格')] }] }] }]),
        root('citation', 'baseBlock', {}, [text('来源'), { type: 'citationNode', attrs: { citationId: 'cite-1', sourceId: 'source-1', sourceType: 'web', title: '用户可读的参考文献', authors: ['甲', '乙', '丙'], date: '2026-11-09', url: 'https://example.com/reference' } }]),
        root('bibliography', 'bibliographyBlock', {}),
        root('tail', 'baseBlock', {}, [text('文末验收标记 END')]),
      ] },
    } },
  });
}
export function previewParityCard(width: number, height: number) {
  const source = { kind: 'user', conversationId: null, runId: null };
  return CanvasCardSchema.parse({ id: 'c1', type: 'document', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 0, y: 0, width, height, parentId: null, data: { documentId: 'preview-parity' } });
}

export function previewTimingFixture(document: Document) {
  const source = previewParityFixture(document).content?.detail;
  if (!source || source.format !== 'workspace-markdown') throw new Error('timing_fixture_source_missing');
  const blocks = Array.from({ length: 50 }, (_, index) => root(`timing-${index}`, 'baseBlock', {},
    [text(`第 ${index + 1} 段。正式预览按卡宽显示完整内容，包含中文、English 与作者保存的标点。重复渲染只作为实测样本，不调用模型。`)]));
  for (const index of [2, 20, 35]) blocks[index] = root(`timing-${index}`, 'imageBlock',
    { assetId: 'image-1', src: 'media://approved/image-1', width: 240, height: 100, caption: `第 ${index} 张图片` });
  blocks[10] = root('timing-10', 'table', {}, [{ type: 'tableRow', content: ['甲列', '乙列'].map(value =>
    ({ type: 'tableHeader', content: [{ type: 'tableCellContentBlock', content: [text(value)] }] })) }]);
  return DocumentPreviewResultSchema.parse({ documentId: 'timing-preview', nodeType: 'document', status: 'ready', title: '50 块 · 3 图 · 1 表',
    content: { revisionKey: 'timing-1', summary: '', detail: { ...source, document: { type: 'doc', content: blocks } } } });
}
