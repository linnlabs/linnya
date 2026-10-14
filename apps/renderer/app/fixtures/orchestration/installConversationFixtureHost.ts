const conversationFixtureId = import.meta.env.DEV
  ? new window.URLSearchParams(window.location.search).get('fixture')
  : null;

// fixture host 必须先于 main.js 的静态依赖求值，避免 Electron-only gateway 在浏览器验收页提前实例化。
if (conversationFixtureId === 'conversation-image-attachments') {
  const { installConversationImageAttachmentFixtureHost } = await import(
    './installConversationImageAttachmentFixtureHost'
  );
  installConversationImageAttachmentFixtureHost();
}

// 此页面只消费真实通知组件与内存控制快照，不接入 Electron 或真实模型。
if (conversationFixtureId === 'conversation-execution-notice') {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      onApiPortSet: () => () => undefined,
      invoke: async (channel: string) => {
        throw new Error(`Execution notice fixture has no backend channel: ${channel}`);
      },
    },
  });
}
