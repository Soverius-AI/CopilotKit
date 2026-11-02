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

**Status:** Implemented and verified with native Chrome inference and a real Transformers.js WebGPU fallback. Manual UI execution was removed following the user’s refinement. Model compliance remains variable for larger forms.
**Branch:** `demo/a2ui-1.0`, created from freshly fetched `origin/main` at `bbc3f036cd`.
**Worktree:** `/Users/wolfmanfx/Dev/CopilotKit-a2ui-1.0`.

**Goal:** Add `/a2ui-1.0` to the existing Angular demo app. A natural-language request runs through Chrome's built-in Prompt API (Gemini Nano), produces A2UI Express, compiles locally into A2UI v1.0 operations, and renders through CopilotKit's native Angular generative UI. Show the full process and user interactions in the browser. Inference and compilation must not depend on the demo server or a cloud API key.

**User refinement:** Use CopilotKit's prompt/context machinery, teach Express through in-context examples in the model's system prompt, and expose the generated DSL as agent state for debugging. The demo should exercise a real local CopilotKit agent, rather than a separate inference playground that bypasses CopilotKit.

### Confirmed scope and findings

- The user selected an Angular demo route rather than a standalone example, requested Chrome Prompt API inference, and authorized a branch for dependency updates.
- The app uses Angular 22 and already configures `@copilotkit/angular/generative-ui`. Its catalog exporter produces v1.0 schemas and preserves Express parameter order.
- The published `@a2ui/agent` SDK is currently `0.0.2`, depends on `@a2ui/web_core` `^0.14.0`, and publicly exposes `ExpressParser`, `ExpressPromptGenerator`, and `ExpressFormatFactory`. The repo currently pins `web_core` to `0.10.4`; compatibility and dependency updates are an explicit first milestone.
- The SDK main entry also loads Node filesystem catalog/skill helpers. A pinned patch exposes only the browser-safe Express compiler and prompt generator; the Angular browser build and real compile/render round trip pass.
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

- [x] **Prove the browser toolchain and update dependencies.** Add the official Express SDK to the demo and Prompt API TypeScript types. Audit A2UI consumers and update the required `web_core` dependency declarations and lockfile consistently where compatibility requires it. Bundle the SDK in Angular and compile a small Express sample against a catalog exported from the same UI used by the preview. Validate the v1.0 output and render it with the existing engine, including a bound input and an event. Resolve any schema/API mismatch here before building the full page; use the official parser rather than inventing a partial DSL implementation.
- [x] **Compose the CopilotKit + Express system prompt.** Reuse the run envelope and shared prompt machinery for catalog/context/target/surface behavior. Add the explicit Express output contract and valid few-shot examples through structured prompt composition. Show the resulting system prompt in the debug view and verify it does not also request raw JSON/tool output.
- [x] **Add the local CopilotKit agent and Chrome inference adapter.** Feature-detect `LanguageModel`, check availability using the same text/language options as session creation, and expose unavailable/downloadable/downloading/ready/generating/error states. Create/download the session from an explicit user gesture with progress. Use the composed system prompt and `promptStreaming()`, support cancellation, and destroy sessions on reset/navigation. Keep context bounded for Gemini Nano with a focused catalog and a few examples. Carry conversations and user actions through CopilotKit, compile the DSL, and emit the standard surface activity events. Do not silently route unsupported browsers to cloud inference.
- [x] **Publish debug agent state.** Emit a namespaced initial snapshot and throttled JSON-patch deltas containing the latest DSL, operations, compilation diagnostics, run identifiers, stage, and timings. Preserve unrelated agent state, guard against stale updates, and keep debug data out of model context unless explicitly selected. Show the values from the agent store rather than maintaining a second authoritative copy in the page.
- [x] **Build `/a2ui-1.0`.** Add a lazy route and a responsive page using CopilotKit conversation UI, example prompts, enable/download, generate, stop, reset, and compile-edited-source controls. Show streamed/editable Express source, compiled JSON, the system prompt, native Angular preview, and a data/action log. Explain the stages in the page: CopilotKit context + Express examples -> Gemini Nano -> Express -> v1.0 operations -> native components. Lazy-load the compiler so other demo routes do not pay its startup cost.
- [x] **Demonstrate useful behavior.** Include a simple card/layout, a form with two-way bindings and a submit event, and an existing-surface update. Keep complete, editable Express presets available and explicitly label preset execution separately from real model generation. Show local data-model changes immediately. Feed submitted actions and current surface context into the local model for an updated response, using the same compilation/render path.
- [x] **Handle streaming and errors.** Show raw model text as it arrives; only apply complete, validated operations supported by the SDK's streaming contract. Initially accept the completed response if progressive compilation cannot be proven correct. Preserve the last valid preview on syntax/schema errors, display useful diagnostics, and prevent cancelled or superseded generations from updating it. Give unsupported browsers a setup explanation while allowing manual preset compilation.
- [x] **Verify and document.** Add focused behavior checks for prompt composition/output modes, debug state propagation, the browser adapter lifecycle, cancellation/stale results, invalid DSL, and compile-to-render bindings/actions. Run `pnpm exec nx run @copilotkit/angular-demo:build` and affected package checks for any dependency/API changes. Verify the real Prompt API in eligible desktop Chrome on localhost, including download/availability, generation, editing, form actions, updates, stop/reset, and page cleanup. Inspect desktop/mobile layouts and browser console/network behavior. Distinguish mock coverage from actual local-model evidence; if Chrome/device support blocks live inference, report that limitation explicitly. Add local setup and usage instructions with current Chrome requirements and no API-key requirement.
- [x] **Deliver in logical commits.** Commit tests with their implementation, push each completed unit to `origin/demo/a2ui-1.0`, and provide launch instructions and evidence. Keep the feature in this worktree for review.

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

