
import type { Editor } from '@tiptap/core';
import type { Component } from 'vue';

export interface ToolbarButton {
  readonly id: string;
  readonly component: Component;
  readonly props?: Readonly<Record<string, unknown>>;
}

export interface ToolbarItemGroup {
  readonly id: string;
  readonly items: readonly ToolbarButton[];
}

export interface ToolbarContext {
  readonly editor: Editor;
}

export interface ToolbarProvider {
  readonly name: string;
  weight?: number;
  readonly shouldShow?: (context: ToolbarContext) => boolean;
  readonly getItems: (context: ToolbarContext) => readonly (ToolbarButton | ToolbarItemGroup)[];
  readonly override?: boolean;
}
