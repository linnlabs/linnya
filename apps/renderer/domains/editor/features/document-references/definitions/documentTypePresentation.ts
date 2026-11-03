import type { Component } from 'vue';
export interface DocumentTypePresentationPort {
  readIcon(nodeType: string): Component;
  readPreviewComponent(nodeType: string): Component | null;
  readRecoveryAction(
    nodeType: string
  ): { readonly label: string; activate(): Promise<void> } | null;
}