A2UI demo validation (2026-10-31):

- Upgraded all workspace A2UI web_core consumers to 0.14.0, without aliases; retained legacy v0.9 protocols in their catalogs and v1.0 in the native surface engine.
- Required commit hooks ran test, publint, and attw across 27 affected projects successfully after compatibility fixes and local native SQLite dependency setup.
- Angular demo Nx build and 11 compiler/agent/adapter tests passed. Core generative UI coverage passed 161 tests; the legacy Angular streaming regression set passed 42 tests.
- Real Chrome browser checks: native form rendering, two-way input, targeted update preserving the input, action payload in agent state, invalid DSL preserving the preview, and reset. Browser console had no errors on the standalone route.
- Desktop and mobile screenshots are under output/playwright/. Real Prompt API availability was checked in two Chrome profiles, including one allowing model downloads; both reported unavailable. No generated preset was presented as a model inference result.

## Browser-model fallback and generated-only demo

User direction: remove manually authored UI execution; when Chrome Prompt API is absent or unavailable, load an LLM with Transformers.js in the browser.

- [x] Add a lazy Web Worker Transformers.js adapter with model download progress, streaming, cancellation and disposal; choose it automatically when the native API is unavailable.
- [x] Remove preset rendering, edited-source compilation and canned form acknowledgements from the demo. Keep few-shot DSL only as model teaching context and compiler test fixtures.
- [x] Expose the selected engine/model and loading state through AG-UI; preserve official Express compilation and native Angular rendering.
- [x] Test native selection and fallback, worker cancellation and failures, and real Chrome generation with the native API disabled. Verify actual input/action flow and capture model-produced results.
- [x] Update setup/results documentation, commit logical changes and push.

## Upgrade the existing React and Angular A2UI renderers

User direction: add A2UI 1.0 support to the older renderers; keep all new work local and do not push.

- [x] Add versioned 1.0 basic catalogs using official schemas and existing native React/Angular components; expose 1.0 custom catalog options while retaining 0.9 compatibility.
- [x] Remove forced 0.9 parsing in the Angular surface and use catalog versions for model lifecycle operations. Advertise the matching protocol/schema to agents.
- [x] Verify 1.0 inline creation/data, @path/@call bindings, input/action flow, component replacement, deletion and legacy regression coverage.
- [x] Build affected packages and the Angular demo through Nx, record results, and commit locally without pushing.

Validation: Nx builds for Angular, React, the standalone renderer, shared/core and the Angular demo passed. Runtime suites passed: renderer 35, Angular 1045, React 2471 plus 54 script checks, core 1694, shared 716, demo 21. Final Nx type checks passed for Angular/React and all 35 prerequisite tasks. New coverage exercises inline 1.0 creation, @path/@call, edited action context, null deletion, replacement, slider divisions, text placeholders, video posters, custom catalogs/filtering, protocol-aware snapshots/context and the React loading handoff. The 0.9 defaults remain compatible; select `basicCatalogV1` or `protocolVersion: "1.0"` to use 1.0. No remote changes are authorized.

Follow-up verification: preserve optional 1.0 action `userMessage`/catalog metadata in React and expose those fields in both frameworks' callback types. Both native renderer action tests assert the message reaches the callback along with the edited input. The metadata tests passed in the 35-test renderer suite, 1045-test Angular suite, and 2471-test React suite plus 54 script checks. Run React type checking after the export tests finish, because those tests create/delete `__probe-module.ts` in the source tree and can race TypeScript's file scan.

## Launch-review fixes for `/a2ui-1.0`

Source: `output/reviews/opus-launch-review.txt` and its addendum. Local only: no commits, pushes or dependency changes. Edits stay in the Angular demo route, `app.config.ts`, its tests and README.

