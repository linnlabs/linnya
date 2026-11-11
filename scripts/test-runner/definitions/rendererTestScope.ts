/** Renderer gate 的发现范围；跨层 parity 使用根配置，不能污染生产 Renderer resolver。 */
export const RENDERER_TEST_INCLUDE = [
  'apps/renderer/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
  'packages/renderer-ui/**/*.{test,spec}.{ts,tsx}',
  'packages/plugins/mindmap/src/renderer/**/*.{test,spec}.{ts,tsx}',
  'packages/plugins/slides/src/renderer/**/*.{test,spec}.{ts,tsx}',
  'scripts/build/renderer-module-resolution/**/*.{test,spec}.ts',
];

// 这些测试使用真实 Host schema / normalization / plugin manifest，验证跨进程合同。
// 新增跨层场景在此登记；普通 UI 测试不能借用 Host resolver。
export const RENDERER_HOST_INTEGRATION_TESTS = [
  // 文档引用 Pending 夹具使用真实 Host Markdown parser，与其他 Revision 跨层测试同一 resolver。
  'apps/renderer/domains/editor/features/Revision/utils/pending/__test__/documentReferencePending.test.ts',
  // Conversation durable/live parity 直接读取 App Host 的正式投影。
  'apps/renderer/domains/conversation/services/messageProjection/__tests__/executionNoticeLifecycle.integration.test.ts',
  'apps/renderer/domains/conversation/services/messageProjection/__tests__/uiProjectionParity.spec.ts',
  'apps/renderer/domains/conversation/services/messageProjection/__tests__/errorProjection.test.ts',
  'apps/renderer/domains/conversation/services/messageProjection/__tests__/uiProjectionParityCoverage.test.ts',
  'apps/renderer/domains/conversation/features/research-run-presentation/researchDocumentSubmission.integration.test.ts',
  'apps/renderer/domains/conversation/features/research-run-presentation/researchRunPresentation.integration.test.ts',
  'apps/renderer/domains/conversation/features/research-run-presentation/researchCompletion.integration.test.ts',

  'apps/renderer/shared/utils/markdownSerializer.test.ts',
  'apps/renderer/app/plugins/builtin/platform.renderer.test.ts',
  'apps/renderer/domains/editor/core/extensionRegistry.conformance.test.ts',
  'apps/renderer/domains/editor/blocks/ChartBlock/orchestration/useChartRevisionView.test.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/chart/__test__/chartPendingRevisionApplier.test.ts',
  'apps/renderer/domains/editor/services/editorService.integration.test.ts',
  'apps/renderer/domains/editor/features/Annotation/useAnnotationStore.test.js',
  'apps/renderer/domains/editor/extensions/clipboard/PlainTextMarkdownHandler.spec.ts',
  'apps/renderer/domains/editor/services/markdownRuntime/inlineProjection.spec.ts',
  'apps/renderer/domains/editor/services/markdownRuntime/materializer.spec.ts',
  'apps/renderer/domains/editor/blocks/ChartBlock/functions/chartBlockTransactions.test.ts',
  'apps/renderer/domains/editor/blocks/ChartBlock/functions/collectRemovedChartBlockIds.test.ts',
  'apps/renderer/domains/editor/features/Annotation/functions/annotationDocumentState.test.ts',
  'apps/renderer/domains/editor/features/FindReplace/plugin/findReplacePlugin.test.js',
  'apps/renderer/domains/editor/features/Revision/utils/diffApplier.spec.ts',
  'apps/renderer/domains/editor/features/citation/__tests__/bibliographyAutoMaintain.spec.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/__test__/citationHydrationHelper.spec.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/__test__/pendingExecutionPlan.spec.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/__test__/pendingRevisionHelpers.spec.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/__test__/pendingTableBlockApplier.spec.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/__test__/updatePendingRevisionApplier.spec.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/chart/__test__/chartPendingPlan.test.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/chart/__test__/chartPendingProjection.test.ts',
  'packages/plugins/mindmap/src/renderer/__tests__/rendererContract.test.ts',
  'packages/plugins/slides/src/renderer/__tests__/rendererContract.test.ts',
  'apps/renderer/domains/editor/features/document-session/__tests__/markdownDocumentSession.test.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/__test__/horizontalRulePendingRevision.test.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/__test__/imagePendingRevision.test.ts',
  'apps/renderer/domains/editor/features/Revision/utils/pending/__test__/latexPendingRevision.test.ts',
];
