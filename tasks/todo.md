# Multiple-container skill delivery implementation plan

> Use subagent-driven-development for the independent language implementation task and review. Keep edits in the assigned directories.

**Goal:** Consume published skills from several containers without breaking existing SDK or CLI callers.
**Architecture:** Retain each single-container cache, compose immutable invocation snapshots, and expose mutually exclusive configuration forms.
**Tech stack:** TypeScript, Python, C#, Nx, Vitest, pytest, .NET tests.

- [x] TypeScript core and adapters: add failing tests in `packages/runtime/src/v2/runtime/intelligence-platform/__tests__/skill-registry.test.ts`; add the exclusive options union in `skill-registry/config.ts`; compose registries in `skill-registry/registry.ts`; keep immutable snapshots and qualified names; export source types; exercise BuiltInAgent, Mastra, and LangGraph consumers. Run `pnpm nx test @copilotkit/runtime` with the focused paths, and the adapters' test/build targets.
- [x] Python and .NET: implement the same contract in `packages/intelligence-delivery-python-core/src/_delivery/` and `packages/intelligence-agent-framework-dotnet/src/`; expose it through Python adapters; add and run focused tests first; update package READMEs. Preserve ownership, cancellation, and disposal semantics.
- [x] CLI: in the Intelligence worktree, extend `apps/cli/src/commands/skills-download.ts`, command parsing, and `services/learning-skills-download.ts`. Add failing command and extraction tests before implementation. Run CLI Nx test, lint, typecheck, build and available e2e checks.
- [x] Documentation: update `showcase/shell-docs/src/content/docs/intelligence/learned-skills.mdx`, relevant SDK reference, overview, README and CLI docs. Describe pins, mutually exclusive fields, legacy environment precedence, qualified names and all-or-nothing failure behavior. Run existing docs checks.
- [x] Review and deliver: review specification compliance, then code quality, fix findings, run focused regression tests and builds, inspect diffs, commit logical changes and push draft PRs. Do not merge or publish packages.

## Workspace Learning SDK

The user authorizes the complete workspace Learning delivery and its stacked preview workflow.
Use the verified #7966 head as the parent, per that workflow, after fetching current remote refs.

- [x] Add typed discovery, run, candidate, review, and evidence methods to `CopilotKitIntelligence`.
- [x] Reuse the existing credential configuration and platform error type; keep backend errors redacted on these new methods.
- [x] Validate response contracts, preserve cancellation, bound request time, and avoid automatic write retries.
- [x] Prove the methods with regression tests and verify runtime checks/build.
- [ ] Document server authority and API use; open a draft companion above #7966 and register native stack membership.

API usability review: discovery returns stable IDs and names with an explicit next cursor.
Run admission and completion are separate; callers can read bounded run history.
Candidate detail exposes files and supporting Insights before an explicit review action.
Evidence preserves missing-source states. Project authority comes from server credentials,
not browser identity. Every method accepts cancellation and uses the same error type.
Writes are never retried automatically; callers reconcile state after a lost response.
Existing Skill delivery APIs remain the source for published content.

Validation: `NX_DAEMON=false pnpm nx test @copilotkit/runtime -- src/v2/runtime/intelligence-platform/__tests__`
passed 227 tests in 11 files, including six new management tests.
`NX_DAEMON=false pnpm nx run @copilotkit/runtime:check-types` and
`NX_DAEMON=false pnpm nx run @copilotkit/runtime:check-dts` passed (the latter builds the package).
Changed-file `pnpm exec oxlint` passed with no warnings or errors.
Docs examples and limits were checked against both SDK and companion API source.
Live backend acceptance remains a separate preview-delivery gate.

## A2UI 1.0 Express with Chrome browser inference

**Status:** Plan prepared; implementation awaits user review.
**Branch:** `demo/a2ui-1.0`, created from freshly fetched `origin/main` at `bbc3f036cd`.
**Worktree:** `/Users/wolfmanfx/Dev/CopilotKit-a2ui-1.0`.

**Goal:** Add `/a2ui-1.0` to the existing Angular demo app. A natural-language request runs through Chrome's built-in Prompt API (Gemini Nano), produces A2UI Express, compiles locally into A2UI v1.0 operations, and renders through CopilotKit's native Angular generative UI. Show the full process and user interactions in the browser. Inference and compilation must not depend on the demo server or a cloud API key.