- [x] **Unusable Form gate.** After the isolated native preflight replays earlier activities, inspect each touched surface's complete component graph. Every Form reachable from `root` needs a usable `submit=true` Button in its own subtree: layout wrappers count, a nested Form's button does not. Send a precise diagnostic (naming any orphaned submit Button) to model repair. Never add or move the button. Tests: the verbatim native-checkout DSL is rejected and repaired; a nested-layout button passes; a nested Form's button does not satisfy its parent; a partial follow-up update that omits the existing Form passes.
- [x] **Prompt and repair guidance.** State the Button `onClick` (second positional) and Form `onSubmit` Event parameters, that this catalog has no `action` parameter, and that a `submit=true` Button goes in the Form's children with no Event. Add targeted repair hints for `action` and duplicated properties. Keep the catalog-derived signatures and limit the prompt growth.
- [x] **`review_order` follow-up.** Give actions a generic, defined outcome (show the result in the same surface from the submitted values, without reassigning `$/` paths), and describe `review_order` through route application context. Test action/context propagation, a repaired `action=` follow-up, and preservation of the user's edited values and the last good surface.
- [x] **Chat outcomes and prose.** Post an assistant message for exhausted validation, ordinary errors and cancellation, each with distinct wording and no success acknowledgement. Accept a short reply without Express markers as a prose answer (stage `answered`, nothing published) only on a first attempt with no action pending. Express-like or long text still goes through the compiler.
- [x] **Route detection.** Match `/a2ui-1.0` with a trailing slash and under the document base href. Add helper tests.
- [x] **Download disclosure and lifecycle.** Disclose the download before Enable. If Chrome fails to start, select Transformers.js without downloading and require a second Enable, and keep that choice for the rest of the page session. After Stop, re-query availability so an installed Chrome model reads "installed". Report the lack of a WebGPU→WASM retry as a limitation.
- [x] **Verify.** `pnpm exec nx run @copilotkit/angular-demo:test --skip-nx-cache`, then `pnpm exec nx run @copilotkit/angular-demo:build`, run one after the other. Format the edited files with oxfmt. Update the README. Real-browser acceptance is left to the parent.

Validation (2026-11-01): the Nx demo test target passed 48/48 tests in 6 files with `--skip-nx-cache`; the Nx demo build passed with no Angular warnings afterwards. The tests mock inference; they say nothing about model output quality. No browser inference was run for these changes, and the earlier device results predate them.

### Parent-review regressions

- [x] **Shared components across Forms.** The gate used one global `seen` set, so a Button or layout subtree rendered by two sibling Forms counted only for the first. Visit each node once per nearest Form instead; that keeps cycle protection and the nearest-Form rule. Tests: helper cases for a shared Button, a shared layout subtree, an outside Button, a Form shared by two parents, and a cycle; an agent case that compiles and preflights three Forms sharing `submit` and `Row([submit])`.
- [x] **Prose detection.** `proseReply` recognised only catalog constructor names, so `Spacer(4)` and `Checkbox("Agree", true)` came back as answers. Any identifier directly followed by `(`, or a capitalised name followed by a literal argument, now counts as Express. Greetings and questions with parenthetical prose still count as prose. Tests: helper cases for unknown and wrong-case constructors, and an agent case where both reach compiler repair and the third attempt publishes.
- [x] **Download copy.** The UI now says "a multi-gigabyte first download". The "not yet measured" note stays in the README only.

### Chrome 156 integration findings (native-checkout.json, native-review-first.json)

- [x] **Action scope.** Chrome's `submit_order` answer had no `surface(...)` line and compiled to a new, empty surface. Action answers now pass `actionScopeProblem` before preflight and publication. Creating any surface, deleting the action surface, or changing another surface sends a repair diagnostic with the exact `surface(id, update=true)` line. Raw DSL is never relabelled. Action requests no longer advertise `newSurfaceId`, and their repair turn names the action instead of "the original request". Tests: the recorded root-only review is rejected and repaired; only the same-surface update is published, verbatim, and all six entered values survive. Helper cases cover deletion, another created surface, and another updated surface.
- [x] **Action-scoped guidance.** The route's unconditional `connectAgentContext` review text leaked into creation, which produced a "Review your order" form. `CHECKOUT_GUIDANCE` is now passed to `configure`. The agent adds it to `context` only while answering an action whose name matches /order|checkout/i. Tests: the creation payload has no guidance or review text, `submit_order` gets it, and `plan_trip` does not.
- [x] **Creation guidance.** The creation instruction asks for every requested input and the requested submit label, one initialisation per bound path, fields only in the Form, and a review only in reply to the action. The teaching example adds a shipping address and lists every field only in the Form.
- [x] **Verify.** Run the Nx demo test and then the build, formatting with oxfmt first. Real Chrome/Transformers.js acceptance is left to the parent.

Validation (2026-11-01, after oxfmt): `pnpm exec nx run @copilotkit/angular-demo:test --skip-nx-cache` passed 58/58 tests in 7 files and exited 0. `pnpm exec nx run @copilotkit/angular-demo:build` then exited 0 with no Angular warnings. Inference is mocked, and no browser inference was run.

Validation (2026-11-01, after oxfmt): `pnpm exec nx run @copilotkit/angular-demo:test --skip-nx-cache` passed 55/55 tests in 7 files and exited 0. `pnpm exec nx run @copilotkit/angular-demo:build` then exited 0 with no Angular warnings. Inference is still mocked, and no browser inference was run.

### Chrome and Transformers.js findings (native-review-final.json, transformers-checkout-current.json)

Fresh browser receipts against `f9a42e8ecc`: the native checkout passed on the first attempt (6.9 s, seven fields, each once). The native review updated the right surface and kept all seven values, but `Text($/gift)` over `true` rendered "invalid props (text: Invalid input)". Transformers.js Qwen3.5-4B failed after three attempts (96 s): `variant="text"`, then the same missing-surface diagnostic twice. Only attempt 3's DSL is recorded: `surface(newSurfaceId, update=true)` and `root = mainCard`.

