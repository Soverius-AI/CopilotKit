# AGENTS.md — `@copilotkitnext/angular`

Context for contributors and AI agents working on CopilotKit’s Angular package.

**Discovery:** Root [AGENTS.md](../../AGENTS.md) points here for any work under `packages/angular/`. This file is the full program doc; it is not duplicated at the repo root.

## Program context (Soverius AI)

**Soverius AI** is improving Angular support in CopilotKit. Work is done in a fork/branch and **intended to merge upstream** into [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit).

| Topic | Policy |
| --- | --- |
| **Goal** | Polish Angular until it is a **first-class frontend**, comparable to React (`@copilotkit/react-core` v2). |
| **Current usage** | Angular is **not widely used in production** today — we may introduce **breaking changes** without a long deprecation window. |
| **Stale state** | Little upstream work on Angular for some time; expect gaps vs React (tests, CI, docs, API completeness). |
| **Write access** | Changes are limited to **`packages/angular/**` only.** |
| **Outside `packages/angular`** | Requires a separate request to the **CopilotKit team** (e.g. `packages/core`, `packages/runtime`, CI workflows, root scripts, `examples/`, docs site, showcase). |
| **Integration branch** | **`origin/feat/ng-a2ui-exp`** — all Soverius Angular work branches from this, not `main`. |

When something needs repo-wide CI or core API changes, document the ask clearly (what, why, suggested diff) for upstream — do not implement it inside this package.

## Git branching (Soverius)

**Base branch:** `feat/ng-a2ui-exp` on `origin` (Soverius-AI/CopilotKit).

That branch carries Angular **21**, zoneless demo patterns, updated `packages/angular` peers/build, and related lockfile/tooling. Do **not** branch Angular work from `main` unless you are only syncing upstream and immediately rebase onto `feat/ng-a2ui-exp`.

**Start or update local integration branch:**

```bash
git fetch origin
git checkout -B feat/ng-a2ui-exp origin/feat/ng-a2ui-exp
```

**New feature branch:**

```bash
git checkout feat/ng-a2ui-exp
git pull origin feat/ng-a2ui-exp
git checkout -b feat/angular/<short-description>
```

**Merge target for PRs:** `feat/ng-a2ui-exp` first; merge the integration branch to `main` only when the stack is ready for upstream.

**If you have commits on `main`:** rebase or cherry-pick onto `feat/ng-a2ui-exp`, not the other way around.

## Package facts

| Item | Value |
| --- | --- |
| Published name | `@copilotkitnext/angular` |
| Dev import alias (examples) | `@copilotkit/angular` → `packages/angular` |
| Angular version | **21.x** on `feat/ng-a2ui-exp` (peers `^21`; `main` may still be 19 until integration merges) |
| Stack | Standalone components, signals, `provideCopilotKit()`, Vitest + `@analogjs/vitest-angular` |
| Canonical reference | React v2 in `packages/react-core/src/v2/` (not `react-ui` for v2 chat) |

## Scope of work (in this package)

Prioritize, in rough order:

