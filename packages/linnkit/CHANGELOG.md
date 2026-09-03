# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note**: linnkit is in `0.x` — minor versions may introduce new public exports
> but patch versions should remain compatible.
>
> Versions before 0.5.0 were internal alpha and are summarized only at a high level here.

---

## [Unreleased]

## [0.31.1] - 2026-09-03

### Fixed

- Fixed `ToolContext` runtime capability identity across the package root, `runtime-kernel`, and `testkit` bundles. ESM and CommonJS consumers can now admit a context through one public entry and read or derive it through another without creating isolated hidden-binding registries.

## [0.31.0] - 2026-09-03

### Added

- Added ordered durable attachment refs to successful child `tool_output` parent-trace projections. Runtime→SSE mapping preserves the refs for Host compact history and full Subrun UI admission without copying resource bytes or exposing them to the parent Agent context.
- Added explicit tool model-input delivery semantics. `required` remains the default, while `when_supported` keeps the main tool operation available to incompatible models and exposes the active-model admission decision through `ToolExecutionContext.modelInputAdmission` before tools create temporary attachment grants.
- Added the ephemeral `context_usage_snapshot` Runtime/SSE contract. `LlmNode` publishes one snapshot through the existing RuntimeEventSink after every successful Provider attempt, while final durable recovery remains owned by `run_execution_metrics.context_usage`.
- Added unified automatic context compaction. `contextPolicy.compaction` resolves the trigger/target ratios, retained tool groups, summary output cap, and per-run commit limit; Context Manager exposes pure plan/validate/rebuild contracts while Graph owns the internal current-model call, remeasurement, admission, and `history_summary` commit.
- Added typed `llm.context.compaction_failed` / `llm.context.compaction_insufficient` errors, `context_compaction` telemetry (including Provider-attempt index and raw compression ratio), and run terminal step facts for observing soft suppression, hard-limit recovery, token release, duration, cache usage, and step-budget exhaustion.
- Added `RuntimeEventCommitPort` so root and child Graph runs can durably commit a pending `history_summary` before realtime fan-out. After Host ack, Graph emits summarization end and publishes the same fact through the existing RuntimeEvent publisher; persistence consumers deduplicate by fact ID. Durable commit is the non-rollback boundary: only commit failure emits summarization error, while production progress callbacks are no-throw and post-commit fan-out failure preserves the committed summary.
- Added canonical inference cache breakpoints at the end of the system prompt and latest history summary. Provider adapters may project these stable anchors to native prompt-cache controls without changing request semantics.

### Changed

- Context projection now treats ordered Assistant replay as the sole model-facing owner of canonical reasoning. Complete thought events remain durable for UI and audit but never become a second model message; all replay reasoning stays in its original Assistant order until formal compaction. Local token estimation now follows that same replay shape.
- Replaced the product-shaped tool Schema context with `ToolSchemaBuildRequest`. Linnkit now forwards the generic invocation to the Host schema provider without naming or projecting Host model-purpose fields.
- Replaced the OpenAI-shaped `AgentAiEngine` callbacks with the structured `CanonicalInferencePort`; `LlmCaller`, retry/fallback, quickstart and testkit now share the same canonical request/event stream.
- Renamed the scripted provider fixture to `createScriptedInferenceHarness` and changed quickstart configuration from `llm` to `inference`.
- Provider continuation replay now requires the versioned payload and full producer route identity; usage enters telemetry only through actual canonical `usage` events.
- Prompt admission now uses the prepared model's formal inference route as its capacity baseline. Agent policy capacity fields are optional explicit caps, and `defineContextPolicy()` plus policy merging preserve their absence instead of materializing hidden limits. Only standalone integrations without a model route use the 256K context / 16K output framework fallback.
- The effective input budget reserves the resolved output limit and prepared Tool definitions before Context Manager message trimming; the same output limit is then applied to the provider request.
- Graph now measures the final reminder-applied messages and prepared tools through the active token route. Every successful provider attempt produces a strict `ContextUsageSnapshot` with normalized System prompt, Conversation, and Tool definitions attribution; failed attempts do not commit snapshots.
- Policy and quota fallback candidates are rejected before provider execution when their route cannot hold the active Prompt and output limit. A successful fallback is remeasured against its own route, tokenizer calibration, and served model identity.
- The latest successful Prompt snapshot is stored in Graph local checkpoint state so Host projections can rebuild it without replaying tokenization.
- Context build is now side-effect free with respect to LLM calls and durable facts. A compaction candidate contains only serializable plan data and formatted anchors; `applyCompaction()` validates a fixed-format checkpoint, rebuilds through the normal Context Manager pipeline, and returns a pending summary draft.
- Automatic compaction uses the run-locked main model, sampling/reasoning settings, stable tool schema order, and `tool_choice=none`; Provider or route differences remain confined to canonical inference adapters rather than creating alternate compaction algorithms.
- Graph step accounting now has one `maxSteps` limit. Context compaction no longer resets or expands the step budget, and wait-user resume preserves only the current run's compaction attempt count, committed count, and last committed fingerprint while reassembling execution-scoped policy.