- [x] **Bound display content.** Preflight now gives the isolated manager the page's owned values from `manifest.surfaces[id].dataModel` (via public `setOwnedValue`). `display-check.ts` resolves the content prop of each Text, Title, Caption and Badge under `root` with public `tryResolveDynamicValue` and checks it with the catalog's props schema (`validateSchemaSync`). The diagnostic names the component, path and actual value, keeps the value unchanged, and offers `formatString("…${/path}")` or a string label. It skips templates, unset paths and functions that fail on empty fields, and ignores input bindings. No private imports or core changes.
- [x] **Creation phase.** Each request's instruction names its phase from the manifest's live surfaces: CREATE, CREATE or UPDATE (live ids listed), or UPDATE for an action. The missing-surface hint depends on the scope: a new view, with the live ids if there are any, or the action's surface. Every repair of a new view repeats "write no surface(...) line". The compiler diagnoses `root = otherVariable`, which the official compiler treats as an update because no component has id `root`.
- [x] **Signature reminders.** Catalog-derived: TextField `variant` values (omit for plain text), Text/Title `fontWeight` versus layout `weight`, Card's parameters. The prompt teaches `formatString` for non-text values and that `update=true` needs an existing id. A TextField `variant` repair hint was added.
- [x] **Review guidance.** The checkout guidance asks for a summary only, with no Button or action the shop has not defined. Nothing is hardcoded.
- [x] **Tests.** These replay recorded model output, and the repairs that follow it are scripted: Chrome's boolean Text review (rejected with the user's `true`, published once to the action surface, all seven values kept, `/gift` still `true`); Transformers' update-on-create, ending in a `createSurface`; new-view repair text on every attempt; a legitimate existing-view update in one attempt; Text over a number and unset paths pass, while a number in a Title is rejected; phase-specific hints; catalog reminders; `formatString` compilation; a root alias.
- [ ] **Browser acceptance** of these changes in native Chrome and Transformers.js. Owned by the parent.

Validation (2026-11-01, after oxfmt): `pnpm exec nx run @copilotkit/angular-demo:test --skip-nx-cache` passed 71/71 tests in 7 files and exited 0. `pnpm exec nx run @copilotkit/angular-demo:build` then exited 0 with no Angular warnings. Inference is mocked or replayed from recordings, and no browser inference was run for these changes.

Final Opus implementation acceptance (2026-11-01, code 74bf17c932):

- Nx demo tests 73/73 and demo build passed; local commits only, no pushes.
- Real native Chrome card rendered after 2 attempts/32.0s; native shopping sample failed 3 attempts/23.4s.
- Real Qwen4B WebGPU fallback with Prompt API absent generated all8controls in a usable Form after3attempts/96.6s, but omitted total53. All8edited values matched review_order payload.
- Review failed3attempts/113.9s; syntax, booleanBadge and wrongsurface candidates were rejected. Original Form and8values preserved; surfacecount1.
- Actual Stop preserved preview/data, stagecancelled, engine downloadable and canEnable true; no backend3001requests.
- Model generation remains too slow/inconsistent for a flagship launch. No authored UI or edited model output was used. README separates final results from historical receipts and scripted unit repairs.

## Gemma 4 E2B: Unsloth Studio data generation and LoRA

User direction: target the smallest Gemma 4 already proven in the browser (E2B), install Unsloth through Homebrew, use Studio Data Recipes to discover failing examples, and use LoRA for training. All repository changes remain unstaged and uncommitted; no pushes.

- [x] Install the Homebrew Unsloth desktop cask without replacing the older manual app or removing its data. Start the Studio backend on loopback port 8898, confirm healthy status and Apple Silicon/MLX detection. Installed version: 0.1.913-beta.
- [x] Complete first-login setup and verify E2B training support on Apple Silicon/MLX. Browser control was enabled and the actual browser worker prompt was inspected.
- [x] Configure local Studio Data Recipes using the Gemma 4 26B-A4B llama.cpp teacher at 127.0.0.1:5802. The inference model shipped in the demo remains Gemma 4 E2B in Transformers.js. The teacher service must be restored after the interruption before further recipes run.
- [ ] Build a Studio Data Recipe from known Express failures and sampled scenario categories: missing/duplicated fields, invalid signatures/enums, unreachable components, dead submit buttons, wrong surface updates, lost values, boolean display text, and price/currency drift. Use synthetic inputs only. Preview a bounded batch before scaling.
- [ ] Replay generated briefs against the pinned browser E2B checkpoint using the real prompt contract. Save original first-attempt DSL, compiler feedback, model/revision/settings, requested content, and browser interaction checks. Keep quantized-browser failures distinct from teacher/GGUF failures.
- [ ] Produce verified corrected answers with the actual Express compiler and component graph checks, then real-browser binding/submit/value-preservation checks for form/action scenarios. Studio's generic code linters do not validate A2UI Express; the repository validator is authoritative.
- [ ] Export a clean training dataset and an independent evaluation split grouped by scenario family. Invalid DSL is input evidence only, never a positive assistant training target. Include clean baseline tasks alongside hard cases. Start with a pilot; scale toward 2,000-5,000 verified rows only after coverage and output quality are established.
- [x] Configure and run a bounded E2B text-only LoRA pilot in Studio with thinking disabled and the browser-compatible chat template. Replacement job `job_20261101_183126_cc3ef45f` completed all 20 steps with a 32,768-token cap and saved adapters. Training loss 0.2018; validation loss 0.2063. Model quality remains a separate acceptance gate.
- [ ] Prove the merged-checkpoint -> text-only ONNX -> q4f16 -> real Chrome path, and compare first-pass correctness, request coverage, values/action integrity, latency and download size on held-out requests before changing the demo model pin.

