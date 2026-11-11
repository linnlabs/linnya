import { PluginKey } from 'prosemirror-state';

// 扩展与流式队列必须使用同一个 key 实例，不能各自重建。
export const STREAMING_PLUGIN_KEY = new PluginKey('streamingMarkdown');
