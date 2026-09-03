import { Node, mergeAttributes } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { Plugin } from '@tiptap/pm/state'
import type { CitationNodeAttrs } from '../types'
import { projectCitationNodeToPortableText } from '../functions/citationNodeProjection'
import { remapPastedCitationIdentities } from '../functions/remapPastedCitationIdentities'
import CitationInlineView from '../ui/components/CitationInlineView.vue'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (
        attrs: Omit<CitationNodeAttrs, 'citationId'> & { citationId?: string }
      ) => ReturnType
      updateCitation: (attrs: Partial<CitationNodeAttrs>) => ReturnType
      removeCitation: () => ReturnType
    }
  }
}

function generateCitationId(): string {
  return crypto.randomUUID()
}

function readStringAttribute(attributes: Record<string, unknown>, key: string): string {
  const value = attributes[key]
  return typeof value === 'string' ? value : ''
}

function optionalStringAttribute(attributeName: string, schemaAttributeName?: string) {
  const propertyName =
    schemaAttributeName ??
    attributeName
      .replace(/^data-/, '')
      .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute(attributeName) || null,
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[propertyName]
      return typeof value === 'string' && value.length > 0 ? { [attributeName]: value } : {}
    },
  }
}

export const CitationNode = Node.create({
  name: 'citationNode',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  marks: '_',

  addAttributes() {
    return {
      citationId: {
        // Citation identity 必须由创建/接纳边界显式给出；Schema 默认值不能偷偷制造新事实。
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-citation-id'),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-citation-id': readStringAttribute(attributes, 'citationId'),
        }),
      },
      ref: optionalStringAttribute('data-citation-ref', 'ref'),
      sourceType: {
        default: 'manual',
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-source-type')
          return value === 'knowledge_base' || value === 'web' || value === 'manual'
            ? value
            : 'manual'
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-source-type': readStringAttribute(attributes, 'sourceType'),
        }),
      },
      sourceId: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-source-id') || '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-source-id': readStringAttribute(attributes, 'sourceId'),
        }),
      },
      kbId: optionalStringAttribute('data-kb-id'),
      blockId: optionalStringAttribute('data-block-id'),
      title: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-title') || '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-title': readStringAttribute(attributes, 'title'),
        }),
      },
      snippet: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-snippet') || '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-snippet': readStringAttribute(attributes, 'snippet'),
        }),
      },
      snippets: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-snippets')
          if (!raw) return null
          try {
            const parsed: unknown = JSON.parse(raw)
            return Array.isArray(parsed)
              ? parsed.filter((item): item is string => typeof item === 'string')
              : null
          } catch {
            return null
          }
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const items = Array.isArray(attributes.snippets)
            ? attributes.snippets.filter(
                (item): item is string => typeof item === 'string' && item.trim().length > 0
              )
            : []
          return items.length > 0 ? { 'data-snippets': JSON.stringify(items) } : {}
        },
      },
      authors: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-authors')
          if (!raw) return null
          try {
            const parsed: unknown = JSON.parse(raw)
            return Array.isArray(parsed)
              ? parsed.filter((item): item is string => typeof item === 'string')
              : null
          } catch {
            return null
          }
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          Array.isArray(attributes.authors) && attributes.authors.length > 0
            ? { 'data-authors': JSON.stringify(attributes.authors) }
            : {},
      },
      date: optionalStringAttribute('data-date'),
      url: optionalStringAttribute('data-url'),
      containerTitle: optionalStringAttribute('data-container-title'),
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="citation"][data-citation-id]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ class: 'citation-mark', 'data-type': 'citation' }, HTMLAttributes),
      projectCitationNodeToPortableText(node.attrs),
    ]
  },

  addNodeView() {
    return VueNodeViewRenderer(CitationInlineView)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPasted(slice) {
            return remapPastedCitationIdentities(slice)
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      insertCitation:
        (attrs: Omit<CitationNodeAttrs, 'citationId'> & { citationId?: string }) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            type: this.name,
            attrs: { ...attrs, citationId: attrs.citationId || generateCitationId() },
          }),
      updateCitation:
        (attrs: Partial<CitationNodeAttrs>) =>
        ({ commands }: CommandProps) =>
          commands.updateAttributes(this.name, attrs),
      removeCitation:
        () =>
        ({ commands }: CommandProps) =>
          commands.deleteSelection(),
    }
  },
})

export default CitationNode
