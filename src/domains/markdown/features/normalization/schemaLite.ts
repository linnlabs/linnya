/**
 * @file schemaLite.ts
 * @description 后端 Markdown 规范化使用的轻量 Schema。
 *
 * 设计目标：
 * - 只覆盖会进入持久化 `content_json` 的节点/marks；
 * - 不引入任何 Vue NodeView、Tiptap Extension、编辑器交互依赖；
 * - 仅用于后端校验导入后的 JSON 结构是否合法。
 */

import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import { createWorkspaceMarkdownSchemaContract } from './definitions/workspaceMarkdownSchemaContract';
import { assertProseMirrorJsonMatchesSchema } from './functions/assertProseMirrorJsonMatchesSchema';
import type { MarkdownDocJson } from './types';
import { MarkdownAnnotationsSchema } from '@app/schemas';

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: 'rootBlock+',
  },
  text: {
    group: 'inline',
  },
  hardBreak: {
    inline: true,
    group: 'inline',
    selectable: false,
  },
  inlineLatex: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      latexSource: { default: '' },
    },
  },
  citationNode: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    marks: '_',
    attrs: {
      citationId: { default: '' },
      ref: { default: null },
      sourceType: { default: 'manual' },
      sourceId: { default: '' },
      kbId: { default: null },
      blockId: { default: null },
      title: { default: '' },
      snippet: { default: '' },
      snippets: { default: null },
      authors: { default: null },
      date: { default: null },
      url: { default: null },
      containerTitle: { default: null },
    },
  },
  rootBlock: {
    group: 'block',
    content:
      '(baseBlock | headingBlock | horizontalRuleBlock | listItemBlock | quoteBlock | codeBlock | latexBlock | table | imageBlock | bibliographyBlock){1}',
    defining: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      annotations: {
        default: [],
        validate: (value: unknown) => {
          MarkdownAnnotationsSchema.parse(value);
        },
      },
      position: { default: null },
      isDragging: { default: false },
      backgroundColor: { default: null },
      textColor: { default: null },
    },
  },
  baseBlock: {
    group: 'blockContent',
    content: 'inline*',
    defining: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'base' },
      textAlign: { default: 'left' },
      indent: { default: 0 },
      isEmpty: { default: true },
      backgroundColor: { default: null },
      textColor: { default: null },
    },
  },
  headingBlock: {
    group: 'blockContent',
    content: 'inline*',
    defining: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'heading' },
      level: { default: 1 },
      textAlign: { default: 'left' },
      indent: { default: 0 },
      collapsible: { default: false },
      collapsed: { default: false },
      backgroundColor: { default: null },
      textColor: { default: null },
    },
  },
  horizontalRuleBlock: {
    group: 'blockContent',
    atom: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'horizontalRule' },
    },
  },
  listItemBlock: {
    group: 'blockContent',
    content: 'inline*',
    defining: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'listItem' },
      listType: { default: 'bullet' },
      level: { default: 0 },
      start: { default: null },
      textAlign: { default: 'left' },
      backgroundColor: { default: null },
      textColor: { default: null },
    },
  },
  quoteBlock: {
    group: 'blockContent',
    content: 'inline*',
    defining: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'quote' },
      textAlign: { default: 'left' },
      indent: { default: 0 },
      isEmpty: { default: true },
      backgroundColor: { default: null },
      textColor: { default: null },
    },
  },
  codeBlock: {
    group: 'blockContent',
    content: 'text*',
    defining: true,
    selectable: true,
    marks: 'revisionMark',
    attrs: {
      id: { default: '' },
      blockType: { default: 'code' },
      language: { default: '' },
      isEmpty: { default: true },
    },
  },
  latexBlock: {
    group: 'blockContent',
    atom: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'latex' },
      latexSource: { default: '' },
    },
  },
  imageBlock: {
    group: 'blockContent',
    atom: true,
    defining: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'image' },
      src: { default: '' },
      alt: { default: '' },
      title: { default: '' },
      width: { default: null },
      height: { default: null },
      alignment: { default: 'center' },
      uploadedAt: { default: null },
    },
  },
  bibliographyBlock: {
    group: 'block blockContent',
    atom: true,
    defining: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'bibliography' },
      styleId: { default: 'numeric' },
    },
  },
  table: {
    group: 'blockContent',
    content: 'tableRow+',
    isolating: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'table' },
      withHeaderRow: { default: true },
    },
  },
  tableRow: {
    content: '(tableHeader | tableCell)+',
  },
  tableCell: {
    content: 'tableCellContentBlock+',
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
      style: { default: null },
    },
  },
  tableHeader: {
    content: 'tableCellContentBlock+',
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
      style: { default: null },
    },
  },
  tableCellContentBlock: {
    group: 'block',
    content: 'inline*',
    defining: true,
    selectable: true,
    attrs: {
      id: { default: '' },
      blockType: { default: 'tableCellContent' },
    },
  },
  columnReference: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: {
      refKey: { default: '' },
      label: { default: '' },
      color: { default: '#888888' },
    },
  },
};

const marks: Record<string, MarkSpec> = {
  bold: {},
  italic: {},
  strike: {},
  code: {
    excludes: 'bold italic strike textColor textHighlight',
  },
  link: {
    attrs: {
      href: { default: '' },
      title: { default: null },
    },
  },
  revisionMark: {
    attrs: {
      revisionId: { default: null },
      changeType: { default: 'insert' },
      source: { default: 'ai' },
    },
  },
  textColor: {
    attrs: {
      color: { default: null },
    },
  },
  textHighlight: {
    attrs: {
      color: { default: null },
    },
  },
};

export const workspaceMarkdownSchemaLite = new Schema({
  nodes,
  marks,
});

export const workspaceMarkdownSchemaContract = createWorkspaceMarkdownSchemaContract(
  workspaceMarkdownSchemaLite
);

/**
 * 使用轻量 Schema 校验并规范化 doc JSON。
 */
export function validateMarkdownDocJson(docJson: MarkdownDocJson): MarkdownDocJson {
  assertProseMirrorJsonMatchesSchema(docJson, workspaceMarkdownSchemaLite);
  const node = workspaceMarkdownSchemaLite.nodeFromJSON(docJson);
  return node.toJSON() as MarkdownDocJson;
}