Training and dataset generation must not introduce hosted inference into the browser demo. No publishing or model uploads are authorized.

Unsloth current progress (2026-11-01): Studio Data Recipes produced model-generated targets, with 23 bootstrap programs revalidated under the current SDK guide and split into 20 train / 3 evaluation rows. Their historical generation-prompt provenance is retained. Browser/training token templates match; explicit assistant-only labels were verified through Studio, with a maximum actual sequence of 5,961 tokens. The user approved a 32,768-token limit. Job `job_20261101_163120_5ede8bc1` was interrupted before a checkpoint; the replacement `job_20261101_183126_cc3ef45f` is running a 20-step, rank-8 pilot and saving every five steps. Complex shopping teacher targets remain excluded until compiler validation succeeds. First-login setup is complete. No staging, commits, pushes, model uploads or paid providers.

## Progressive Express-to-A2UI rendering revision

User correction: keep the existing model prompts and Express examples unchanged. Render model-derived A2UI widgets as incremental compilation makes them available, including root-last output. No staging, commits, or pushes.

- [x] Stop the interrupted implementation and restore its five edited source files to their exact pre-streaming state, preserving unrelated uncommitted work. Save the interrupted draft under ignored review artifacts.
- [x] Delegate the revised compiler/renderer implementation to actual Claude Opus, explicitly forbidding prompt and example changes.
- [x] Verify meaningful widget changes before model completion with the official compiler and native surface manager; cover partial tokens, final validation, values, retries, and cancellation.
- [x] Run demo tests and build through Nx; compare preserved prompt/example sources; restart the demo on port 4210 for the user's visual check.

The user elected to test streaming visually. Local browser automation remains disabled; do not bypass it or claim a fresh browser acceptance run. Fine-tuning remains on hold during this fix.

Streaming revision verification (2026-11-01): actual Claude Opus 5.5 implemented the revision and follow-up. Nx demo tests passed 112/112; targeted core surface manager tests passed 56/56; targeted Angular surface view tests passed 23/23; demo build passed. Tests use the real Express compiler/native manager and a gated local-model substitute, including root-last partial rendering, split tokens, a silent generator inside the throttle window, final timer cleanup, owned values, rollback, Stop/detach, and late old runs in the same thread. System prompt builders, model-request.ts, and express-examples.ts match the exact pre-streaming source snapshots. Browser visual acceptance is user-owned and remains pending. No staging, commits, pushes, or model-pin changes.

## Standard Express guide, without full UI examples

User request: remove full-form examples from the system prompt and use the standard Express guide. This explicitly supersedes the prior request to preserve the old prompt during the streaming fix. No staging, commits or pushes.

- [x] Use official ExpressPromptGenerator.generate() for both browser engines, with the selected catalog and supported protocol messages, without supplied examples.
- [x] Remove full canned registration reviews from action requests and references to the removed system examples; preserve actual surface state and update constraints.
- [x] Update current prompt documentation and distinguish historical browser/training receipts from the new guide.
- [x] Verify the demo tests/build and restart port 4210. New real-model browser acceptance remains user-owned; do not claim old receipts validate this prompt.

Standard guide verification (2026-11-01): Nx demo tests 111/111 passed and the Angular demo build passed. A canonical request export produced the SDK guide at 8,645 characters, SHA-256 374f43f6daeb8e1eda91d6843d46f73262fb10dbf8ab58c69f8938630aa88b8d, with no registration form or full-example sections. No new local-model browser acceptance was run; the user owns visual verification. No staging, commits or pushes.

Subsequent standard-guide verification: preserving catalog property descriptions expanded the real SDK guide to 18,126 characters, SHA-256 `2b0b389c765d474bff8f93c7e3187e03b21d1693b0f53e83d1a6ea0bf2828dd2`. A temporary observer confirmed the actual browser worker system message matched this output byte for byte. Nx demo tests passed 112/112 and the build passed. The real ONNX Gemma complex ten-input shopping baseline failed all three attempts with a syntax error; partial native widgets appeared during generation and were rolled back on final rejection. Receipts and screenshots are under `output/playwright/standard-express/`. This is failure evidence, not a successful launch demo. The exact shopping request is held out from training. Adapter quality and browser-compatible export remain unverified.

## Independent acceptance evaluation

- [x] Freeze 12 new acceptance requests plus the original browser shopping regression, with no target DSL and zero exact request overlap with training. Keep the three training-validation examples separate from acceptance.
- [x] Export the frozen requests using the actual demo SDK prompt generator and preserve benchmark/prompt hashes.
- [x] Add reproducible first-attempt Studio generation and paired scoring helpers. Use fixed generation settings, no automatic repairs, the same prompt, and the pinned base revision.
- [x] Complete the paired base/adapter compiler, content, binding and Form Event checks and report failures and regressions. Both models passed 0/12 acceptance cases and failed the separate shopping regression. The pilot has no measured first-pass acceptance improvement and misses the 90% gate. All 26 fresh outputs and exact diagnostics are saved in `output/finetuning/gemma4-e2b/standard-guide/evaluation-v1/`; actual adapter loading and matching base revision were verified. Keep the benchmark out of future training.
- [ ] Pass actual browser interaction, action-value preservation, streaming and quantized model checks before any model promotion. No staging, commits or pushes.

