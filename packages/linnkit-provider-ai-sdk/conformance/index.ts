/** 测试专用出口。生产代码禁止导入。 */
export { PROVIDER_CONFORMANCE_SUITE_VERSION } from './definitions/providerConformanceSelection';
export {
  route as createDedicatedProviderConformanceRoute,
  runToolRoundTrip,
  type CapturedRequest,
  type DedicatedProviderRoute,
} from './fixtures/dedicatedProviderCodecFixture';
export { projectCanonicalMessages } from '../src/functions/projectCanonicalMessages';
