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