## Second Gemma training round

User request: use Unsloth Data Generation for more valid examples, retrain Gemma, keep the evaluation set separate and rerun it. No staging, commits or pushes.

- [x] Restore the local Gemma 4 26B teacher on loopback port 5802 and prepare 96 fresh briefs, balanced across cards, short forms, mixed forms and complex forms. Reserve 12 curriculum briefs for training validation; the 13 frozen acceptance/regression requests are excluded.
- [x] Generate targets through Studio Data Recipes, validate them with the unchanged compiler/content gate, and repair failures using actual diagnostics. Preview 15/16, bulk 80/81, final repair 1/1; 96 unique new valid programs from 98 actual model generations. Studio jobs: `336ec5b466364030bd5cd4979771b48a`, `dd9fb876af3c40c28a28c31ed08512f6`, `450802b086d94fe4ab9e43b8e5ae46c1`. No hand-authored or coerced target DSL.
- [x] Build 104 training / 15 validation rows with the canonical SDK prompt and browser template. Separation audit passed: frozen eval files unchanged, zero request/target overlap across training/validation, no teacher scaffolding in student inputs. All 119 rows fit the 32k cap (longest 5,961 tokens). Studio verified exact input IDs and answer-only masks on five fresh examples, including complex forms.
- [x] Train another bounded Gemma 4 E2B adapter with the 32k cap, preserving the original base and first pilot. Job `job_20261101_191636_5463d461` completed all 104 steps in 25.7 minutes; training loss 0.0621, training-validation loss 0.1116. Adapter saved under `~/.unsloth/studio/outputs/unsloth_gemma-4-E2B-it_1793557012`.
- [x] Rerun the unchanged acceptance/regression set against all three models with exact browser token IDs: base 0/12, first pilot 0/12, second round 9/12 (75%). New model passed 4/4 cards and 5/8 forms, including 1/2 complex checkouts. Three acceptance failures incorrectly initialized selects; the separate shopping regression omitted “Leaf & Light.” All 39 requests verified token parity; frozen evaluation hashes and content-grader hash unchanged. Comparison saved in `output/finetuning/gemma4-e2b/round2/round-comparison.json`. Browser pin unchanged; no staging, commits, pushes or model uploads.

Evaluation harness correction: the historical Studio chat endpoint reported 11,105 input tokens for a request that the pinned browser template renders as 5,246. All 26 historical calls differed; preserve them as historical diagnostics, not browser-prompt-comparable scores. The runner now sends exact browser token IDs through Studio's raw completions endpoint and refuses input-length or paired-token-hash mismatches. Rerun the untouched base and first pilot alongside the new adapter through this corrected harness. Frozen evaluation data and the actual compiler/content grader remain unchanged.

## Thousand-example Gemma training and browser export

User authorization: generate 1,000 diverse valid examples and 300 fresh blind evaluation cases using Unsloth, keep them separate, retrain Gemma and test the exported model in the browser. No staging, commits or pushes.

- [ ] Prove the MLX-adapter-to-browser export path using the existing pilot before the long training run. Preserve the browser-compatible ONNX graph, verify every adapted matrix mapping, quantize and test actual WebGPU loading.
- [ ] Generate diverse model-authored requests and compiler-validated programs through Studio Data Recipes: exactly 1,000 training examples plus an independent development split. Cover empty/provided/preserved state, optional fields, brand/content coverage, multiple item prices, varied request wording and layouts.
- [ ] Generate and seal 300 fresh blind cases through Studio, with independent scenario/template families. Freeze requirements and hashes before training. Never include blind requests or outputs in training, repairs or checkpoint selection; keep the original regression suite unchanged.
- [ ] Audit target provenance, duplicate/near-duplicate split leakage, exact SDK prompt, browser tokenizer/template parity, lengths and answer-only labels.
- [ ] Run bounded Gemma 4 E2B training with the 32k cap and development-only checkpoint selection. Preserve prior models and record model/data/config hashes.
- [ ] Export the selected adapter as a locally served q4f16 browser model, validate numerical/structural correctness and run the sealed browser evaluation using real WebGPU generation and native widgets. Check input state, bindings, submit events and streaming; save screenshots and raw results.
- [ ] Report first-attempt and any repair-assisted results separately, including failures. Verify the blind set stayed separate and git HEAD/index are unchanged.

## Gemma retraining with the earlier configuration (round4)

User direction: repeat the earlier successful hyperparameters. No staging, commit or push.

