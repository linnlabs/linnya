import type { Component } from 'vue';
export interface ConversationReferenceChipPresentation {
  readonly label: string;
  readonly preview: string;
  readonly previewComponent?: Component;
  readonly hoverPreview?: false;
  readonly activate?: () => Promise<void>;
}
