import { tsImport } from 'tsx/esm/api';

// tsx CLI 会再派生进程且不会转发 fd 3；测试 wrapper 必须在当前 Node 进程内加载 TS fixture，
// 才能验证与正式已编译 App Server 相同的 inherited bootstrap pipe。
await tsImport('./appServerControlFixture.ts', import.meta.url);
