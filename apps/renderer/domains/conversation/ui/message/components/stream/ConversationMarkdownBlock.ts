import {
  Fragment,
  defineComponent,
  h,
  type PropType,
} from 'vue';
import type { ConversationCitationDependencySnapshot } from '@app/schemas';
import type { ParsedNode } from 'stream-markdown-parser';

export type ConversationMarkdownVNodeChild =
  ReturnType<typeof h> | string | null | ConversationMarkdownVNodeChild[];

export interface ConversationMarkdownRenderContext {
  readonly isStreaming: boolean;
  readonly parseMarkdown: (content: string) => ParsedNode[];
  /** 对话轮次 ID（供引用 transfer DOM 标注归属）。 */
  readonly turnId?: string;
  readonly citationDependencies?: ConversationCitationDependencySnapshot;
  readonly citationDisplayState: {
    readonly map: Map<string, number>;
    next: number;
  };
}

export type ConversationMarkdownNodeRenderer = (
  node: ParsedNode,
  context: ConversationMarkdownRenderContext,
) => ConversationMarkdownVNodeChild;

/**
 * 顶层 Markdown block 的稳定组件边界。
 *
 * 父级复用已封口 AST 节点的对象 identity 后，Vue 会跳过 props 未变化的 block，
 * 不再让每个流式 chunk 都递归 patch 已完成的整棵 Markdown 子树。
 */
export default defineComponent({
  name: 'ConversationMarkdownBlock',
  props: {
    node: { type: Object as PropType<ParsedNode>, required: true },
    isStreaming: { type: Boolean, required: true },
    parseMarkdown: {
      type: Function as PropType<(content: string) => ParsedNode[]>,
      required: true,
    },
    renderNode: {
      type: Function as PropType<ConversationMarkdownNodeRenderer>,
      required: true,
    },
    turnId: { type: String, default: undefined },
    citationDependencies: {
      type: Object as PropType<ConversationCitationDependencySnapshot>,
      default: undefined,
    },
    citationDisplayState: {
      type: Object as PropType<ConversationMarkdownRenderContext['citationDisplayState']>,
      required: true,
    },
  },
  setup(props) {
    return () => h(Fragment, null, [props.renderNode(props.node, {
      isStreaming: props.isStreaming,
      parseMarkdown: props.parseMarkdown,
      turnId: props.turnId,
      citationDependencies: props.citationDependencies,
      citationDisplayState: props.citationDisplayState,
    })]);
  },
});