### Removed

- Removed the legacy Summary pipeline and its dedicated model surface: `SummarizationProvider`, `AISummaryGenerator`, candidate/trigger helpers, `CheckpointSummarizationProvider`, `SummaryGenerationRequest` / `SummaryGenerationResponse`, and the context-build `summaryEvents` / `internalLlmCalls` sidecars.
- Removed `AgentSpec.contextPolicy.summarization`, `AgentSpec.contextPolicy.checkpoint`, the `budget-warning` reminder trigger and `budgetWarningRatio`; use the new `contextPolicy.compaction` group.
- Removed `ContextCheckpointTool` / `createContextCheckpointTool`, checkpoint marker exports, `GraphExecutorConfig.maxCheckpoints`, and checkpoint-driven step-reset behavior.
- Removed `contextPolicy.reasoningRetention`, `keepLatestThoughts`, and `MAX_THOUGHTS_TO_KEEP`; UI thought projection is no longer a model-context retention policy.
- Removed `InternalLlmCallUsage`; context-internal compaction calls now emit the normal `llm_call` telemetry and token-ledger usage directly from the Graph stage that performs the call.

### Compatibility

- `ToolSchemaContext` and `AgentInvocationRequest.imageGenerationModelId` were removed. Host `ToolCatalogPort` implementations must accept `ToolSchemaBuildRequest`, validate their own invocation extensions, and derive concrete-tool Schema context outside Linnkit.
- This is an intentional breaking Host contract change. `AgentAiEngine`, its callback stream types, `createScriptedAiEngineHarness`, and `LinnkitQuickstartConfig.llm` were removed without aliases or a dual-port bridge. Hosts must implement `CanonicalInferencePort` and migrate tests/configuration in the same upgrade.
- The source version is bumped to `0.31.0` because the automatic compaction contracts and durable commit port change the public Context Manager, Graph, and Host integration surfaces. This Unreleased train also includes the route-driven Prompt budget and final usage snapshot changes prepared after `0.28.0`.
- Hosts that previously relied on Linnkit's implicit 232K context / 2.4K response policy defaults must provide real model-route capacities. With a default `256000 / 16384` route and no Agent caps, the provider output limit is `16384` and the pre-tool input budget is `239616`.
- `contextPolicy.budget.reservedForResponse` must now be positive. `AgentProcessingResult.metadata` no longer duplicates context token usage; consumers must read `contextBuildResult.tokenUsage` for build-time messages and the Graph `contextUsage` snapshot for the final successful Prompt.
- This compaction convergence is an intentional breaking `0.x` minor change. Hosts must replace `summarization` / `checkpoint` policy fields with `compaction`, provide the new context-builder apply port and durable-before-fanout `RuntimeEventCommitPort`, and remove manual checkpoint tool registration. The superseded `RuntimeEventCommitBarrier` is removed without an alias; no migration adapter or dual-read path is provided.

