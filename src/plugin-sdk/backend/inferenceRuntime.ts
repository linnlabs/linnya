export type * from '@linnya/plugin-host-contract/backend/inferenceRuntime';
/** 只返回执行能力；不透传目录、路由、凭据存储或 Provider SDK。 */
export { createPluginInferencePort as getPluginInferencePort } from 'src/app-hosts/linnya/adapters/inference';
