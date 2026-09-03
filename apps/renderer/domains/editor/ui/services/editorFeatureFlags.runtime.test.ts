import { afterEach, describe, expect, it } from 'vitest'
import {
  resetEditorShellRuntimeForOwner,
  setFlag,
  setLargeDocumentShellMode,
  setLargeDocumentShellModeForOwner,
  setVirtualRootBlockRenderingActive,
  setVirtualRootBlockRenderingActiveForOwner,
  shouldUseRootBlockShellForOwner,
  shouldUseVirtualRootBlockRenderingForOwner,
} from './editorFeatureFlags'

function resetFlags(): void {
  setFlag('rootBlockShellEnabled', false)
  setFlag('virtualRootBlockRendering', true)
  setLargeDocumentShellMode(false)
  setVirtualRootBlockRenderingActive(false)
}

describe('editorFeatureFlags editor-scoped runtime', () => {
  afterEach(() => {
    resetFlags()
  })

  it('keeps virtual rootBlock rendering active state isolated per owner', () => {
    const editorA = {}
    const editorB = {}

    setVirtualRootBlockRenderingActive(true)
    expect(shouldUseVirtualRootBlockRenderingForOwner(editorA)).toBe(false)

    setVirtualRootBlockRenderingActiveForOwner(editorA, true)
    setVirtualRootBlockRenderingActiveForOwner(editorB, false)

    expect(shouldUseVirtualRootBlockRenderingForOwner(editorA)).toBe(true)
    expect(shouldUseVirtualRootBlockRenderingForOwner(editorB)).toBe(false)
  })

  it('keeps large document shell runtime isolated per owner', () => {
    const editorA = {}
    const editorB = {}

    setLargeDocumentShellMode(true)
    expect(shouldUseRootBlockShellForOwner(editorA)).toBe(false)

    setLargeDocumentShellModeForOwner(editorA, true)
    setLargeDocumentShellModeForOwner(editorB, false)

    expect(shouldUseRootBlockShellForOwner(editorA)).toBe(true)
    expect(shouldUseRootBlockShellForOwner(editorB)).toBe(false)
  })

  it('still gates owner runtime by the global capability flag', () => {
    const editor = {}

    setVirtualRootBlockRenderingActiveForOwner(editor, true)
    expect(shouldUseVirtualRootBlockRenderingForOwner(editor)).toBe(true)

    setFlag('virtualRootBlockRendering', false)

    expect(shouldUseVirtualRootBlockRenderingForOwner(editor)).toBe(false)
  })

  it('resets only the selected owner runtime', () => {
    const editorA = {}
    const editorB = {}

    setVirtualRootBlockRenderingActiveForOwner(editorA, true)
    setVirtualRootBlockRenderingActiveForOwner(editorB, true)
    setLargeDocumentShellModeForOwner(editorA, true)
    setLargeDocumentShellModeForOwner(editorB, true)

    resetEditorShellRuntimeForOwner(editorA)

    expect(shouldUseVirtualRootBlockRenderingForOwner(editorA)).toBe(false)
    expect(shouldUseRootBlockShellForOwner(editorA)).toBe(false)
    expect(shouldUseVirtualRootBlockRenderingForOwner(editorB)).toBe(true)
    expect(shouldUseRootBlockShellForOwner(editorB)).toBe(true)
  })
})
