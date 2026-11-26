// 只供 App Server 进程引用：这里会带入数据库、插件与各业务 handler 的完整模块图。
// 不并入 ./index，否则 Electron Main 取传输合同时会把整个 Backend 打进主进程包。
export * from './orchestration/registerCoreBackendRendererRequestHandlers';
