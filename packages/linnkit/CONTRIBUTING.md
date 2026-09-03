# Contributing to linnkit

Thank you for your interest in contributing to linnkit.

linnkit is an open-source project licensed under MIT. Contributions of all kinds are welcome — bug reports, documentation improvements, and code changes.

---

## Development setup

**Requirements**

- Node.js `>=20`
- npm `>=9`

**Getting started**

```bash
# Clone the repo (or your fork)
git clone https://github.com/linnlabs/linnkit.git
cd linnkit

# Install dependencies
npm install --no-audit --no-fund

# Verify the setup
npm run test:smoke
```

---

## Running tests

| Command | What it runs |
|---------|-------------|
| `npm run test:smoke` | Package shell smoke test — verifies exports and sub-entrypoints resolve correctly |
| `npm run test:smoke:dist` | Runtime import + browser-safe events seam test against the built dist |
| `npm run test` | Full vitest suite |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run build` | Build dist (required before `test:smoke:dist`) |

Before opening a PR, run locally:

```bash
npm run typecheck && npm run build && npm run test
```

All three must pass.

---

## Opening a pull request

**Checklist before marking PR ready for review**

- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] `npm run test` passes (all suites green)
- [ ] New public exports are documented in the relevant `docs/integration/` guide
- [ ] If you modified a public sub-entrypoint, check the snapshot test in `src/runtime-kernel/__tests__/__snapshots__/` and `src/testkit/__tests__/__snapshots__/` — update snapshots intentionally, not blindly

**Scope guidance**

- linnkit is intentionally thin — it does not include built-in LLM providers, RAG, memory systems, or UI. Please don't open PRs adding these.
- Bug fixes and protocol-level improvements are always welcome.
- Larger features or API surface changes: open an issue first to discuss design intent.

---

## Commit message convention

linnkit uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

Common types: `feat` / `fix` / `refactor` / `test` / `docs` / `chore`

Examples:

```
feat(ports): add TokenizerPort interface
fix(context-manager): correct fence lifetime pruning on multi-turn runs
docs(integration): simplify agent-registration-guide examples
```

---

## Code style

- TypeScript strict mode. No `any` casts — read the type definition before casting.
- Comments in code should explain *why*, not *what*. No redundant comments like `// increment counter`.
- New files: `.ts`. High cohesion, low coupling.
- No defensive or patch-style fixes. Trace bugs to their root cause.

---

## No CLA required

linnkit is MIT-licensed. No Contributor License Agreement is required. By submitting a pull request, you agree that your contribution will be licensed under MIT.

---

## Questions?

Open a [GitHub Discussion](https://github.com/linnlabs/linnkit/discussions) for questions about usage or design. Use [GitHub Issues](https://github.com/linnlabs/linnkit/issues) for bug reports and feature requests.
