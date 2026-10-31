# Angular demos

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec nx run @copilotkit/angular-demo:dev
```

Open <http://localhost:4200/a2ui-1.0> for the browser inference demo. This route needs no demo server or cloud API key. Other routes use the runtime described in [the demo server README](../demo-server/README.md).

## A2UI 1.0 Express in Chrome

1. Open the route in eligible desktop Chrome on localhost or HTTPS. The page checks the Prompt API and reports whether the model is installed, downloadable, or unavailable. See [Chrome requirements](https://developer.chrome.com/docs/ai/prompt-api).
2. Select **Enable local model**. Chrome downloads Gemini Nano when needed; the page shows progress. The first model download needs a network connection.
3. Ask for a small interface, for example “Create a trip planning form with a name field and a submit button.” CopilotKit supplies the conversation, app context, catalog, surface context, and actions. Its UI guide is composed with the official catalog-derived Express contract and examples in the Chrome session's system prompt. This is in-context learning.
4. Inspect the streamed Express source. After the response finishes, the official compiler produces validated A2UI v1.0 operations and CopilotKit renders native Angular components in the preview.
5. Edit a form field and submit it. CopilotKit sends the action and current surface context into another local model run. Inspect **Agent state** for the action, DSL, operations, diagnostics, and timings, or **System prompt** for the exact language contract supplied to Chrome.
6. Use **Stop** to cancel inference and **Reset** to clear the conversation, surfaces, and model session. Model sessions are also released when leaving the route.

**Card**, **Bound form**, and **Compile & render** exercise the same compiler and agent activity path without inference. They work when the Prompt API is unavailable. In the bound form, type a name and select **Apply data update**: its status changes while your name remains intact. Preset/manual runs are labeled separately from model generation. No cloud fallback is used.

A2UI v1.0 is currently a release candidate. Keep examples small: the local agent limits output to 60,000 characters and run context to 28,000 characters. It uses fresh clones of a system-prompt session so CopilotKit remains the sole owner of conversation history. Only the completed, validated compiler output changes the preview; invalid or cancelled responses preserve the previous UI.

### Debug transport

The browser-local `ChromeExpressAgent` emits `STATE_SNAPSHOT` and throttled `STATE_DELTA` events under `state.a2uiExpress`. The workbench reads this state through `injectAgentStore`. Rendered UI is carried separately in standard `generative-ui-surface` activity events. A bounded last-successful DSL context is explicitly selected for follow-up inference; the entire debug object is not automatically sent to the model.

The Express SDK is lazy-loaded. Its pinned package patch adds a browser-only Express export that excludes Node filesystem utilities, and makes data-path assignments in update scopes produce targeted `updateDataModel` messages rather than replacing sibling data. See [the patch](../../../../patches/@a2ui__agent@0.0.2.patch). The compiler tests cover creation, bindings, events, invalid source, and targeted updates.

### Verification

```sh
pnpm exec nx run @copilotkit/angular-demo:build
pnpm exec nx run @copilotkit/angular-demo:test
```

The adapter tests substitute the Prompt API to verify lifecycle and cancellation. They do not establish Gemini Nano availability or output quality on a device; verify a real generated response in eligible Chrome separately.
