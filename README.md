# Linnya

[简体中文](README.zh-CN.md)

Linnya is an agent-centered document database and extensible desktop workspace. It combines a conversational agent runtime, project-oriented documents, knowledge tools, and a plugin system in one Electron application.

> Linnya is under active development. APIs, storage formats, plugin contracts, and release processes may change before a stable release.

## What is in this repository

- The Linnya desktop host and Vue renderer.
- Integration with the published `@linnlabs/linnkit` host-neutral agent runtime.
- Shared schemas, plugin host contracts, and Renderer UI primitives.
- The open official Mindmap and Slides plugins.
- CLI, benchmark, build, test, and release-validation tooling required by the public source tree.

The repository does not make every official plugin or hosted service public. Open-source scope and production plugin distribution are separate boundaries: public source builds must work without private repositories, credentials, or adjacent checkouts.

Public documentation contains the stable contracts and maintenance rules needed by contributors. Internal proposals, research logs, and release evidence live outside this repository and are never required to build, test, or understand the public source. See [documentation governance](docs/documentation-governance.md).

## Architecture

| Area | Location | Responsibility |
| --- | --- | --- |
| Desktop renderer | `apps/renderer/` | Vue UI, interaction, and renderer domains |
| Product host | `src/app-hosts/linnya/` | Product-level agent, model, persistence, and plugin composition |
| Core domains | `src/domains/`, `src/tools/` | Business contracts, rules, orchestration, and agent tools |
| Agent runtime | [`@linnlabs/linnkit`](https://github.com/linnlabs/linnkit) | Independently versioned runtime kernel, graphs, tools, events, and ports consumed from npm |
| Plugin platform | `packages/plugin-host-contract/`, `packages/plugins/` | Stable host contracts and open plugin owners |
| Shared UI | `packages/renderer-ui/` | Tokens, primitives, icons, and reusable renderer interactions |

Linnya follows domain-first vertical slices. Cross-domain collaboration must use narrow public contracts, ports, registries, events, or app-level orchestration; a domain must not import another domain's internals.

Linnya pins an exact `@linnlabs/linnkit` npm version. Product builds and tests resolve that package from `node_modules`; framework source, tests, and release workflows live only in the [independent Linnkit repository](https://github.com/linnlabs/linnkit).

## Getting started

Prerequisites:

- Node.js 22 (the exact version is in `.nvmrc`)
- Corepack and the pnpm version pinned by `package.json`
- Rust and `wasm-pack`
- macOS or Windows for the full desktop development workflow

```bash
corepack enable
cargo install wasm-pack
pnpm install --frozen-lockfile
pnpm run dev:electron
```

The first desktop start prepares the target-platform Qdrant and Poppler runtimes from pinned releases and verifies their declared archive, executable, and file-tree checksums. Generated runtime files are not source-controlled.

See the [documentation map](docs/README.md) and [development guide](docs/development/README.md) for architecture, targeted validation, native-module requirements, and source builds.

### One-line prompt for coding agents

If you use Claude Code, Codex, Cursor, Windsurf, or another coding agent, you can paste this directly:

> If Linnya is not cloned yet, clone [https://github.com/linnlabs/linnya](https://github.com/linnlabs/linnya) first; then follow this README and `docs/development/README.md` to prepare a local desktop development environment, use Corepack and the repository-pinned pnpm version, install dependencies with `pnpm install --frozen-lockfile`, start Linnya with `pnpm run dev:electron`, keep development data in the default isolated `_dev_data` workspace, do not depend on private repositories or adjacent checkouts and do not invent or commit credentials, and finish by telling me the next command to run plus which Node.js / pnpm / Rust / `wasm-pack` / platform prerequisites are still missing.

---

## Plugin development

Plugins own their backend, renderer, shared contracts, tools, agents, skills, migrations, and artifacts. The host supplies stable capabilities and must not acquire plugin business semantics.

Start with:

- [Plugin architecture](docs/plugins/README.md)
- [Plugin guides](docs/plugins/guides/00-decision.md)
- [Plugin host contract](packages/plugin-host-contract/README.md)
- [Renderer UI design rules](packages/renderer-ui/README.md)

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before submitting a change. Project maintenance and decision-making are described in the contribution guide.

Use [GitHub Issues](https://github.com/linnlabs/linnya/issues) for reproducible bugs in the public source or current public build, focused feature proposals, public documentation corrections, and questions that can be discussed without private information. Search for an existing issue first. Bug reports should include the Linnya version or commit, operating system, reproduction steps, expected and actual behavior, and relevant sanitized logs or screenshots.

Do not post API keys, database contents, private documents, full user directories, private URLs, or sensitive infrastructure details. Security vulnerabilities follow [SECURITY.md](SECURITY.md), not a public issue.

## License

Unless a path states a different license, Linnya-authored source code and documentation are licensed under [Apache License 2.0](LICENSE). Copyright © 2024–present BCAutumn and Linnya contributors.

Linnkit, the Linnkit AI SDK provider adapter, and the vendored Stream Markdown Parser retain their separately declared MIT licenses. Third-party components and redistributed assets may have additional notices in `THIRD_PARTY_NOTICES.txt`. The Linnya name and official icons are covered by [TRADEMARKS.md](TRADEMARKS.md).