## [0.28.0] - 2026-08-09

> Published release. This is the first npm / GitHub Release after `0.21.0`; it includes the unpublished `0.22.0`-`0.27.0` internal milestones below.

### Changed

- Execution-time observation governance now publishes the host-owned durable blob reference as `tool_output.metadata.observationTruncation.blobId` instead of injecting a runtime field into each tool owner's structured `data`.
- Historical truncation metadata without `blobId` remains readable; every newly truncated live output carries the reference returned by `ObservationPreviewPort`.

### Included milestones

- `0.22.0`-`0.23.0`: unified context-internal LLM usage contracts and telemetry.
- `0.24.0`: centralized runtime identity ownership, host-originated tool-call bootstrap, and turn-scoped raw tool retention.
- `0.25.0`: canonicalized durable `tool_output` results and removed duplicate output representations.
- `0.26.0`: made `subrun_trace` an explicitly ephemeral realtime projection.
- `0.27.0`: removed host-specific product semantics from public runtime and context-manager contracts.

### Compatibility

- Minor bump because `ObservationTruncationMeta` adds the optional durable `blobId` contract and new live truncation results publish that reference in runtime metadata rather than tool-owner `data`.
- Consumers upgrading from the last published version (`0.21.0`) must also apply the compatibility notes in the included `0.22.0`-`0.27.0` milestone sections below.

## [0.27.0] - 2026-08-08 (unpublished milestone; included in 0.28.0)

### Changed

- Removed the host-specific `citationOffset` field from `ToolExecutionContext` and execution metadata.
- ToolNode no longer interprets `tool_output.data.citations` or computes citation numbering; hosts now own citation sequencing as product semantics.
- Replaced the product-shaped context-manager `GenerateRequest` / `GenerateResponse` hook with the summary-specific `generateSummary` port and `SummaryGenerationRequest` / `SummaryGenerationResponse` contracts.
- Removed project, document, editor-block, quote, rejection, autocomplete-intent, and behavior fields from Linnkit's public context-manager surface; hosts retain those fields in their own invocation contracts.
- Observation preview metadata now passes any validated non-empty host document type to `ObservationPreviewPort` instead of recognizing a built-in product document-type list.
- Production comments and active integration examples now use host-neutral terminology; a package-wide no-host-leakage contract test prevents product names and rich host request fields from returning to production source.

### Fixed

- Runtime Agent observation admission now preserves valid tool output boundary whitespace (for example, a trailing newline in file content) while continuing to reject blank observations, keeping the contract aligned with `StructuredToolResult` and durable `tool_output`.

### Compatibility

- Minor bump because `@linnlabs/linnkit/runtime-kernel` removes the public `citationOffset` field and its runtime behavior, while `@linnlabs/linnkit/context-manager` replaces the generic generate hook with a summary-specific port. Hosts must own citation sequencing and adapt registered summary execution to `{ agentId, content, modelId }`; no alias or fallback is provided.

## [0.26.0] - 2026-08-05 (unpublished milestone; included in 0.28.0)

### Changed

- `subrun_trace` now requires `ephemeral: true`; it remains a realtime parent-display protocol while Host-owned compact trace history is the only reload source.
- Runtime event lifecycle governance rejects every `subrun_trace` from EventStore persistence and durable UI replay, even if an unparsed caller attempts to override the flag.

### Compatibility

- Minor bump because the public RuntimeEvent schema no longer accepts durable `subrun_trace` values. Hosts must persist child RuntimeEvents and project parent trace history separately; there is no legacy dual-read or fallback.

## [0.25.0] - 2026-08-05 (unpublished milestone; included in 0.28.0)

### Changed

