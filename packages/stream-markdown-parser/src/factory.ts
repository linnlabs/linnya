import type { MathOptions } from './config'
import MarkdownIt from 'markdown-it-ts'
import { getDefaultMathOptions } from './config'
import { applyContainers } from './plugins/containers'
import { applyFixHtmlInlineTokens } from './plugins/fixHtmlInline'
import { applyFixLinkTokens } from './plugins/fixLinkTokens'
import { applyFixListItem } from './plugins/fixListItem'
import { applyFixStrongTokens } from './plugins/fixStrongTokens'
import { applyFixTableTokens } from './plugins/fixTableTokens'
import { applyMath } from './plugins/math'
import { applyRenderRules } from './renderers'

export interface FactoryOptions extends Record<string, unknown> {
  markdownItOptions?: Record<string, unknown>
  /**
   * 允许产品层显式接纳的自定义链接协议；默认仍沿用 markdown-it 的安全校验。
   * 这里只决定是否产出 link AST，具体 locator 合法性仍由调用方自己的 owner 校验。
   */
  allowedLinkProtocols?: readonly string[]
  enableMath?: boolean
  enableContainers?: boolean
  mathOptions?: { commands?: string[], escapeExclamation?: boolean }
  /**
   * Custom HTML-like tag names that should participate in streaming mid-state
   * suppression and be emitted as custom nodes (e.g. ['thinking']).
   */
  customHtmlTags?: readonly string[]
}

export function factory(opts: FactoryOptions = {}) {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    stream: true,
    ...(opts.markdownItOptions ?? {}),
  })

  const allowedLinkProtocols = new Set(
    (opts.allowedLinkProtocols ?? [])
      .map(protocol => protocol.trim().toLowerCase().replace(/:$/, ''))
      .filter(Boolean),
  )
  if (allowedLinkProtocols.size > 0) {
    const validateLink = md.validateLink.bind(md)
    md.validateLink = (url: string) => {
      const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
      return (protocol !== undefined && allowedLinkProtocols.has(protocol)) || validateLink(url)
    }
  }

  if (opts.enableMath ?? true) {
    const mergedMathOptions: MathOptions = { ...(getDefaultMathOptions() ?? {}), ...(opts.mathOptions ?? {}) }
    applyMath(md, mergedMathOptions)
  }
  if (opts.enableContainers ?? true)
    applyContainers(md)
  // Retain the core-stage fix as a fallback for any cases the inline
  // tokenizer does not handle.
  applyFixLinkTokens(md)
  // Also apply strong-token normalization at the same stage.
  applyFixStrongTokens(md)
  // Apply list-item inline normalization as well.
  applyFixListItem(md)
  // Apply table token normalization at block stage.
  applyFixTableTokens(md)
  applyRenderRules(md)
  applyFixHtmlInlineTokens(md, {
    customHtmlTags: opts.customHtmlTags,
  })

  return md
}
