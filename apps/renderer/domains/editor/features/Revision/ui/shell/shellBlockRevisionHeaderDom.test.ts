// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { EditorMessageResolver } from '../../../../definitions/editorMessages'
import {
  ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR,
  ROOT_BLOCK_SHELL_REVISION_HEADER_ATTR,
  clearShellRevisionHeader,
  renderShellRevisionHeader,
  type ShellRevisionHeaderSession,
} from './shellBlockRevisionHeaderDom'
import type { CanonicalPendingSession } from '../../store/types'

const testMessage: EditorMessageResolver = (key) => {
  const messages: Partial<Record<Parameters<EditorMessageResolver>[0], string>> = {
    'editor.revision.indicator.label': 'Revision',
    'editor.revision.indicator.pending': 'Pending',
    'editor.revision.indicator.statsSeparator': ', ',
    'editor.revision.indicator.pendingTitle': 'Pending revisions',
    'editor.revision.indicator.pendingTitleWithStats': 'Pending revisions: {stats}',
    'editor.revision.indicator.pendingTitleDeferred': 'Pending revisions: detailed diff not projected yet',
    'editor.revision.indicator.appliedTitle': 'Accepted revisions: {stats}',
    'editor.revision.indicator.discardedTitle': 'Rejected revisions: {stats}',
    'editor.revision.indicator.insertStat': '{count} additions',
    'editor.revision.indicator.deleteStat': '{count} deletions',
    'editor.revision.time.yesterday': 'Yesterday',
  }

  return messages[key] ?? key
}

const renderOptions = {
  locale: 'en-US' as const,
  editorMessage: testMessage,
}

function createShellOuter(blockId: string): HTMLElement {
  const outer = document.createElement('div')
  outer.className = 'root-block-outer'
  outer.dataset.id = blockId

  const header = document.createElement('div')
  header.hidden = true
  header.setAttribute(ROOT_BLOCK_SHELL_REVISION_HEADER_ATTR, 'true')
  outer.append(header)

  return outer
}

function createSession(
  blockId: string,
  diffStats?: CanonicalPendingSession['diffStats']
): CanonicalPendingSession {
  return {
    pendingId: `pending-${blockId}`,
    blockId,
    operation: 'update',
    revisionId: `ai-${blockId}`,
    createdAt: 1_700_000_000_000,
    diffStats,
  }
}

describe('shellBlockRevisionHeaderDom', () => {
  it('renders canonical-only pending as an in-flow shell header', () => {
    const outer = createShellOuter('block-a')

    expect(renderShellRevisionHeader(outer, createSession('block-a'), renderOptions)).toBe(true)

    const header = outer.firstElementChild as HTMLElement
    expect(header.hidden).toBe(false)
    expect(outer.getAttribute(ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR)).toBe('true')
    expect(header.textContent).toContain('Revision')
    expect(header.textContent).toContain('Pending')
  })

  it('renders diff stats and can clear the header without removing the slot', () => {
    const outer = createShellOuter('block-b')
    const session = createSession('block-b', { insertCount: 3, deleteCount: 2 })

    renderShellRevisionHeader(outer, session, renderOptions)
    const header = outer.firstElementChild as HTMLElement
    expect(header.textContent).toContain('+3')
    expect(header.textContent).toContain('-2')

    expect(clearShellRevisionHeader(outer)).toBe(true)
    expect(header.hidden).toBe(true)
    expect(header.childElementCount).toBe(0)
    expect(outer.hasAttribute(ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR)).toBe(false)
  })

  it('keeps the same shell header contract after pending is projected to active revision', () => {
    const outer = createShellOuter('block-c')
    const canonicalOnly = createSession('block-c')
    const activeProjection: ShellRevisionHeaderSession = {
      blockId: 'block-c',
      createdAt: canonicalOnly.createdAt,
      diffStats: { insertCount: 4, deleteCount: 1 },
    }

    renderShellRevisionHeader(outer, canonicalOnly, renderOptions)
    expect(outer.textContent).toContain('Pending')

    expect(renderShellRevisionHeader(outer, activeProjection, renderOptions)).toBe(true)
    expect(outer.textContent).toContain('+4')
    expect(outer.textContent).toContain('-1')
    expect(outer.textContent).not.toContain('Pending')
    expect(outer.getAttribute(ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR)).toBe('true')
  })
})