- `tool_output` now has one canonical durable result contract: governed `observation`, structured `data`, explicit `error`, attachments, duration, and runtime metadata. The duplicate top-level `output`, open `payload`, `payload.output`, and `payload.result` representations were removed.
- Tool messages keep the model-facing observation in `content` and programmatic data in `metadata.data`; checkpoint detection no longer depends on a serialized `raw_output` shadow copy.
- Tool idempotency reconstructs structured results from canonical history fields and reuses already admitted attachment references without persisting execution-only `control`, `modelInput`, or observation preview declarations.
- Child-run trace projection uses canonical tool `data` for tool-card output while preserving the existing trace DTO and UI behavior.

### Compatibility

- Minor bump because Runtime/SSE tool-output schemas and creator signatures changed. Callers must provide either `{ status: 'success', observation, data }` or `{ status: 'error', observation, error }`; legacy tool-output fields are rejected without dual-read or fallback.

## [0.24.0] - 2026-07-26 (unpublished milestone; included in 0.28.0)

### Added

- Added `createHostToolCallBootstrap` to `@linnlabs/linnkit/runtime-kernel`. It constructs one host-originated standard tool call, its matching `tool_call_decision`, and the typed `tool` node prime patch from a single identity source while leaving event publication, persistence, runtime context, and execution ownership with the host.
- Added the public Runtime identity contract with centralized schemas, identity ownership, cross-field invariants, and explicit legacy history reference semantics.

### Changed

- Tool idempotency keys now use a 32-hex (128-bit) SHA-256 prefix instead of the legacy 16-hex prefix. Missing `conversation` or `turn` scope identity now fails explicitly rather than falling back to another scope.
- Tool pair retention now uses a turn-scoped raw tool window: current tool turn plus the latest historical tool turn are kept as original `tool_calls -> tool_output` groups, while older raw tool groups remain dropped.
- Context build no longer rewrites `tool_calls.function.arguments` or summarizes `tool_output`; tool output size governance is centralized in execution-time `toolOutput.observationGovernance`.
- Added `workingMemory.maxRecentToolRuns` as the canonical turn-window field; `maxRecentToolInteractions` remains as a deprecated compatibility alias.
- New `final_answer` facts now use one canonical identity across `RuntimeEvent.id`, `answer_id`, realtime seal, durable projection, and UI message identity.
- `createFinalAnswerEvent` and `createSSEFinalAnswerEvent` now accept `answerId` as their sole event/answer identity and no longer accept a separate event ID.
- `createSSEHistorySummaryEvent` now derives the wire `summary_id` from the Runtime event ID instead of accepting a second independently assignable identity.
- Runtime and SSE event creators now expose narrow options that cannot override identities or payload fields already owned by explicit creator arguments, including for direct JavaScript callers.

### Compatibility

- Minor bump because `@linnlabs/linnkit/runtime-kernel` adds a new public helper and contracts add identity exports while final-answer creator signatures change.
- Legacy 16-hex tool idempotency keys are not prefix-matched or dual-read. A retry of a pre-0.24 tool call is treated as a cache miss and uses the 32-hex contract for the new result.
- Breaking for explicit `AgentSpec.contextPolicy.toolHistory` configs: `maxPairTokens` and `maxOutputSummaryTokens` were removed. Remove those fields and configure output preview limits via `toolOutput.observationGovernance` instead.
- Breaking for direct final-answer creator callers: remove the separate event ID argument and pass the stable answer segment ID once. Immutable legacy events remain readable at host durable rebuild boundaries.
- Breaking for direct SSE history-summary creator callers: remove the separate `summaryId` argument; `summary_id` is now always the event ID.

## [0.23.0] - 2026-06-23 (unpublished milestone; included in 0.28.0)

### Added

- Added `InternalLlmCallUsage` to `@linnlabs/linnkit/contracts` as the single public DTO for context-internal LLM usage sidecar data.

### Changed

