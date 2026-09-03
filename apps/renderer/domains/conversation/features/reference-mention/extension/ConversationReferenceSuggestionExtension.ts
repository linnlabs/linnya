import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { VueRenderer } from '@tiptap/vue-3';
import tippy from 'tippy.js';
import type { Instance as TippyInstance } from 'tippy.js';
import type { ConversationReferenceSuggestionItem } from '../definitions/conversationReferenceSuggestion';
import ConversationReferenceSuggestionView from '../ui/ConversationReferenceSuggestionView.vue';

const referenceSuggestionPluginKey = new PluginKey('conversationReferenceSuggestion');

export interface ConversationReferenceSuggestionExtensionOptions {
  readonly canStart: () => boolean;
  readonly query: (keyword: string) => Promise<ConversationReferenceSuggestionItem[]>;
  readonly select: (item: ConversationReferenceSuggestionItem) => void;
  readonly onOpenChange: (isOpen: boolean) => void;
}

function invokeViewKeyDown(renderer: VueRenderer | null, props: SuggestionKeyDownProps): boolean {
  const viewRef: unknown = renderer?.ref;
  if (!viewRef || typeof viewRef !== 'object' || !('onKeyDown' in viewRef)) return false;
  const onKeyDown = viewRef.onKeyDown;
  return typeof onKeyDown === 'function'
    ? onKeyDown.call(viewRef, props) === true
    : false;
}

function createSuggestionRenderer(
  onOpenChange: (isOpen: boolean) => void,
) {
  return () => {
    let component: VueRenderer | null = null;
    let popup: TippyInstance | null = null;
    let dismissed = false;

    return {
      onBeforeStart(): void {
        dismissed = false;
        onOpenChange(true);
      },
      onStart(props: SuggestionProps<ConversationReferenceSuggestionItem>): void {
        component = new VueRenderer(ConversationReferenceSuggestionView, {
          props,
          editor: props.editor,
        });

        const content = component.element;
        const initialRect = props.clientRect?.();
        if (!content || !initialRect) {
          dismissed = true;
          onOpenChange(false);
          return;
        }

        popup = tippy(document.body, {
          getReferenceClientRect: () => props.clientRect?.() ?? initialRect,
          appendTo: () => document.body,
          content,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          duration: 140,
          arrow: false,
          onClickOutside(instance): void {
            instance.hide();
          },
          onHide(): void {
            dismissed = true;
            onOpenChange(false);
          },
        });
      },
      onUpdate(props: SuggestionProps<ConversationReferenceSuggestionItem>): void {
        component?.updateProps(props);
        if (dismissed) return;

        const currentRect = props.clientRect?.();
        if (!currentRect) return;
        popup?.setProps({
          getReferenceClientRect: () => props.clientRect?.() ?? currentRect,
        });
      },
      onKeyDown(props: SuggestionKeyDownProps): boolean {
        if (props.event.key === 'Escape') {
          dismissed = true;
          popup?.hide();
          onOpenChange(false);
          return true;
        }
        if (dismissed) return false;
        if (!component && props.event.key === 'Enter') return true;
        return invokeViewKeyDown(component, props);
      },
      onExit(): void {
        popup?.destroy();
        component?.destroy();
        popup = null;
        component = null;
        dismissed = false;
        onOpenChange(false);
      },
    };
  };
}

export function createConversationReferenceSuggestionExtension(
  options: ConversationReferenceSuggestionExtensionOptions,
) {
  return Extension.create({
    name: 'conversationReferenceSuggestion',

    addProseMirrorPlugins() {
      let latestQueryId = 0;
      let latestItems: ConversationReferenceSuggestionItem[] = [];

      return [Suggestion<ConversationReferenceSuggestionItem>({
        editor: this.editor,
        pluginKey: referenceSuggestionPluginKey,
        char: '@',
        startOfLine: false,
        allowSpaces: false,
        allowedPrefixes: null,
        allow: () => options.canStart(),
        items: async ({ query }) => {
          const queryId = latestQueryId + 1;
          latestQueryId = queryId;
          try {
            const items = await options.query(query);
            if (queryId === latestQueryId) latestItems = items;
            return latestItems;
          } catch (error: unknown) {
            console.error('[conversationReferenceSuggestion] 候选查询失败', {
              keyword: query,
              error: error instanceof Error ? error.message : String(error),
            });
            if (queryId === latestQueryId) latestItems = [];
            return latestItems;
          }
        },
        render: createSuggestionRenderer(options.onOpenChange),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          options.select(props);
        },
      })];
    },
  });
}
