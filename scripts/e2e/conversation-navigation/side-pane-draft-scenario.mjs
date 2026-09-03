export async function runSidePaneDraftAssembly(options) {
  const {
    cdp,
    rendererErrors,
    projectId,
    evaluate,
    waitFor,
    clickConversation,
    startNewConversationDraft,
    assertRendererHealthy,
  } = options;

  await clickConversation(cdp, 'E2E 对话 A');

  const openedFilesWorkspace = await evaluate(cdp, `(async () => {
    const { getWorkspaceNavigationPort } = await import(
      '/apps/renderer/shared/ports/workspaceNavigationPort.ts'
    );
    await getWorkspaceNavigationPort().openEmptyProjectFiles(${JSON.stringify(projectId)});
    return true;
  })()`);
  if (!openedFilesWorkspace) throw new Error('右侧对话门禁无法打开工作区文件空态');

  await waitFor(
    () => evaluate(cdp, `(async () => {
      const { useLayoutStore } = await import('/apps/renderer/app/layout/store/layoutStore.ts');
      const state = useLayoutStore().state;
      return state.layoutMode === 'chat-centric'
        && state.activeDocument === null
        && state.documentPane.emptyStateVisible === true
        && Boolean(document.querySelector('.workspace-stage__chat .conversation-chat-host'));
    })()`),
    '会话主区与右侧文件空态完成装配',
  );

  await evaluate(cdp, `(async () => {
    const { getWorkspaceNavigationPort } = await import(
      '/apps/renderer/shared/ports/workspaceNavigationPort.ts'
    );
    getWorkspaceNavigationPort().toggleWorkspacePanePlacement();
    return true;
  })()`);
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector(
      '.conversation-side-pane .workspace-conversation-surface[data-workspace-conversation-presentation="side-pane"] .conversation-chat-host'
    ))`),
    '会话切换到右侧统一 Surface',
  );

  await startNewConversationDraft(cdp);
  const sidePaneDraft = await evaluate(cdp, `(() => {
    const sidePane = document.querySelector('.conversation-side-pane');
    return {
      hasCompactSurface: Boolean(sidePane?.querySelector('.conversation-chat-surface--compact')),
      hasEmptyState: Boolean(sidePane?.querySelector(
        '.conversation-chat-footer-empty-layout .conversation-empty-state'
      )),
      hasBottomComposer: Boolean(sidePane?.querySelector(
        '.conversation-chat-footer-empty-footer .ai-assistant-input'
      )),
      hasRegularComposer: Boolean(sidePane?.querySelector(
        '.conversation-chat-footer-empty-footer .ai-assistant-input--regular'
      )),
      hasRegularInputControls: Boolean(sidePane?.querySelector(
        '.conversation-chat-footer-empty-footer .input-bottom-section--regular'
      )),
      hasCompactInputControls: Boolean(sidePane?.querySelector(
        '.conversation-chat-footer-empty-footer .input-bottom-section--compact'
      )),
      composerCount: sidePane?.querySelectorAll('.ai-assistant-input').length ?? 0,
      hostCount: sidePane?.querySelectorAll('.conversation-host').length ?? 0,
      globalComposerCount: document.querySelectorAll('.ai-assistant-input').length,
    };
  })()`);
  if (
    sidePaneDraft?.hasCompactSurface
    || !sidePaneDraft?.hasEmptyState
    || !sidePaneDraft.hasBottomComposer
    || !sidePaneDraft.hasRegularComposer
    || !sidePaneDraft.hasRegularInputControls
    || sidePaneDraft.hasCompactInputControls
    || sidePaneDraft.composerCount !== 1
    || sidePaneDraft.hostCount !== 0
    || sidePaneDraft.globalComposerCount !== 1
  ) {
    throw new Error(`右侧新对话没有保持统一输入框规格和唯一 footer 空态: ${JSON.stringify(sidePaneDraft)}`);
  }

  const draftText = '右侧草稿切换后仍然存在';
  const focusedComposer = await evaluate(cdp, `(() => {
    const editor = document.querySelector(
      '.conversation-side-pane .ai-assistant-tiptap-editor[contenteditable="true"]'
    );
    if (!(editor instanceof HTMLElement)) return false;
    editor.focus();
    return document.activeElement === editor;
  })()`);
  if (!focusedComposer) throw new Error('右侧草稿输入框无法获得焦点');
  await cdp.send('Input.insertText', { text: draftText });
  await waitFor(
    () => evaluate(cdp, `document.querySelector(
      '.conversation-side-pane .ai-assistant-tiptap-editor'
    )?.textContent?.includes(${JSON.stringify(draftText)}) === true`),
    '右侧草稿文字进入编辑器',
  );

  await evaluate(cdp, `(async () => {
    const { getWorkspaceNavigationPort } = await import(
      '/apps/renderer/shared/ports/workspaceNavigationPort.ts'
    );
    getWorkspaceNavigationPort().toggleWorkspacePanePlacement();
    return true;
  })()`);
  await waitFor(
    () => evaluate(cdp, `(() => {
      const home = document.querySelector(
        '.workspace-stage__chat .workspace-conversation-surface[data-workspace-conversation-presentation="home"]'
      );
      return Boolean(home?.querySelector('.empty-state-layout'))
        && home?.querySelectorAll('.ai-assistant-input').length === 1
        && home.querySelector('.ai-assistant-tiptap-editor')?.textContent
          ?.includes(${JSON.stringify(draftText)}) === true;
    })()`),
    '草稿从右侧恢复到主区首页',
  );

  await evaluate(cdp, `(async () => {
    const { getWorkspaceNavigationPort } = await import(
      '/apps/renderer/shared/ports/workspaceNavigationPort.ts'
    );
    getWorkspaceNavigationPort().toggleWorkspacePanePlacement();
    return true;
  })()`);
  await waitFor(
    () => evaluate(cdp, `(() => {
      const sidePane = document.querySelector(
        '.conversation-side-pane .workspace-conversation-surface[data-workspace-conversation-presentation="side-pane"]'
      );
      return Boolean(sidePane?.querySelector(
        '.conversation-chat-footer-empty-layout .conversation-empty-state'
      ))
        && sidePane?.querySelectorAll('.ai-assistant-input').length === 1
        && Boolean(sidePane.querySelector(
          '.conversation-chat-footer-empty-footer .ai-assistant-input--regular'
        ))
        && Boolean(sidePane.querySelector('.input-bottom-section--regular'))
        && !sidePane.querySelector('.input-bottom-section--compact')
        && sidePane.querySelector('.ai-assistant-tiptap-editor')?.textContent
          ?.includes(${JSON.stringify(draftText)}) === true;
    })()`),
    '草稿从主区恢复到右侧首页',
  );

  await clickConversation(cdp, 'E2E 对话 B');
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector(
      '.conversation-side-pane .workspace-conversation-surface[data-workspace-conversation-presentation="side-pane"] .conversation-chat-host'
    )) && !document.querySelector('.conversation-side-pane .conversation-chat-footer-empty-layout')`),
    '右侧从草稿原子切回历史 Host',
  );
  await assertRendererHealthy(cdp, rendererErrors, '右侧 Surface 草稿与历史切换后');
}