**User refinement:** Use CopilotKit's prompt/context machinery, teach Express through in-context examples in the model's system prompt, and expose the generated DSL as agent state for debugging. The demo should exercise a real local CopilotKit agent, rather than a separate inference playground that bypasses CopilotKit.

### Confirmed scope and findings

- The user selected an Angular demo route rather than a standalone example, requested Chrome Prompt API inference, and authorized a branch for dependency updates.
- The app uses Angular 22 and already configures `@copilotkit/angular/generative-ui`. Its catalog exporter produces v1.0 schemas and preserves Express parameter order.
- The published `@a2ui/agent` SDK is currently `0.0.2`, depends on `@a2ui/web_core` `^0.14.0`, and publicly exposes `ExpressParser`, `ExpressPromptGenerator`, and `ExpressFormatFactory`. The repo currently pins `web_core` to `0.10.4`; compatibility and dependency updates are an explicit first milestone.
- The published agent SDK scan found no direct Node builtin imports in its JavaScript. A browser build and a real compile/render round trip must still establish browser compatibility.
- Upstream currently calls A2UI v1.0 a release candidate. Label the demo accurately.
- Nx MCP tools are unavailable in this session. Nx CLI project inspection confirmed the existing `@copilotkit/angular-demo` build/dev targets; use Nx for implementation checks.

### Agreed architecture to implement

1. Register a browser-local `AbstractAgent` for this route. CopilotKit owns conversation runs, context, user actions, and the generative UI envelope, as with the existing local catalog agent.
2. Read the current run's catalog, targets, existing surfaces, action, and application context from CopilotKit. Compose the Chrome session's system prompt from CopilotKit's UI guidance plus the official catalog-derived Express language contract and a small set of valid request/Express examples. Keep conversation messages and user-entered values as run input rather than instructions. This is in-context learning, not model training.
3. Make Express an explicit output mode in prompt composition: preserve CopilotKit's behavioral guidance, but replace instructions to call `render_ui` with JSON with instructions to emit Express. Do not concatenate contradictory JSON/tool and DSL output contracts or patch generated prompt text using fragile string replacements. If shared prompt composition needs an option, keep the existing default behavior unchanged and cover both modes.
4. Pass that system prompt to Chrome's `LanguageModel.create({ initialPrompts: [...] })`, then stream the response through `promptStreaming()`. Recreate/rebase the session when its system contract changes, and choose one conversation-history owner so follow-ups do not duplicate previous turns.
5. Compile the Express locally with the official SDK, validate the resulting operations, and emit the existing `generative-ui-surface` activity events. CopilotKit's renderer remains the authority for the UI, bindings, and actions.
6. Publish a namespaced debug object under agent state, for example `state.a2uiExpress = { runId, surfaceId, stage, dsl, operations, diagnostics, timings }`. Initialize it with `STATE_SNAPSHOT` while preserving other state fields; publish bounded/throttled `STATE_DELTA` JSON patches as generation progresses. The page reads it through `injectAgentStore(agentId).state()`. Track cancellation/failure as well as success, and bound any retained history. Debug state is separate from the surface data model and is not automatically copied back into the next model prompt.
7. Offer the exact composed system prompt in a debug view, alongside the DSL, operations, and diagnostics, so it is possible to inspect what the model was taught and what the compiler accepted. Do not require the debug payload to render the UI or send full snapshots for every generated token.

### Implementation sequence

