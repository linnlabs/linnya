// 本入口同时被 Electron Main 与 App Server 引用，只能转出两端共用的传输与注册表合同。
// 业务 handler 的注册会带入整个 Backend 模块图，单独放在 ./app-server，Main 不得引用。
export * from './definitions/backendRendererRequest';
export * from './definitions/backendRendererRequestRpc';
export * from './functions/backendRendererRequestMailbox';
export * from './functions/backendRendererRequestRpcCodec';
export * from './functions/backendRendererRequestValueCodec';
export * from './orchestration/createBackendRendererRequestRegistry';
export * from './orchestration/createBackendRendererIpcStyleRegistrar';
export * from './orchestration/createBackendRendererRequestRpcGateway';
export * from './orchestration/createBackendRendererRequestRpcHandlers';
