// @vitest-environment jsdom
import { Editor, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownImageAttrsSchema } from '@app/schemas';
import { DOMParser } from '@tiptap/pm/model';
import { BaseBlock } from '../../../../../blocks/BaseBlock';
import { ImageBlock } from '../../../../../blocks/ImageBlock/ImageBlock';
import { applyImagePendingItems, partitionImagePendingRevisions } from '../imagePendingRevision';
import {
  blockEventsToRootBlockNodes,
  collectEditorImageSources,
} from '../../../../../services/markdownRuntime';
import { pending } from '../chart/__test__/chartPendingFixtures';
import { commitFigureCaptionAttributes } from '../../../../figure-caption';

const mocks = vi.hoisted(() => ({ startRevision: vi.fn(), parse: vi.fn() }));
vi.mock('@tiptap/vue-3', () => ({ VueNodeViewRenderer: vi.fn(() => vi.fn()) }));
vi.mock('../../../../../blocks/ImageBlock/ui/ImageBlockView.vue', () => ({ default: {} }));
vi.mock('../../../useRevisionStore', () => ({
  useRevisionStore: () => ({ startRevision: mocks.startRevision }),
}));
vi.mock('../../../../../services/markdownRuntime/parser', () => ({
  parseMarkdownToBlockEvents: mocks.parse,
}));

const image = MarkdownImageAttrsSchema.parse({
  id: 'image-1',
  src: 'media://load/asset-image/YQ',
  assetId: 'a',
  caption: '原图',
  width: 80,
  height: 40,
});
const Root = Node.create({
  name: 'rootBlock',
  content: 'baseBlock|imageBlock',
  addAttributes: () => ({ id: { default: null }, backgroundColor: { default: null } }),
  parseHTML: () => [{ tag: 'div[data-root]' }],
  renderHTML: () => ['div', { 'data-root': '' }, 0],
});
const editors: Editor[] = [];
function setup() {
  mocks.startRevision.mockClear();
  const editor = new Editor({
    extensions: [
      Document.extend({ content: 'rootBlock+' }),
      StarterKit.configure({ document: false, trailingNode: false }),
      Root,
      BaseBlock,
      ImageBlock,
    ],
    content: {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-image', backgroundColor: 'red' },
          content: [{ type: 'imageBlock', attrs: image }],
        },
      ],
    },
  });
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
const event = (caption: string) => ({
  block_type: 'ImageBlock',
  attrs: { src: 'linnya-image://image-1', caption, title: '' },
});

describe('图片原子修订与复制', () => {
  it('富 HTML 复制在插入前分配新图片身份，保留题注、来源和尺寸', () => {
    const editor = setup();
    const html = editor.getHTML();
    editor.commands.focus('start');
    const container = document.createElement('div');
    container.innerHTML = html;
    let slice = DOMParser.fromSchema(editor.schema).parseSlice(container);
    editor.view.someProp('transformPasted', transform => {
      slice = transform(slice, editor.view, false);
    });
    editor.view.dispatch(editor.state.tr.insert(0, slice.content));
    const images: Array<Record<string, unknown>> = [];
    editor.state.doc.descendants(node => {
      if (node.type.name === 'imageBlock') images.push(node.attrs);
    });
    expect(images).toHaveLength(2);
    expect(images.filter(attrs => attrs.id === image.id)).toHaveLength(1);
    expect(new Set(images.map(attrs => attrs.id)).size).toBe(2);
    for (const attrs of images)
      expect(attrs).toMatchObject({
        caption: image.caption,
        src: image.src,
        width: image.width,
        assetId: image.assetId,
      });
  });
  it('快速连续确认题注仍各占一步撤销，不与前一次确认合并', () => {
    const editor = setup();
    commitFigureCaptionAttributes(editor, 1, { ...image, caption: '第一次' });
    commitFigureCaptionAttributes(editor, 1, { ...image, caption: '第二次' });
    editor.commands.undo();
    expect(editor.state.doc.firstChild?.firstChild?.attrs.caption).toBe('第一次');
    editor.commands.undo();
    expect(editor.state.doc.firstChild?.firstChild?.attrs.caption).toBe('原图');
  });
  it('题注预览只替换图片内容，保留来源、尺寸与根块样式，并登记一个投影事务', async () => {
    const editor = setup();
    mocks.parse.mockResolvedValue([event('新题注')]);
    const parsed = pending({
      id: 'p1',
      blockId: 'root-image',
      newMarkdown: '![新题注](linnya-image://image-1)',
      metadata: { image },
    });
    const { imageItems } = await partitionImagePendingRevisions(editor.state.doc, [parsed]);
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    expect(applyImagePendingItems(editor, imageItems)[0]?.success).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0].getMeta('pendingRevisionApply')).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.backgroundColor).toBe('red');
    expect(editor.state.doc.firstChild?.firstChild?.attrs).toMatchObject({
      ...image,
      caption: '新题注',
    });
    expect(mocks.startRevision).toHaveBeenCalledTimes(1);
  });
  it('损坏来源快照不能回退成文本或阻断其他修订；删除只登记对照，保留基线图像', async () => {
    const editor = setup(),
      before = editor.state.doc;
    mocks.parse.mockResolvedValue([event('新题注')]);
    const { imageItems } = await partitionImagePendingRevisions(before, [
      pending({
        id: 'bad',
        blockId: 'root-image',
        newMarkdown: '![新题注](linnya-image://image-1)',
      }),
      pending({ id: 'delete', blockId: 'root-image', operation: 'delete' }),
    ]);
    expect(applyImagePendingItems(editor, imageItems).map(result => result.success)).toEqual([
      false,
      true,
    ]);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(mocks.startRevision).toHaveBeenCalledTimes(1);
  });
  it('同文档多次复制独立身份、共用资产；未知引用与混排整批拒绝', () => {
    const editor = setup();
    const options = { imageSources: collectEditorImageSources(editor.state.doc), copyImages: true };
    const copied = blockEventsToRootBlockNodes(
      [event('副本一'), event('副本二')],
      editor.schema,
      options
    );
    expect(new Set([image.id, ...copied.map(root => root.firstChild?.attrs.id)]).size).toBe(3);
    expect(copied.map(root => root.firstChild?.attrs.assetId)).toEqual(['a', 'a']);
    expect(() => blockEventsToRootBlockNodes([event('未知')], editor.schema)).toThrow(
      '不属于当前文档'
    );
    expect(() =>
      blockEventsToRootBlockNodes(
        [
          event('合法'),
          {
            block_type: 'BaseBlock',
            structured_content: [{ type: 'image', attrs: { src: 'conversation:/x.png' } }],
          },
        ],
        editor.schema,
        options
      )
    ).toThrow('独占一个段落');
  });
});