- `ProviderResult`, context build results, and `GraphExecutorContextBuildOutput` now share the contracts-level `InternalLlmCallUsage` type instead of repeating the same shape across layers.

### Compatibility

- Minor bump because `@linnlabs/linnkit/contracts` exposes a new public schema/type and internal context usage contracts now have a single source of truth.

## [0.22.0] - 2026-06-23 (unpublished milestone; included in 0.28.0)

### Added

- `GenerateResponse` can now carry optional `canonicalUsage` so host-provided context-internal generation hooks do not drop provider usage.
- Context provider results and `GraphExecutorContextBuildOutput` can now expose context-internal LLM usage sidecar data without writing audit usage into model context.
- `llm_call` telemetry events now accept optional `phase` and `purpose` fields; `buildContextStage` emits `phase: 'context-internal'` events for internal context LLM usage such as summarization.

### Compatibility

- Minor bump because `@linnlabs/linnkit/context-manager` and `@linnlabs/linnkit/runtime-kernel` expose new optional public contract fields.

## [0.21.0] - 2026-06-20

> Published release. This is the first npm / GitHub Release after `0.10.0`; it includes the unpublished `0.11.0`-`0.20.0` internal milestones below.

### Added

- `GraphExecutorContextBuildOutput` can now carry context token components and context component ledger entries.
- `context_build` telemetry events now accept `tokenComponents` and `tokenLedgerEntry`.
- The build context stage creates a `context-component` ledger entry from kept context components and emits it with context build telemetry.

### Compatibility

- Minor bump because runtime-kernel context builder and telemetry contracts expose new optional context component accounting fields.

## [0.20.0] - 2026-06-20 (unpublished milestone; included in 0.21.0)

### Added

- Context trace now records build-time `ContextTokenComponent[]` for final message states when token breakdown tracing is enabled.
- Added context token component derivation for system, user, assistant, tool, fence, context injection, and history summary messages.
- Tool components with execution-time observation truncation metadata now expose build-time `originalTokensEstimate` and `droppedTokensEstimate`.

### Compatibility

- Minor bump because `@linnlabs/linnkit/context-manager` context traces expose new token component breakdown data.

## [0.19.0] - 2026-06-20 (unpublished milestone; included in 0.21.0)

### Added

- `ContextTokenComponent` can now carry execution-time tool observation truncation estimates: `truncatedAtExecution`, `originalTokensEstimate`, and `droppedTokensEstimate`.

### Compatibility

- Minor bump because `@linnlabs/linnkit/contracts` exposes new optional context component accounting fields.

## [0.18.0] - 2026-06-20 (unpublished milestone; included in 0.21.0)

### Added

- Added `ObservationTruncationMeta` in `@linnlabs/linnkit/contracts` for execution-time tool observation truncation character metrics.
- `ObservationPreviewResult` can now return optional `originalChars`, `previewChars`, `originalLines`, and `previewLines` when a host truncates and stores a tool observation.
- `ToolNode` writes execution-time observation truncation metrics to `tool_output.metadata.observationTruncation`; token estimation remains deferred to context build.

### Compatibility

- Minor bump because `@linnlabs/linnkit/contracts` and runtime-kernel tool ports expose new optional observation truncation metadata.

## [0.17.0] - 2026-06-19 (unpublished milestone; included in 0.21.0)

### Added

- Added `ContextBuildTokenEstimate` from `@linnlabs/linnkit/contracts` to expose build-time local and calibrated context token estimates.
- `GraphExecutorContextBuildOutput` can now carry `tokenEstimate`, and runtime-kernel emits a `context_build` telemetry event when it is present.
- Exported pure `addUsageTotals` and `addLedgerAggregate` helpers from `@linnlabs/linnkit/runtime-kernel` for host-side collectors.

### Changed

- `contextPolicy.tokenEstimation.calibration` now supports `minCoefficient`; the default lower bound is `1` to avoid under-budgeting from noisy samples.

