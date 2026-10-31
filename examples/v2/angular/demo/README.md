# Angular demos

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec nx run @copilotkit/angular-demo:dev
```

Open <http://localhost:4200/a2ui-1.0> for the browser inference demo. This route needs no demo server or cloud API key. Other routes use the runtime described in [the demo server README](../demo-server/README.md).

## A2UI 1.0 Express in Chrome

1. Open the route in eligible desktop Chrome on localhost or HTTPS. The page checks the Prompt API and reports whether the model is installed, downloadable, or unavailable. See [Chrome requirements](https://developer.chrome.com/docs/ai/prompt-api).
2. Select **Enable local model**. Chrome downloads its configured local model when needed; the page shows progress. The first model download needs a network connection.
3. Ask for a small interface, for example “Create a trip planning form with a name field and a submit button.” CopilotKit supplies the conversation, app context, catalog, surface context, and actions. Its UI guide is composed with the official catalog-derived Express contract and examples in the Chrome session's system prompt. This is in-context learning.
4. Inspect the streamed Express source. After the response finishes, the official compiler produces validated A2UI v1.0 operations and CopilotKit renders native Angular components in the preview.
5. Edit a form field and submit it. CopilotKit sends the action and current surface context into another local model run. Inspect **Agent state** for the action, DSL, operations, diagnostics, and timings, or **System prompt** for the exact language contract supplied to Chrome.
6. Use **Stop** to cancel inference and **Reset** to clear the conversation, surfaces, and model session. Model sessions are also released when leaving the route.

**Card**, **Bound form**, and **Compile & render** exercise the same compiler and agent activity path without inference. They work when the Prompt API is unavailable. In the bound form, type a name and select **Apply data update**: its status changes while your name remains intact. Preset/manual runs are labeled separately from model generation. No cloud fallback is used.

**Shopping checkout** adds contact and address fields, country selection, quantity sliders, delivery choices, gift wrapping, a promo code (`SAVE10`), notes, consent, and a live total. **Project brief** adds a role dropdown, date picker, budget slider, contact choices, notes, and validation. Both open in an expanded native preview; **Show editor** restores the DSL alongside it. **Form data** shows the live surface model as you type.

The manual forms validate before submission and acknowledge their demo actions locally through the same agent/compiler/activity path. Checkout previews an order; the project brief is retained for the current browser session. No order is placed or form sent to a service. Model-generated form actions continue through model inference.

A2UI v1.0 is currently a release candidate. Keep examples small: the local agent limits output to 60,000 characters and run context to 28,000 characters. It uses fresh clones of a system-prompt session so CopilotKit remains the sole owner of conversation history. Only the completed, validated compiler output changes the preview; invalid or cancelled responses preserve the previous UI.

Model responses get up to three generation attempts. If compilation fails, the agent sends the rejected DSL and compiler diagnostic back to the local model as a follow-up conversation and asks it to repair the response. The debug panel shows the attempt number; `compilerFeedback` in agent state retains the rejection history. Manual source edits compile once and show their diagnostic directly.

The Express contract uses a focused subset of the native catalog's properties and omits long property descriptions to leave room for model output. Its fields, enum values, argument order, and validation still derive from the real catalog. The route also omits the legacy A2UI v0.9 and sandbox feature configuration, whose unrelated schemas and JSON generation instructions would otherwise enter the local agent's context.

### Debug transport

The browser-local `ChromeExpressAgent` emits `STATE_SNAPSHOT` and throttled `STATE_DELTA` events under `state.a2uiExpress`. The workbench reads this state through `injectAgentStore`. Rendered UI is carried separately in standard `generative-ui-surface` activity events. A bounded last-successful DSL context is explicitly selected for follow-up inference; the entire debug object is not automatically sent to the model.

The Express SDK is lazy-loaded. Its pinned package patch adds a browser-only Express export that excludes Node filesystem utilities, and makes data-path assignments in update scopes produce targeted `updateDataModel` messages rather than replacing sibling data. See [the patch](../../../../patches/@a2ui__agent@0.0.2.patch). The compiler tests cover creation, bindings, events, invalid source, and targeted updates.

### Verification

```sh
pnpm exec nx run @copilotkit/angular-demo:build
pnpm exec nx run @copilotkit/angular-demo:test
```

The adapter tests substitute the Prompt API to verify lifecycle and cancellation. They do not establish local model availability or output quality on a device; verify a real generated response in eligible Chrome separately.

### Testing with real Chrome

Use installed, headed Google Chrome. Some automation launchers disable `OptimizationHints`, background networking, or component updates. That can make the Prompt API report `unavailable` on eligible hardware. Launch Chrome normally with its own temporary profile and attach automation over CDP instead of using those launcher defaults. On macOS:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir=/tmp/copilotkit-chrome-prompt-api \
  --remote-debugging-port=9223 \
  --no-first-run \
  http://localhost:4200/a2ui-1.0
```

Use the port reported by the demo dev server (4210 during verification). This profile is separate from your usual Chrome profile. In the page, select **Enable local model** and wait for **Model enabled** before sending a prompt. Chrome downloads the model on first use. `chrome://on-device-internals` → **Broker State** shows the model assets, hardware eligibility, and `prompt_api` availability.

To attach Playwright CLI to that running Chrome:

```sh
npx --package @playwright/cli playwright-cli -s=nano open \
  http://localhost:4200/a2ui-1.0 \
  --config=examples/v2/angular/demo/chrome-prompt-api.config.json
```

Real-device verification on 2026-10-31 used Chrome 156.0.8078.74 on an Apple M1 Max. Chrome downloaded `nano_v3_gpu_high_tier_model` and reported the Prompt API available. A natural-language card request produced model-generated Express, valid v1.0 operations, and native Angular UI in 7.6 seconds on its first generation attempt. The original verbose system contract used 7,257 of the device's 9,216 context tokens; the focused contract uses approximately 3,719, leaving more room for forms and compiler feedback.

The **Shopping inputs** suggestion also generated valid Express on its first attempt in 10.4 seconds. Its native interface contained two products, a literal $53 total, five text inputs, a delivery dropdown, gift checkbox, notes, and a review button. Editing all eight values and clicking **Review order** delivered every value in the `review_order` action context. This uses a direct button event rather than a `Form` submit event. The generated view omitted the requested initial data assignments; its bindings populated the surface data model when edited.

Local model output remains unreliable for larger requests. Full `Form` generation repeatedly omitted `onSubmit`, and the review action's follow-up response failed compilation after three attempts. The populated shopping view and its inputs stayed intact. The experimental Gemma 4 Chrome flag also failed this DSL task and was restored to its default. These results establish actual local generation and action delivery, not dependable multi-turn form generation. The richer checkout and project presets are separately authored examples.
