/** Citation 来源的稳定身份锚点；短 ref 只是在 Conversation 中分配给锚点的别名。 */
export type CitationSourceAnchor =
  | {
      readonly sourceType: 'knowledge_base';
      readonly docId: string;
      readonly blockId: string;
    }
  | {
      readonly sourceType: 'web';
      readonly url: string;
    };