### Compatibility

- Minor bump because `@linnlabs/linnkit/contracts`, `@linnlabs/linnkit/runtime-kernel`, and telemetry event types expose new public APIs.

## [0.16.0] - 2026-06-18 (unpublished milestone; included in 0.21.0)

### Added

- Added the optional `TokenCounterPort` from `@linnlabs/linnkit/ports` for route-aware preflight token counts.
- `contextPolicy.tokenEstimation.remoteCount` can now opt into remote preflight counting during context build.
- `AgentMessageOrchestrator` accepts a host-supplied `tokenCounter` and `resolveTokenRoute` hook without changing default behavior.
- `ContextTrace` records whether remote count was enabled, attempted, applied, and which route was used.

### Changed

- Remote count is only attempted when the policy is enabled, a counter is injected, and the current `TokenRoute` explicitly declares `supportsRemoteTokenCount`.
- `mergeContextPolicy` now merges nested token estimation calibration and remote count policies field-by-field.

### Compatibility

- Minor bump because `@linnlabs/linnkit/ports` and `@linnlabs/linnkit/context-manager` expose new public token counting APIs.

## [0.15.0] - 2026-06-18 (unpublished milestone; included in 0.21.0)

### Added

- Added opt-in token usage calibration contracts from `@linnlabs/linnkit/contracts` for route-scoped actual-usage samples and auditable calibration traces.
- `AgentMessageOrchestrator` can now receive route-scoped calibration samples for context budgeting, while default behavior remains unchanged.
- `ContextTrace` now records token calibration status, coefficient, sample count, and sample ledger entry IDs when trace is enabled.

### Changed

- Context token estimates only apply calibration when `contextPolicy.tokenEstimation.calibration.enabled` is true and enough same-route actual samples are available.

### Compatibility

- Minor bump because `@linnlabs/linnkit/contracts` and `@linnlabs/linnkit/context-manager` expose new public token calibration APIs.

## [0.14.0] - 2026-06-18 (unpublished milestone; included in 0.21.0)

### Changed

- `RunCost` now uses `tokenUsage` as the canonical run-level token aggregate and no longer exposes the ambiguous single-call `canonicalUsage` field.
- Legacy `RunCost.tokensInput` and `RunCost.tokensOutput` remain for compatibility and should be read as projections from the run-level token aggregate.

### Compatibility

- Minor bump because `@linnlabs/linnkit/runtime-kernel` changes the public `RunCost` shape by removing the ambiguous `canonicalUsage` field.

## [0.13.0] - 2026-06-18 (unpublished milestone; included in 0.21.0)

### Added

- Added `TokenPricing`, `CostBreakdown`, and `TokenCostComponent` contracts for host-supplied effective per-million token prices.
- Added pure `computeCost(usage, pricing)` from `@linnlabs/linnkit/runtime-kernel` for input/output/reasoning/cache cost breakdowns.

### Changed

- `computeCost` reports `status: 'unknown'` when a required price is missing instead of treating missing prices as zero.

### Compatibility

- Minor bump because `@linnlabs/linnkit/contracts` and `@linnlabs/linnkit/runtime-kernel` expose new public cost accounting APIs.

## [0.12.0] - 2026-06-18 (unpublished milestone; included in 0.21.0)

### Added

- Added token ledger contracts from `@linnlabs/linnkit/contracts`: `TokenLedgerEntry`, `LlmUsageTokenLedgerEntry`, `ContextComponentTokenLedgerEntry`, `ContextTokenComponent`, `TokenUsageTotals`, `TokenLedgerAggregate`, and `RunTokenUsageAggregate`.
- Added `tokenAccounting` helpers from `@linnlabs/linnkit/runtime-kernel` for pure canonical usage aggregation, ledger entry creation, and parent/child run token aggregation without double counting.
- `llm_call` telemetry and `RunCost` can now carry optional token ledger references/aggregates while preserving the existing prompt/completion fields.

