# Sandbox Platform Plan

## Document Rules

- This file is the long-lived implementation plan for `src/features/sandbox/`.
- Keep this document under 1000 lines.
- When milestones are completed, compress them into short outcome summaries instead of preserving detailed history.
- Keep future work decision-complete enough for implementation, but avoid changelog-style sprawl.

## Goal

Build a Linnya-native sandbox execution platform that can safely run increasingly complex AI-generated and user-provided code. The original bootstrap workload was Slides `ppt_codegen`; Slides has since retired that tool in favor of deck.js source through `write_file` / `edit_file`, while the sandbox platform and `ppt_compose` profile remain in use for deck.js compose execution.

Core principles:

- `node:vm` is not the security boundary.
- The real execution boundary is an isolated runner process.
- Host capabilities are explicit, brokered, and deny-by-default.
- Limits, cancellation, telemetry, and audit are part of the platform contract, not ad hoc patches.

## Architecture Direction

### Control Plane

- `SandboxService` is the only entry point.
- `SandboxService` depends only on `SandboxRunnerPort`; concrete runner selection belongs to the composition root.
- Responsibilities:
  - request validation
  - profile selection
  - policy synthesis
  - runner dispatch
  - cancellation
  - telemetry and audit shaping

### Profiles

- `SandboxProfileRegistry` owns workload-specific behavior.
- Initial profiles:
  - `ppt_compose`
  - `ts_script` later
- Profile responsibilities:
  - default limits and capabilities
  - preflight checks
  - runner payload shaping
  - post-execution validation

### Runner

- The production runner is installed once by the Electron app composition and fails closed when omitted.
- AI/user code executes in an internal Helper owned through the shared macOS process-group or Windows Job runtime.
- An Electron Utility supervises mailbox publication, control acknowledgement, timeout/cancel settlement, whole-tree cleanup, and resource release.
- Runner is allowed to use `node:vm` internally as an execution primitive, but not as the security boundary.

### Capability Broker

- Code does not directly receive host process objects.
- Runner only exposes broker-backed globals defined by profile bindings.
- Initial capability set:
  - `host.compose`
  - `artifact.write` reserved
  - `fs.read` reserved
  - `fs.writeScratch` reserved
  - `http.fetch` reserved
  - `task.spawnApproved` reserved

## Current Phase

### Phase 1: Foundation

Target:

- introduce typed sandbox contracts
- add `SandboxService`
- add `SandboxProfileRegistry`
- add `local-process` runner
- migrate the Slides compose workload to the new control plane
- keep `CodeSandbox` as the isolated Helper's only JavaScript evaluator primitive

Status:

- Completed for the current baseline

Completed in this phase:

- added typed sandbox contracts and profile abstraction
- added `SandboxService` and `SandboxProfileRegistry`
- added `local-process` child runner with host-side kill control
- added `ppt_compose` profile and moved the Slides compose workload onto the new control plane
- kept `CodeSandbox` as the isolated Helper's only JavaScript evaluator primitive
- added minimum contract tests for `SandboxService`
- added runner protocol activity events and host-side idle timeout handling
- added stricter child request decoding and runner diagnostics telemetry
- separated the runner request/result/cancellation definitions from the local-process transport and injected the unique existing adapter through a narrow port
- migrated production execution to the packaged Electron Utility and shared platform process owner
- deleted the legacy `fork + ELECTRON_RUN_AS_NODE` runner, duplicate timeout/kill/environment/path logic, and legacy bundle
- separated transport-neutral evaluation from local-process mailbox and lifecycle orchestration
- separated the public execution cause from resource cleanup diagnostics; cleanup failures remain observable without replacing timeout, cancellation, owner-end, or transport results

Remaining in this phase:

- none

Phase conclusion:

- The original baseline stabilized Slides code generation on top of the new sandbox control plane; current Slides creation now reaches it through deck.js source.
- This milestone is about strengthening the foundation, improving extensibility, and reducing execution risk.
- It is not intended to fully unlock generic TS/HTML/batch execution yet.
- Future sandbox expansion should remain demand-driven instead of speculative.

## Limits Baseline

These are default starting limits, not final product policy:

- `ppt_compose`
  - timeout: 10s
  - max heap target: 128MB
  - max logs: 200 lines
  - max result payload: 256KB
- `ts_script`
  - timeout: 15s
  - max heap target: 256MB
  - scratch: 32MB
- `html_render`
  - timeout: 30s
  - scratch: 100MB
  - artifact: 20MB
- `batch_job`
  - timeout: 5min
  - queue concurrency: 1-2

## Risk Controls

- hard timeout in host process
- inner execution timeout in runner
- idle timeout in host process based on protocol activity
- whole process-tree ownership and teardown before successful settlement
- minimal Helper environment and source delivery through a private mailbox rather than argv
- explicit capability manifest
- structured transport protocol
- log truncation
- result byte measurement
- deny-by-default capability access
- transport error classification
- future work:
  - quota integration
  - artifact lifecycle management
  - async heartbeats for long-lived non-blocking workloads

## External References We Intentionally Borrowed From

- `vm2` should not be used as the long-term basis because it is discontinued.
- `isolated-vm` is useful as inspiration for isolate ergonomics, but not sufficient as the sole security boundary.
- OpenHands runtime architecture is a good reference for provider separation.
- Deno Sandbox and Cloudflare Workers are good references for explicit permission models.
- gVisor / microVM systems are good references for long-term isolation goals, but are not current embedded dependencies.

## Next Milestones

### Milestone A

- Phase 1 is now the baseline:
  - stable `ppt_compose` through the production Electron Sandbox runtime
  - deck.js compose behavior preserved after `ppt_codegen` retirement
  - `syntax/runtime/timeout/security/policy_denied/resource_exhausted/transport` classification available

### Current Stop Point

- Keep sandbox scope focused on reliably supporting PPT code generation.
- Do not expand capability surface until a concrete workload requires it.
- Treat current implementation as the hardened base layer for future profiles.
- H1-H4 established the port, shared process ownership, packaged Helper/Utility production chain, and single-path cleanup on macOS and Windows.
- Full signed Linnya packages, installation/update paths, and the broader OS matrix remain release gates rather than reasons to restore a second runner.

### Milestone B

- introduce `ts_script`
- add source preflight
- reject direct Node built-in imports by policy

### Milestone C

- add async job mode for `html_render` and `batch_job`
- integrate queueing, cancellation, and artifact store

### Milestone D

- add quota and audit persistence
- expose execution diagnostics to higher-level tools
