import type { Component } from 'vue';
export interface DocumentTypePresentationPort {
  readIcon(nodeType: string): Component;
  readRecoveryAction(
    nodeType: string
  ): { readonly label: string; activate(): Promise<void> } | null;
}