- [ ] **Prove the browser toolchain and update dependencies.** Add the official Express SDK to the demo and Prompt API TypeScript types. Audit A2UI consumers and update the required `web_core` dependency declarations and lockfile consistently where compatibility requires it. Bundle the SDK in Angular and compile a small Express sample against a catalog exported from the same UI used by the preview. Validate the v1.0 output and render it with the existing engine, including a bound input and an event. Resolve any schema/API mismatch here before building the full page; use the official parser rather than inventing a partial DSL implementation.
- [ ] **Compose the CopilotKit + Express system prompt.** Reuse the run envelope and shared prompt machinery for catalog/context/target/surface behavior. Add the explicit Express output contract and valid few-shot examples through structured prompt composition. Show the resulting system prompt in the debug view and verify it does not also request raw JSON/tool output.
- [ ] **Add the local CopilotKit agent and Chrome inference adapter.** Feature-detect `LanguageModel`, check availability using the same text/language options as session creation, and expose unavailable/downloadable/downloading/ready/generating/error states. Create/download the session from an explicit user gesture with progress. Use the composed system prompt and `promptStreaming()`, support cancellation, and destroy sessions on reset/navigation. Keep context bounded for Gemini Nano with a focused catalog and a few examples. Carry conversations and user actions through CopilotKit, compile the DSL, and emit the standard surface activity events. Do not silently route unsupported browsers to cloud inference.
- [ ] **Publish debug agent state.** Emit a namespaced initial snapshot and throttled JSON-patch deltas containing the latest DSL, operations, compilation diagnostics, run identifiers, stage, and timings. Preserve unrelated agent state, guard against stale updates, and keep debug data out of model context unless explicitly selected. Show the values from the agent store rather than maintaining a second authoritative copy in the page.
- [ ] **Build `/a2ui-1.0`.** Add a lazy route and a responsive page using CopilotKit conversation UI, example prompts, enable/download, generate, stop, reset, and compile-edited-source controls. Show streamed/editable Express source, compiled JSON, the system prompt, native Angular preview, and a data/action log. Explain the stages in the page: CopilotKit context + Express examples -> Gemini Nano -> Express -> v1.0 operations -> native components. Lazy-load the compiler so other demo routes do not pay its startup cost.
- [ ] **Demonstrate useful behavior.** Include a simple card/layout, a form with two-way bindings and a submit event, and an existing-surface update. Keep complete, editable Express presets available and explicitly label preset execution separately from real model generation. Show local data-model changes immediately. Feed submitted actions and current surface context into the local model for an updated response, using the same compilation/render path.
- [ ] **Handle streaming and errors.** Show raw model text as it arrives; only apply complete, validated operations supported by the SDK's streaming contract. Initially accept the completed response if progressive compilation cannot be proven correct. Preserve the last valid preview on syntax/schema errors, display useful diagnostics, and prevent cancelled or superseded generations from updating it. Give unsupported browsers a setup explanation while allowing manual preset compilation.
- [ ] **Verify and document.** Add focused behavior checks for prompt composition/output modes, debug state propagation, the browser adapter lifecycle, cancellation/stale results, invalid DSL, and compile-to-render bindings/actions. Run `pnpm exec nx run @copilotkit/angular-demo:build` and affected package checks for any dependency/API changes. Verify the real Prompt API in eligible desktop Chrome on localhost, including download/availability, generation, editing, form actions, updates, stop/reset, and page cleanup. Inspect desktop/mobile layouts and browser console/network behavior. Distinguish mock coverage from actual local-model evidence; if Chrome/device support blocks live inference, report that limitation explicitly. Add local setup and usage instructions with current Chrome requirements and no API-key requirement.
- [ ] **Deliver in logical commits.** Commit tests with their implementation, push each completed unit to `origin/demo/a2ui-1.0`, and provide launch instructions and evidence. Keep the feature in this worktree for review.

### Acceptance criteria

1. An eligible Chrome user opens `/a2ui-1.0`, enables the local model, enters a request, and sees real model-generated Express, valid v1.0 JSON, and native Angular UI.
2. All inference and compilation execute in the browser; the demo feature requires no remote model credential or backend compilation endpoint.
3. A form input changes the surface data model, its action appears in the log, and the local model can respond with a surface update.
4. Manual Express edits and presets use the same official compiler/render path. Unsupported-device, download, cancellation, and invalid-output states are visible and recoverable.
5. Necessary dependency upgrades pass their affected checks and existing demo routes still build.
6. The local agent receives a CopilotKit-derived system prompt that teaches Express with examples. The debug panel exposes that prompt and reads generated DSL/compilation status from AG-UI agent state; UI rendering uses the compiled surface activities.

### Primary references

- Chrome Prompt API: https://developer.chrome.com/docs/ai/prompt-api
- Chrome built-in AI setup: https://developer.chrome.com/docs/ai/get-started
- Express specification: https://a2ui.org/specification/proposals/express/a2ui_express/
- Official TypeScript SDK: https://github.com/a2ui-project/a2ui/tree/main/typescript/agents/a2ui_agent
- A2UI v1.0 candidate: https://a2ui.org/specification/v1.0-a2ui/
