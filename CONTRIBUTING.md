# Contributing to Linnya

Thank you for helping improve Linnya. This project is maintained by an individual developer, so focused changes with clear evidence are much easier to review than broad speculative rewrites.

## Before starting

1. Search existing issues and owner documentation.
2. For a bug, describe the root cause and a reproducible scenario.
3. For a new capability or contract change, open an issue before a large implementation.
4. Do not include credentials, private URLs, customer data, private plugin source, or generated secrets.

Small fixes may go directly to a pull request. Maintainers may ask that a large or product-sensitive change be split or discussed first.

## Engineering expectations

- Follow the domain-first vertical-slice architecture documented by the affected owner.
- Keep UI components thin; put rules in functions and multi-step side effects in orchestration.
- Do not use `any`, unsafe assertions, meaningless fallbacks, or compatibility layers without a real supported scenario.
- Keep public packages independent of Linnya product internals and private repositories.
- Update stable documentation when architecture, contracts, directories, or contributor workflows change.
- Test business behavior and failure semantics, not README snapshots or cosmetic constants.

Setup and validation commands are in the [development guide](docs/development/README.md).
Public documentation boundaries are defined in [docs/documentation-governance.md](docs/documentation-governance.md).

## Pull requests

A pull request should explain:

- the problem and owning domain/package;
- the chosen boundary and any rejected alternatives;
- exact validation performed;
- compatibility, migration, UI/UX, and rollback impact;
- documentation changes.

Keep commits reviewable and avoid mixing unrelated cleanup. Generated files must be produced by their canonical generator.

## Maintenance and decisions

Linnya is led and maintained by BCAutumn under the `linnlabs` GitHub organization. The lead maintainer has final responsibility for product direction, repository scope, merge decisions, releases, and security response.

Significant changes to public contracts, architecture, compatibility, security, or product behavior should be discussed in a public issue or pull request before implementation, then recorded in the owning stable documentation. Community input is welcome, but a proposal may be declined when it conflicts with product direction, weakens established boundaries, or creates disproportionate long-term maintenance obligations.

Changes merge when they are ready. A product release is a separately approved and verified snapshot; merging a change does not by itself create or schedule a release.

## Contribution license

No separate Contributor License Agreement is currently required. By submitting a contribution, you confirm that you have the right to submit it and agree that it may be distributed under the repository's license.