- [x] Preserve round2/round3 artifacts, compare the original training requests, and hold round3 training/development token files byte-identical (100/100 rows).
- [x] Start Studio job `job_20261101_225607_1676f408` from pinned Gemma 4 E2B base, using 4-bit QLoRA, rank 8 / alpha 16, learning rate 1e-4, earlier weight decay 0.001, batch/accumulation 1, one epoch and 32,768-token cap. Verify checkpoint-10 really has 4-bit affine base quantization, rank 8, scale 2 and 12,079,104 adapter parameters.
- [x] Preserve the incomplete round3 Chrome run (10 completed, 1 native pass) and stop its model before retraining.
- [x] Queue automatic development-only selection among saved checkpoints, the unchanged historical suite against both earlier rounds, a local ONNX export, and actual Chrome WebGPU evaluation. Repeated 300 held-out cases are marked not fresh; no cases or model failures enter training.
- [x] Correct supplemental price association resolution through SDK state; retain the frozen original validator byte-for-byte. Actual captured data-bound card and a teacher form pass; deliberately swapped and missing prices are rejected. These grader checks are excluded from training and model scores. Nx demo tests pass 115/115 and build passes.
- [ ] Finish training and freeze the checkpoint before reading its test output.
- [ ] Compare the unchanged historical evaluation; preserve any regressions.
- [ ] Complete and report actual Chrome results for the frozen export.

Live receipts: `output/finetuning/gemma4-e2b/round4/experiment.json`, `training/training-status.json`, `continuation-status.json`, and the browser evaluation page on port 4210. No new model has been promoted.

## Select the earlier fine-tune and curate working browser examples

User direction supersedes the round4 benchmark: select the second-round 9/12 adapter, retain failures, provide reliable example requests and a comparison switch for the original Gemma and Chrome Prompt API. No staging, commit or push.

- [x] Pin the exact round2 adapter hash as the default, verify every exported file and keep inference in-browser.
- [x] Replace unverified shopping/edit suggestions with four prose-only example buttons. Each starts a fresh conversation and invokes the real agent.
- [x] Verify the four selected examples in actual Chrome WebGPU: five first-attempt runs each, 20/20 creation/compiler/control/edit/submit checks, without repairs. Keep this curated result separate from broader model quality and preserve rejected trials.
- [x] Exercise the actual book-delivery button: same model hash, byte-identical SDK guide and creation request, first-attempt success; all eight entered values reached owned state and the native submit payload.
- [x] Preserve the follow-up failure: the model-generated book review failed all three attempts on unsupported string concatenation. This is excluded from the 20/20 creation score and documented as a limitation.
- [x] Add explicit fine-tuned/original/Chrome modes, destroy old sessions on switch and never silently substitute another model. Chrome Prompt API actually rendered the aquarium example on its first attempt.
- [x] Nx demo tests passed 119/119 and the Angular build passed after selector changes.
- [x] Verify live original-Gemma loading and inference with the exact same initial guide/request as the fine-tune; preserve rejected Card/Form candidates and stop its third repair. No completed baseline quality score is claimed.
- [x] Leave the selected fine-tune ready in Chrome after the comparison: actual first-attempt book creation, exact tested guide/request and eight owned edits verified again. Selector and Prompt API screenshots are preserved.

Evidence: `output/finetuning/gemma4-e2b/demo-target/curated-verification.json`, preserved per-run browser reports, main-app debugger captures and screenshots. Historical evaluation files and the frozen validator remain unchanged.

## Firebase Express-only demo and short blog article

User authorizes a new Firebase demo, containing only A2UI Express, and an explanatory article. No commit or push.

- [ ] Build a separate static Angular entry point containing only the Express demo, the same standard catalog and the three model modes.
- [ ] Package the exact selected fine-tune as same-origin immutable assets; remove private filesystem metadata and verify hashes/size limits.
- [ ] Run appropriate Nx tests/build and validate the standalone browser experience before deployment.
- [ ] Create a separate Firebase project/site using the already authenticated account, deploy only the dedicated output, and verify the live site.
- [ ] Write and verify a short private article covering Express syntax/benefits, browser flow, Unsloth training method and measured results with clear limits.

## Compact Soverius Express workbench

User requests a compact header with the official Soverius AI logo/home link, aligned controls, expandable panels and highlight.js highlighting for Express. No commit or push.

- [x] Inspect the current layout and retrieve the official logo from soverius.ai.
- [x] Remove the hero description and fit the workbench into the available viewport; align model controls.
- [x] Add expansion/restoration for every panel without destroying native surfaces or entered values.
- [x] Add an isolated highlight.js Express grammar and read-only highlighted source display; preserve raw output and escape HTML.
- [x] Collapse the debugger by default, shorten the chat placeholder, add newsletter/blog links and highlight Compiled JSON, Agent state and Form data.
- [x] Add links to the official Express developer guide and syntax specification; keep the colour palette independent of chat theme insertion.
- [x] Run the Nx build/tests, verify layout/expansion/highlighting and real generation in Chrome, redeploy Firebase and capture screenshots.

Compact workbench verification (2026-11-02): 137/137 Nx tests passed and the final production build/package/deployment succeeded. The public site shows the official Soverius logo, newsletter/blog links, Express guide and syntax reference. At 1575×666 the page has no vertical overflow, header controls align at 35px and the debugger defaults to 42px. A fresh real WebGPU Gemma run generated Book Delivery on its first attempt, with native widgets visible at 606/1087 source characters before completion. Express colours remain vivid after chat's global styles mount. All three JSON views parse after highlighting; all eight edited fields survive expansion/restoration of each of the four panels. Receipts and screenshots: `output/ui/a2ui-compact/verification.json`. HEAD unchanged; index empty; no code commit or push.