### Changed

- `ContextTrace` now has optional token ledger sidecars for component breakdowns without depending on runtime-kernel internals.

### Compatibility

- Minor bump because `@linnlabs/linnkit/contracts` and `@linnlabs/linnkit/runtime-kernel` expose new public token accounting APIs.

## [0.11.0] - 2026-06-18 (unpublished milestone; included in 0.21.0)

### Added

- Added token usage contracts from `@linnlabs/linnkit/contracts`: `CanonicalLlmUsage`, `TokenRoute`, `TokenRouteCapabilities`, `TokenCountSource`, and `TokenCountConfidence`.
- `llm_call` telemetry now carries canonical usage alongside the legacy prompt/completion token shape when provider usage can be normalized.
- `AgentAiEngine` responses can now return `canonicalUsage`, and `@linnlabs/linnkit/ports` exposes the optional `UsageNormalizer` type for hosts that centralize usage mapping.

### Changed

- Local LLM telemetry estimates now use the injected `TokenizerPort` instead of calling `TokenCalculator` directly.
- Legacy `NormalizedLlmUsage` no longer fabricates prompt/completion tokens from a total-only `usage.tokens` payload; unknown input/output stays unknown and falls back to local estimates.
- OpenAI-compatible default usage normalization now splits cached input tokens out of `prompt_tokens` and preserves `completion_tokens_details.reasoning_tokens` when reported.

### Compatibility

- Minor bump because `@linnlabs/linnkit/contracts` exposes new public runtime schemas and the `AgentAiEngine` port accepts canonical usage metadata.

## [0.10.0] - 2026-06-15

### Changed

- `GraphExecutor` / `Checkpointer` now name engine-state snapshot keys as `checkpointKey`, and graph telemetry reads the runtime `conversationId` from graph local state instead of treating the checkpoint key as a host conversation.
- Synchronous child runs can now receive an explicit host `conversationId` while still using an internal checkpoint key for GraphExecutor state isolation. This keeps RuntimeEvent / Audit / Telemetry scope aligned with the child run registered by the host and prevents EventStore-backed audit writes from mixing a child `runId` with an internal conversation key.
- Detached runs now execute against the `AgentSpec`, request, and metadata snapshots captured during `spawnDetached()` registration, so later caller-side object mutations cannot change the background run context.

### Compatibility

- Minor bump because `Checkpointer` / `CheckpointMeta` host adapter contracts now use `checkpointKey` for graph persistence identity. Host adapters that previously treated the graph checkpoint key as a user conversation id should pass host `conversationId` explicitly and reserve `checkpointKey` for engine snapshots.

---

## [0.9.0] - 2026-05-22

### Added

- `appendStreamingProviderReasoningDetails` / `compactProviderReasoningDetails` / `compactReasoningDetailsInValue` in `@linnlabs/linnkit/runtime-kernel` — provider-agnostic helpers for merging adjacent streaming `reasoning_content` fragments.

### Fixed

- Streaming `reasoning_details` now merges adjacent pure text reasoning fragments before returning the final LLM result and before emitting provider sidecar updates, preventing audit records from storing token-by-token reasoning fragments.
- `ToolNode` now drains every pending `assistant.tool_calls` item in the current batch before returning to the LLM, even when an earlier tool call fails. This preserves the protocol invariant that each tool call receives a corresponding tool output and avoids incomplete tool-call groups being dropped by downstream context assembly.
- Tool protocol fuse handling now waits until the current batch has been fully consumed before throwing, so one repeated protocol error cannot strand later tool calls in the same assistant message.

### Compatibility

- Minor bump because `@linnlabs/linnkit/runtime-kernel` has new public exports and ToolNode batch execution behavior is stricter.

---

## [0.8.0] - 2026-05-13

### Added

