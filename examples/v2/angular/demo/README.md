# Angular demos

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec nx run @copilotkit/angular-demo:dev
```

Open <http://localhost:4200/a2ui-1.0> for the browser inference demo. This route needs no demo server or cloud model key. Other routes use the runtime described in [the demo server README](../demo-server/README.md).

## A2UI 1.0 Express with browser inference

1. Open the route on localhost or HTTPS and select **Enable local model**.
2. The app prefers Chrome's built-in Prompt API. If the API is absent, reports unavailable, or cannot start, it automatically selects Transformers.js and downloads an LLM into the browser. The page shows the actual engine, model, device, and download progress.
3. Describe a card, shopping interface, or form in the CopilotKit conversation. Suggestions send natural-language prompts to the model. There are no manually rendered presets, editable-source execution controls, or canned action acknowledgements.
4. CopilotKit supplies conversation history, application context, surface data, and actions. Its UI guide is composed with the official catalog-derived Express contract and few-shot examples in the system prompt. These examples teach the language; the page never executes them as a response.
5. The model streams Express into AG-UI agent state. After generation completes, the official compiler validates A2UI v1.0 operations, and CopilotKit renders native Angular components.
6. Edit a generated input and invoke its action. The actual values return to the local model, which is instructed to update the existing surface and preserve the inputs. **Form data**, **Agent state**, **System prompt**, and **Compiled JSON** expose each part of the flow.
7. **Stop** cancels a download or generation and releases the model. Enable it again to continue. **Reset** also clears the conversation and surfaces. Leaving the route releases sessions and workers.

### Transformers.js fallback

The fallback uses `@huggingface/transformers` 4.3.2 inside a module Web Worker. The heavy runtime and model weights are loaded only after the user enables the model. No hosted inference endpoint is used; Hugging Face and runtime asset hosts supply downloadable files only.

- WebGPU: [Qwen3.5-4B-ONNX-OPT](https://huggingface.co/onnx-community/Qwen3.5-4B-ONNX-OPT), using `q4f16` when the adapter supports half precision and `q4` otherwise.
- WASM: [Qwen3.5-0.8B-ONNX-OPT](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT), using `q4` and one thread so cross-origin isolation headers are not required. CPU generation is slower.

Model revisions are pinned in `transformers-protocol.ts`. The optimized export limits generation logits to the final token, avoiding the full-prompt logits allocation of older exports. Downloads are substantial and need a network connection on first use; Transformers.js uses the browser cache for subsequent loads. Availability and performance depend on browser memory and hardware. See the [Transformers.js WebGPU guide](https://huggingface.co/docs/transformers.js/guides/webgpu).

Cancellation terminates the worker immediately, including an in-flight download or prompt prefill. Request IDs reject stale worker messages. The native adapter uses per-run clones of a system-only session; both adapters receive CopilotKit's history once per inference.

### Compilation and debugging

A2UI v1.0 is currently a release candidate. The demo caps generated output at 60,000 characters, run context at 28,000 characters, and Transformers.js generation at 3,072 new tokens. Its focused catalog omits unused presentation properties and long descriptions to leave room for generation. The legacy A2UI v0.9 and sandbox feature configuration are omitted on this route.

Responses get up to three generation attempts. Compiler failures return the rejected DSL and diagnostic to the model as a repair request. Only complete, validated operations change the preview. Invalid or cancelled responses preserve the previous UI; malformed forms without submit events are rejected. Models can still fail to produce correct DSL or satisfy every requested detail. The demo reports the failure without substituting authored UI.

The browser-local `ChromeExpressAgent` emits `STATE_SNAPSHOT` and throttled `STATE_DELTA` events under `state.a2uiExpress`, including the selected engine/model, raw DSL, compiler feedback, timings, and action. The workbench reads this state through `injectAgentStore`. Rendering uses standard `generative-ui-surface` activity events. A bounded last-successful DSL context is explicitly selected for follow-up inference; the entire debug state is not automatically included.

The official Express SDK is lazy-loaded. Its pinned patch exposes a browser-safe Express entry point and preserves sibling values during data-path updates. See [the patch](../../../../patches/@a2ui__agent@0.0.2.patch).

### Verification

```sh
pnpm exec nx run @copilotkit/angular-demo:build
pnpm exec nx run @copilotkit/angular-demo:test
```

Unit tests cover engine selection, native-startup fallback, cancellation without unintended fallback, worker download/streaming/disposal, stale messages, compiler repair, model-only rendering, action transport, and cumulative surface updates. These tests substitute inference and do not establish model output quality. Real browser generation must be checked separately.

### Testing with real Chrome

Use installed, headed Google Chrome. Some automation launchers disable `OptimizationHints`, background networking, or component updates, making the native API report unavailable on eligible hardware. Launch a dedicated profile normally and attach automation over CDP. On macOS:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir=/tmp/copilotkit-chrome-prompt-api \
  --remote-debugging-port=9223 \
  --no-first-run \
  http://localhost:4200/a2ui-1.0
```

Use the dev server's actual port (4210 during verification). The profile is separate from your usual Chrome profile. Select **Enable local model** and wait for **Model enabled** before sending a prompt. Native setup requirements are documented in the [Chrome Prompt API guide](https://developer.chrome.com/docs/ai/prompt-api).

```sh
npx --package @playwright/cli playwright-cli -s=browser-model open \
  http://localhost:4200/a2ui-1.0 \
  --config=examples/v2/angular/demo/chrome-prompt-api.config.json
```

To verify the fallback, use a browser without `LanguageModel`, or disable that global with a test-only initialization script before navigation. Assert the absence of the API, a Transformers.js backend in agent state, real model downloads, model-generated DSL, compiled operations, rendered controls, and actual action values. Do not replace the model with a stub for this browser acceptance check.