1. **API & behavior parity** with React v2 where it makes sense for Angular (DI, signals, directives — not literal React hook names).
2. **Test depth** — port the React/Vue pattern of in-process “e2e” tests (`MockStepwiseAgent` + real `CopilotChat` / `injectAgentStore` flows), not Playwright initially.
3. **CI confidence for upgrades** — see [CI for Angular upgrades](#ci-for-angular-upgrades) below; upstream workflow changes need CopilotKit team approval.
4. **Docs & examples** — README and Storybook/demo fixes often live under `examples/v2/angular/` (upstream / separate PRs unless Soverius has access).

Do **not** invest in Vue `PARITY.md` or showcase/aimock — those are React-only.

## Current gaps (baseline)

Use this when planning work; re-validate in git before large refactors.

| Area | State |
| --- | --- |
| Unit tests | ~13 Vitest specs (config, agent store, context, tools, 4 chat components) |
| Integration-style tests | None (no `MockStepwiseAgent` chat-flow tests yet) |
| CI | Covered indirectly via monorepo `pnpm run test` + `check:packages` when `packages/**` changes |
| `check-types` | Script exists; **not** in default CI/pre-commit |
| Demo / Storybook build | **Not** in main CI (`examples/**` path-ignored on `test/unit`) |
| Docs site | Angular not in shared `docs/` v2 reference |
| Showcase | No Angular integrations |

## Breaking changes

Because Angular adoption is low:

- Prefer **clean, modern Angular 19+ APIs** over carrying legacy shapes “for compatibility.”
- Still document breaking changes in `CHANGELOG.md` and README migration notes in this package.
- Align export surface with `src/public-api.ts` intentionally — trim or rename public APIs when it simplifies the path to React parity.

## Upstream requests (template)

When CopilotKit team involvement is required, open an issue/PR description with:

1. **Problem** — what blocks first-class Angular support.
2. **Proposed change** — file paths outside `packages/angular`.
3. **Why not in-package** — e.g. must change `CopilotKitCore`, Nx target, or workflow `paths`.
4. **Acceptance criteria** — e.g. `test_angular.yml` runs demo `ng build` on `packages/angular` changes.

Common upstream asks:

- `.github/workflows/test_angular.yml` + root `ci:angular` script
- `packages/core` API needed by Angular providers
- `examples/v2/angular/*` fixes blocked on workspace linking
- Publishing/docs: `@copilotkit/angular` naming alignment with `@copilotkitnext/angular`

## CI for Angular upgrades

Target command (to be added at repo root with upstream approval):

```bash
pnpm run ci:angular
```

Intended steps:

```bash
pnpm nx run @copilotkit/shared:build
pnpm nx run @copilotkit/core:build
pnpm -C packages/angular run check-types
pnpm -C packages/angular run build
pnpm -C packages/angular run test
pnpm -C packages/angular run publint
pnpm -C packages/angular run attw
# Consumer compile (upstream workflow / examples access):
# pnpm -C examples/v2/angular/demo run build
# pnpm -C examples/v2/angular/storybook run build
```

Until upstream adds a dedicated workflow, run the above locally on every Angular or `@angular/*` bump PR.

## Validation (within `packages/angular`)

After meaningful changes:

```bash
pnpm -C packages/angular run check-types
pnpm -C packages/angular run build
pnpm -C packages/angular run test
pnpm -C packages/angular run publint
pnpm -C packages/angular run attw
```

From repo root (also builds dependencies):

```bash
pnpm run build
pnpm run test   # includes packages/angular when Nx discovers it
```

## Code conventions

Follow existing `packages/angular` style and user/team rules:

- Standalone components, `@if` / `@for` / `@switch`, `input()` / `signal()` / `computed()`
- `readonly` and `private` via `#` or `protected` where applicable
- Inline templates in components unless a strong reason for external HTML
- Reuse `@copilotkit/core` — do not reimplement AG-UI protocol logic in Angular

## Reference implementations for tests

When adding integration-style tests, copy **patterns** from:

- `packages/react-core/src/v2/__tests__/utils/test-helpers.tsx` (`MockStepwiseAgent`, `renderWithCopilotKit`)
- `packages/react-core/src/v2/components/chat/__tests__/CopilotChat.e2e.test.tsx`
- `packages/vue/src/v2/__tests__/utils/test-helpers.ts` (closest non-React framework)

Implement under `packages/angular/src/__tests__/` (or colocated `*.spec.ts`).

## Related files

| File | Role |
| --- | --- |
| [README.md](./README.md) | User-facing install/API |
| [src/public-api.ts](./src/public-api.ts) | Published surface |
| [CHANGELOG.md](./CHANGELOG.md) | Package releases (`angular` release scope) |

## Maintenance

Update this file when Soverius/upstream policy changes (e.g. breaking-change policy, write-access boundaries, or CI landing upstream).