- `TokenizerPort` interface in `@linnlabs/linnkit/ports` — host-injectable token estimation contract
- `DefaultTokenizerPort` + `createDefaultTokenizerPort(config)` in `@linnlabs/linnkit/runtime-kernel` — wraps the existing `TokenCalculator` (tiktoken + char-ratio fallback) behind the new interface
- `ContextManagerBaseOptions.tokenizer` / `tokenizerModelId` on `AgentContextManager`, `ChatContextManager`, `AgentMessageOrchestrator`, `ChatMessageOrchestrator` — inject once at assembly time, drives all budget decisions
- `updateTokenizerModelId(modelId)` on `ContextManagerBase` — required when reusing one context manager across multiple models
- `createMockTokenizerPort()` in `@linnlabs/linnkit/testkit` — fixed-token-per-message mock for deterministic budget / trimming tests
- `C12_HOST_TOKENIZER_DRIVES_BUDGET` strict invariant in testkit `context-harness` — proves injected tokenizer actually drives `message-decision.tokens` and `trace.finalTokens`

### Compatibility

- Non-breaking. Hosts not injecting `tokenizer` continue using `TokenCalculator` with 0.7.x behavior unchanged.
- `contextPolicy.tokenEstimation` (encoding / avgCharsPerToken / toolCallOverhead) continues to configure the default tokenizer when no custom tokenizer is injected.

---

## [0.7.0] - 2026-05-12 (pre-npmjs milestone; superseded by 0.8.0)

### Added

- `defineAgent` / `runAgent` / `defineConfig` quickstart helpers
- `@linnlabs/linnkit/quickstart` public sub-entrypoint
- CLI v0: `linnkit init` / `linnkit run` / `linnkit doctor`
- `README.zh-CN.md` Chinese documentation

### Compatibility

- Non-breaking. All 0.6.x public APIs remain unchanged.

---

## [0.6.0] - 2026-05-11 (pre-npmjs milestone; superseded by 0.8.0)

### Added

- 12-group `AgentSpec.contextPolicy`: `budget` / `toolHistory` / `toolOutput` / `providerReplay` / `summarization` / `mustKeep` / `workingMemory` / `checkpoint` / `reasoningRetention` / `tokenEstimation` / `systemReminder` / `contextTrace`
- `defineContextPolicy()` helper — merges defaults and validates group combination constraints
- `ContextTrace` machine-readable sidecar of every context build decision
- `SystemReminder` registry + trigger/template extension points
- `ContextCheckpointTool` / `createContextCheckpointTool()` — host-neutral active checkpoint tool
- 11 additional strict invariants in testkit `context-harness` (total: 26 — 15 run + 11 contextPolicy + C12 tokenizer added in 0.8.0)
- `docs/integration/` restructured: 18 topic-specific guides each with Front Matter

### Compatibility

- Non-breaking. Hosts using the pre-0.6.0 flat `contextPolicy` shape are auto-migrated via `defineContextPolicy()`.

---

## [0.5.0] - 2026-05-10 (pre-npmjs milestone; superseded by 0.8.0)

### Added

- `AgentSpec` — first-class serializable agent blueprint (id / version / capabilities / tools / contextPolicy / modelHints / audit / metadata)
  - Note: `modelHints` was removed from the current contract on 2026-06-22 because it was never consumed by runtime model routing.
- `RunSupervisor` + `RunHandle` v2: `cancel` / `observe` / `cost` / `spawnDetached` / `waitForTerminal` / `drain` / `recoverOnBoot`
- `invokeChildRun` — synchronous child run with cost roll-up to parent
- `AuditEnvelope` + `AuditPort` — structured logging for non-deterministic decisions
- Tool history compression: `per-pair` / `per-run` / `none` strategies + `overflowStrategy`
- testkit with 15 strict run invariants
- Documentation reorganized: 17 topic-specific guides under `docs/integration/`

### Compatibility

- First stable public API surface. Sub-entrypoints locked.