## General Express follow-up guidance

User now requests general system guidance and 2–3 small teaching examples to improve browser-model follow-ups. This supersedes the earlier no-examples preference; no full domain-specific forms, no authored runtime answers, no commit or push.

- [x] Supply three generic micro-examples through the official SDK generator and teach Form argument order, patch-only updates, preserved values and dynamic text.
- [x] Reproduce the reported Form(Event(...)) failure and validate the lessons and follow-up state preservation with the real compiler/native manager. Ordinary chat follow-ups now also carry current user-owned values as run data.
- [x] Run Nx tests/build, deploy, and test real browser-model creation and follow-ups; report measured results and remaining failures.

Release gate from the user's follow-up: keep subsequent prompt revisions local until the fine-tuned Gemma produces a real successful follow-up preserving the entered values, and the original Gemma produces a real card. The first public prompt extension failed all three fitting-review attempts with unsupported string concatenation; preserve that failure. Teach complete quoted text and separate component declarations, validate the local candidate first, then deploy only a passing candidate. Compiler acceptance and scripted tests alone do not satisfy this gate.

Local evidence so far: candidate 1 failed three follow-up attempts with Text's second positional argument in the children slot. Candidate 2 produced a syntactically valid summary but omitted the root update, so it was invisible despite stage=ready; the original model added an unwanted Form to the card. Neither meets the gate. Candidate 3 removes unconditional Form priming from creation requests, explicitly distinguishes display cards from input forms, and rejects unattached new components on action completion so the model must repair its own root assignment. No automatic DSL edits or fallback UI.

Final acceptance (2026-11-02): candidate 4 keeps the SDK guide plus three generic lessons, SHA-256 `e98a79083ebf8751b777c70773c022a2373dccb3d15806de1a5ccba9193a117c` (21,964 characters), identical for both Gemma variants. Action requests now carry factual prices and submitted values without repeating the old creation imperative. Actual Chrome WebGPU checks on the exact local build passed: original Gemma's Aquarium card first attempt with zero controls; fine-tuned Gemma's Fitting form and visible submit follow-up first attempts, with all four edited values and original root children retained. The review generated in 39.297 seconds. 145/145 Nx tests and production build/package passed. Only after those real browser checks, the unchanged 73-file build was deployed to Firebase; the live index, entry scripts and browser-visible prompt match the tested bytes. Receipts/screenshots and failed earlier generations: `output/ui/a2ui-followups-2026-11-02/verification.json` and `publication-gate.json`. These targeted checks do not establish arbitrary-prompt reliability. HEAD unchanged, index empty, no code commit or push.

## Reported EOF on form follow-ups

User reports `mismatched input '<EOF>' expecting {',', ')'}` on fine-tuned form follow-ups. No commit or push; test any next candidate locally before deployment.

- [x] Verify the live index is the published tested build and the deployed fine-tune loads. A fresh live Aquarium generation passed first attempt in 29.496s; this does not reproduce the reported form failure.
- [x] Reproduce chat follow-ups, submit actions and repeated form interactions; preserve raw DSL, actual input values and diagnostics. Published Book Delivery Review repeats the user's EOF failure (line 2:311); a later local repeat replaces input ids with Text and drops the Form. Receipts are retained under `output/ui/a2ui-eof-2026-11-02/`.
- [x] Fix the identified cause with compiler/native-state regression checks, preserving raw generated output and entered values. Unpublished candidate: actionable EOF feedback, one price per reference line, current root state for chat additions, fresh result namespaces avoiding all occupied ids, and native checks protecting existing root children, Forms and inputs during streaming and completion. Existing ids include their actual component types; new displays must use constructors, including prices. No generated DSL rewriting or authored fallback. 156/156 Nx tests and production build/package passed; real browser acceptance is still in progress.
- [x] Pass real fine-tuned follow-up and original-Gemma card checks locally before uploading any next revision. Typed-component candidate: fitting submit attempt 2, shopping submit attempt 2 and changed-value repeat attempt 1, original Gemma Aquarium card attempt 1. Native controls and every submitted value were verified; fitting fee and shopping prices remain visible. The unchanged 73-file build was then deployed and all live files matched the tested hashes (`main-5ATGM5JQ.js`). Gate/receipts: `output/ui/a2ui-eof-2026-11-02/`. No commit or push.

Additional local evidence: the first preservation candidate passed both eight-field shopping submits (attempts 2 and 1) but dropped the fitting fee. The root-preservation candidate correctly rejected that fee defect on all three retries and was not deployed. Raw failures remain alongside successes. The tested Book Delivery creation still omitted its prices from root; the submit reviews did show them. These are targeted submit-flow checks, not an arbitrary-prompt or complete semantic-coverage success rate.

Post-deploy browser check: the live page loads `main-5ATGM5JQ.js`, the same 21,964-character SDK guide/hash and pinned fine-tune. A real live Aquarium generation passed first attempt in 28.103s, with all facts and no controls. The public result is left open; local test tabs and the owned Hosting emulator were closed. HEAD remains `bbc3f036cdfff8fe23187739560606cd3be8adaa`, index empty.
