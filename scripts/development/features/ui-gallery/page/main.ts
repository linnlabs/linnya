import { createApp } from 'vue';
import { SHARED_COMPONENT_LOCALIZATION_PORT_KEY } from '@linnya/renderer-ui/localization';
import { interpolateMessage } from '../../../../../apps/renderer/app/localization/functions/interpolateMessage.ts';
// 与 Desktop 完全相同的样式装载顺序：Host reset → Renderer UI 全量样式 → 应用 token → 全局样式。
import '../../../../../apps/renderer/app/styles/index.css';
import './gallery.css';
import GalleryApp from './GalleryApp.vue';

const app = createApp(GalleryApp);
// 组件自带的中文默认文案就是 zh-CN 目录；像 Host 一样代入参数（如字数统计的 {count}），
// 不接入 Host 的语言 store。
app.provide(SHARED_COMPONENT_LOCALIZATION_PORT_KEY, {
  message: (_key, fallback, params) => interpolateMessage(fallback, params),
});
app.mount('#app');
