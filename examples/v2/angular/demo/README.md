# Angular demos

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec nx run @copilotkit/angular-demo:start -- --port 4210
```

Open <http://localhost:4210/a2ui-1.0> for the browser inference demo. This route needs no inference server or cloud model key. The selected fine-tuned weights are served as static files from the local model server described below. The route is detected relative to the document `<base href>`, with or without a trailing slash; on that route the app omits the runtime URL and the legacy A2UI and sandbox context. Other routes use the runtime described in [the demo server README](../demo-server/README.md).

## A2UI 1.0 Express with browser inference

1. Open the route on localhost:4210. Before you enable anything, the page states what will download. Select **Enable local model**, or **Download & enable** when the selected engine still has to download its model.
2. The app selects Gemma 4 E4B (`onnx-community/gemma-4-E4B-it-ONNX`, pinned revision, 4.9 GB of q4f16 text weights) through Transformers.js. Use the Inference model selector to compare it with the Gemma 4 E4B Express fine-tune (`e4b-pilot2s40-d53063f5f606`) or Chrome Prompt API. Chrome runs its own built-in model. Nothing loads until you enable the model. The page shows the actual engine, model, device and download progress.
3. Describe a card, shopping interface, or form in the CopilotKit conversation. Suggestions send natural-language prompts to the model. There are no manually rendered presets, editable-source execution controls, or canned action acknowledgements.
4. CopilotKit supplies conversation history, application context, surface data, and actions. The system prompt is the A2UI SDK's `ExpressPromptGenerator` output for the demo's components (see [Standard Express prompt](#standard-express-prompt)); both browser engines receive it unchanged. Each request adds its actual task and the canvas it changes: the live views' Express and current input values.
5. The model streams Express into AG-UI agent state, and the SDK's streaming parser grows the native preview while it streams (see [Progressive rendering](#progressive-rendering)). After generation completes, the SDK parses the whole response against the committed surfaces, and CopilotKit commits the native Angular view. A rejected response goes through [Express error recovery](#express-error-recovery). A reply with no `<a2ui>` block, for example to "hi", is shown as the model's prose answer (stage `answered`). It publishes no UI, and an action never accepts one.
6. Edit a generated input and invoke its action. The actual values return to the local model as quoted data, with the view's Express and current values, and the model is asked to show the outcome in that view. The route registers checkout guidance with the agent: an order review card next to the form, as a summary only, with no Button or other action the shop has not defined. The agent adds it to the run context only when it answers an action whose model-chosen name mentions an order or checkout (`review_order`, `submit_order`, …), or is a bare `review`, `submit` or `confirm` from a view whose request mentions a checkout or cart, so it cannot shape the first form and `review_article` never matches. That guidance is guidance only; the model still writes the UI. **Form data**, **Agent state**, **System prompt**, and **Compiled JSON** expose each part of the flow.
7. **Stop** cancels a download or generation and releases the session. The page then asks the engine for its availability again, so an installed Chrome model reads as installed. Enable it again to continue. **Reset** also clears the conversation and surfaces. Leaving the route releases sessions and workers.

### Selected fine-tuned model

The default is the step-40 adapter of the second Gemma 4 E4B run, SHA-256 `d53063f5f606317cd9db5dd4bfc904e034d7f73a06b068155607459acc819fe2`, merged into the pinned fused ONNX graph and quantized to `q4f16`. The selector also offers the step-100 adapter of the E2B run on the same rows, SHA-256 `eff96be9f058aec7993a0b1618d1d20c60eb4519d54f54c2352865ad297490f2`, as `e2b-mlx1s100-eff96be9f058`; its 3.1 GB text sessions answer in about half the time of the 4.9 GB E4B ones. The worker checks each adapter's identity before loading it. Both exports require WebGPU with `shader-f16`. An unavailable export or unsupported GPU reports an error; no base model, smaller model or Chrome-managed model is substituted.

The exports live on the external model disk. From the repository root, serve them with:

```sh
python3 examples/v2/angular/demo/finetuning/gemma4-e2b/serve-browser-export.py \
  --model e4b-pilot2s40-d53063f5f606=/Volumes/DockerData/models/a2ui-e4b-lora/pilot2-step40-browser-model \
  --model e2b-mlx1s100-eff96be9f058=/Volumes/DockerData/models/a2ui-e2b-lora/mlx1-chunkedce-step100-browser-model
```

The file server listens only on `127.0.0.1:8899`; it performs no inference. Its browser origin allowlist currently permits the demo on port 4210. Start Angular with `pnpm exec nx run @copilotkit/angular-demo:start -- --port 4210`, then open `http://localhost:4210/a2ui-1.0`. The model is selected without a query parameter. Explicit local experiment URLs using `?gemmaExport=...` remain available for comparison when their artifact is served.

An export id carries the Gemma 4 size and the first twelve hex digits of its adapter's SHA-256; the Studio E2B rounds predate that convention and are served as `--model round2-0cf5af05c20f=<round2-browser-model>`, which the app loads as `local/gemma-4-e2b-round2-0cf5af05c20f`. Opening `http://localhost:4210/a2ui-1.0?gemmaExport=<id>` makes the fine-tuned mode load that export; the worker expects a manifest for the id's base and adapter family (`e4b-` ids: `unsloth/gemma-4-E4B-it` with 300 patched matrices; `e2b-` ids: `unsloth/gemma-4-E2B-it` with 240, as `mlx_lm` adapts every projection; `round…` ids: the Studio adapters' 170). All exports are produced by [`export-browser-adapter.py`](finetuning/gemma4-e2b/export-browser-adapter.py), which merges a Studio or `mlx_lm` LoRA into the pinned `onnx-community` graph's weights after checking each fp16 matrix against the Hugging Face base, and requantizes only those matrices.

`@huggingface/transformers` runs the text-only model inside a module Web Worker. The SDK generates the grammar and signatures. Generation is greedy (`do_sample: false`), thinking is disabled, and output is capped at 3,072 new tokens. Every example button sends prose through the same CopilotKit agent; no DSL response is stored or replayed as the displayed UI. Curated example checks are demonstration checks, not independent evidence of general model quality.

Cancellation terminates the worker. Request IDs reject stale worker messages. Leaving the route releases the session. Local development uses the static export server above. The separate [Express-only Firebase build](deployment/README.md) supports loading the selected model from a pinned public Hugging Face revision, with its adapter identity checked before inference. It can also bundle the export for same-origin hosting.

### Model comparison

The selector offers four explicit modes:

| Mode                         | Model                                   | Inference                            |
| ---------------------------- | --------------------------------------- | ------------------------------------ |
| Gemma 4 E4B (default)        | Pinned Gemma 4 E4B, without fine-tuning | Browser WebGPU; Hugging Face files   |
| Gemma 4 E4B · fine-tuned     | Express adapter on the same E4B weights | Browser WebGPU; local static weights |
| Gemma 4 E2B · fine-tuned     | Express adapter on Gemma 4 E2B, 3.1 GB  | Browser WebGPU; local static weights |
| Chrome Prompt API · built-in | The model managed by Chrome             | Chrome's on-device Prompt API        |

Switching destroys the previous model session and starts a fresh conversation. Enable the selected mode before using an example. Both Gemma modes require half-precision WebGPU; an unavailable mode reports that state and does not silently change models. The Gemma modes use identical SDK guidance and requests. Run locally with greedy decoding on the four examples, the untuned E4B answered all form submits and edits in place but bound no form inputs, and the earlier E2B fine-tune (`round2-0cf5af05c20f`) built all four views but dropped the form when answering a submit. The selected [E4B adapter](finetuning/gemma4-e2b/README.md#pilot-2-spacing-fixed-facts-dropped-november-3-2026) built both forms with every input bound and every price shown, answered a submit and an edit in place and built the aquarium card, each on its first attempt with gaps of 3 to 6 steps; see the fine-tuning notes for the checkpoints it was chosen over. The [E2B adapter retrained on the same rows](finetuning/gemma4-e2b/README.md#e2b-on-the-same-recipe-november-3-2026), the selector's second fine-tuned mode, passed the same five requests on first attempts in about half the time, with gaps of 1 to 4 steps. Chrome's model and runtime are a separate comparison, not another version of the same Gemma weights.

### Curated example buttons

The four buttons send natural-language requests through the same live browser agent. Each starts a fresh conversation. They never load saved DSL or replay a captured interface.

| Example            | Inputs | First-attempt Chrome checks |
| ------------------ | -----: | --------------------------: |
| Aquarium card      |      0 |                         5/5 |
| Podcast card       |      0 |                         5/5 |
| Fitting form       |      4 |                         5/5 |
| Book delivery form |      8 |                         5/5 |

These 20 actual WebGPU generations used the selected adapter and unchanged SDK guide with no automatic repairs. Checks covered requested content, native controls, initial values, edits reaching owned state and submitted values. This is a curated demonstration result, not an independent benchmark or a guarantee for arbitrary prompts. Exploration failures remain recorded. Follow-up review generation is not included in the 20/20 score: a live eight-field book review failed three attempts with unsupported string concatenation; that failure is preserved in `main-book-review-final.json` and is not replaced with an authored summary. Receipts are under `output/finetuning/gemma4-e2b/demo-target/curated-verification.json` and `browser-evaluation/`.

### Standard Express prompt

Every engine gets the same guide: the `promptSnippet` of an `@a2ui/agent` request processor over the demo catalog, pruned to `EXPRESS_COMPONENTS`:

```ts
const generator = new A2uiGenerator(
  [
    new CatalogConfig(catalog, [
      new ComponentPruningTransformer(EXPRESS_COMPONENTS),
    ]),
  ],
  { [catalog.id]: EXPRESS_PROMPT_LESSONS },
);
const processor = generator.createProcessor(
  { "1.0": { supportedCatalogIds: [catalog.id] } },
  new ExpressFormatFactory({
    surfaceId,
    allowedMessages: ["createSurface", "updateComponents", "updateDataModel"],
  }),
);
processor.promptSnippet; // the system prompt
processor.parseResponse(response, { state }); // and openStream for previews
```

The SDK provides the Express grammar, binding rules and catalog-derived signatures. Its supported-message option omits deletion, which this demo does not expose during generation. The generator's examples option carries the lessons from `express-prompt-guidance.ts`: general guidance and three micro-examples (a card, a one-field form, and its same-surface summary). The selected fine-tune depends on them: run locally on MLX with its round-2 adapter and the demo's four example requests, it produced 1 valid response of 4 without them and 4 of 4 with them; the catalog trimming that used to accompany them made no difference and is gone. Each run supplies the application's side separately:

- **Create or edit:** the user's request, up to four earlier turns, app context, and the Express and current user-owned values of up to two live views, with how to target one (`surface("<id>", update=true)`).
- **Action:** the submitted values, any matching app guidance, the view's component ids and types, and the exact first line (`surface("<id>", update=true)`) and last line: the view's real root written back with named arguments and a new `result` card added (`rootLineWith`).
- **A new view's request** ends exactly as the fine-tune's training requests did: the coverage paragraph (named components on their own lines, children referenced by name, root assigned last) and _No view exists yet. Write no surface(...) line_. That suffix is the fine-tuned model's input format; without it the model wrote bare calls and invented surfaces.

The workbench's **System prompt** and **Agent state** show the exact guide and request used.

The selected fine-tune was trained on an earlier SDK guide, SHA-256 `2b0b389c765d474bff8f93c7e3187e03b21d1693b0f53e83d1a6ea0bf2828dd2`; the current catalog no longer produces that guide byte for byte. Check prompt parity again before training a new candidate. The receipts in this README predate the current guide and error recovery.

### Express error recovery

The demo implements the [Express error-recovery and micro-refinement loop](https://a2ui.org/specification/proposals/express/a2ui_express/#error-recovery-and-micro-refinement-loops) on the SDK compiler:

1. **Isolation.** A compiler error is traced to one line of its block: a syntax error names its line, and a catalog error (an unknown component, property or value) is the line that fails the same way when compiled on its own.
2. **Micro-refinement.** The model gets a small correction prompt with only that line and the compiler's error (`lineRepairTurn`); the system prompt already holds every component's signature. It runs with the same system prompt, so neither engine restarts its session.
3. **Hot swap.** The corrected statement replaces the line in its block, and the whole response is parsed again. The streamed preview stays on screen meanwhile.

A response gets up to three line corrections. An error the renderer state finds (a wrong value type, a reference to a component the block never defines, a component nothing shows, a missing root), or corrections that keep failing, sends the whole block back with the diagnostic; a response gets up to three such attempts. The model corrects its own output: the demo never inserts controls, rewrites DSL, or substitutes authored UI. The canned "Updated the live preview" note is shown to the user but never sent back to the model.

### Compilation and debugging

The demo compiles Express to A2UI 1.0 operations with the SDK's `ExpressParser`. Every response is parsed against a `RendererState` rebuilt from the committed surfaces, so an update must target a view that exists, and each `$/path = value` in an update becomes its own `updateDataModel`, leaving the user's other values alone. The demo caps generated output at 60,000 characters, run context at 28,000 characters, and Transformers.js generation at 3,072 new tokens. The legacy A2UI v0.9 and sandbox feature configuration are omitted on this route.

Only a response the SDK accepts is committed. Failure and Stop withdraw any partial preview, leave the last committed UI and its entered values intact, and report the result in the conversation. Compiler acceptance does not guarantee semantic request compliance: models can omit requested content or fail every repair attempt.

### Progressive rendering

The preview shows what the SDK has read so far. It never authors or rewrites the generated UI.

- **Preview.** Each chunk goes to the SDK's streaming parser (`ExpressParser.openStream`), which checks every statement against the committed surfaces and emits it once it is complete; long strings grow as they stream. At most every 150 ms the agent publishes what it emitted. Once the SDK rejects a block, the stream ends and the last preview stays until the response is parsed whole.
- **New views.** The SDK creates a new view only when its `root` line arrives, and the fine-tune writes root last. So the agent opens the host's new view up front with an empty `createSurface`, as CopilotKit's own surface writer does: the SDK stream then emits each statement before root as an update, and the route's `partialPreview` shows the components as they arrive. At the root line the stream would create the view a second time and ends; the complete response is then parsed whole and committed as one `createSurface`. An update of an existing view shows each statement in place.
- **Commit.** Previews are `generative-ui-surface` activity snapshots with status `streaming`, replacing the run's previous preview of that surface rather than appending to it. After the model ends, the complete response is parsed, corrected if needed, and its surfaces are published as their committed operations plus the answer's, status `ready`; no preview operation stays in the transcript. The stage reads `ready` only then. **Compiled JSON** shows the operations of the current preview while the model writes.
- **Withdraw.** A whole-block repair, Stop, a model error or exhausted repairs restores the transcript as it was before the run, with an authoritative AG-UI `MESSAGES_SNAPSHOT`; the native manager rebuilds touched surfaces with the user's values. A withdrawn new view leaves no activity, and the route asks the manager to forget its surface (`discardSurface`), so it is neither shown nor listed in the manifest and its id is used again. Values typed into a withdrawn new view are lost with it. If the chat detaches from the run first, the agent restores its messages directly. Once the page disposes the agent, a late chunk is ignored and the run reports nothing more.
- **The native manager's change check.** The manager applies only operations past the last one it applied, comparing that one alone; if a changed preview would keep the same last operation, the agent first publishes the committed list so the manager rebuilds.

The browser-local `ChromeExpressAgent` emits `STATE_SNAPSHOT` and throttled `STATE_DELTA` events under `state.a2uiExpress`, including the selected engine/model, raw DSL, compiler feedback with each line correction, timings, and action. The workbench reads this state through `injectAgentStore`. Rendering uses standard `generative-ui-surface` activity events.

The demo imports `@a2ui/agent` directly. Its main entry imports Node's `fs` and `path` for file-based catalogs and skills, which the demo never uses, so a pinned patch adds the standard `"browser"` field that maps both to empty modules in browser bundles; Node ignores it. See [the patch](../../../../patches/@a2ui__agent@0.1.0.patch).

### Verification

```sh
pnpm exec nx run @copilotkit/angular-demo:build
pnpm exec nx run @copilotkit/angular-demo:test
```

Unit tests cover:

- engine selection, and the native-startup fallback that waits for consent; both engines read the same SDK guide
- cancellation without unintended fallback, and availability after Stop
- worker download, streaming and disposal, and stale messages
- the SDK compiler: the guide covers only the demo's components and carries the lessons, whose examples compile, a new view and an update checked against committed surfaces, per-path data updates, prose, and streamed operations
- error recovery: the rejected line is found for syntax and catalog errors, and not for errors the renderer state finds; the correction prompt carries the line and the error; the correction is hot-swapped and published once; repeated failed corrections and errors no line explains fall back to a whole-block repair; three rejected responses keep the previous UI
- actions: the submitted values, the ids in use and the view's real root line reach the model, the answer updates the same view, and app guidance joins only a matching action
- prose answers, and that an action or a rejected draft never accepts prose
- Gemma's chat template: same-role neighbours are merged before reaching the worker
- progressive rendering, with a scripted model whose chunks the test releases, the real SDK stream and a real native manager fed as the Angular renderer feeds it: a root-first view is on the page while generation is blocked, a chunk inside the throttle interval is committed with the end, a value typed during streaming survives the commit, and an action's update streams into its view without resetting the user's value. A rejected new view is withdrawn without a ghost and its id is used again; Stop restores the committed view and values; a detached run restores the transcript; a disposed run ignores a late chunk

These tests substitute inference and do not establish model output quality. Real browser generation must be checked separately.

### Browser receipts (2026-11-01)

These receipts predate the standard SDK guide and the error recovery above. Opus tuned the earlier custom prompts and teaching examples, not the model weights. Real inference was tested in headed Chrome 156.0.8078.74 on an Apple M1 Max with 64 GiB RAM and macOS 27.0.1. The final demo checks passed 101/101 tests and the Nx build. No inference was stubbed, generated Express edited, or fallback UI authored.

Current receipts and screenshots are local artifacts in `output/playwright/gemma-prompt-tuning/`. Changes are uncommitted, so each JSON receipt records a SHA-256 source fingerprint as well as the baseline git HEAD. The final native and Gemma runs use the same source fingerprint. Times include generation and compiler retries, excluding enablement and download.

| Engine / check                         | Result                                                                                                                                                     | Receipt                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Chrome Prompt API checkout             | All 8 controls in one usable Form, title and $53 total; first attempt, 6.977 s                                                                             | `native-checkout-named.json`        |
| Chrome Prompt API review               | All 8 actual entered values shown, dollar total retained, Form and edited values kept in the same `view-1`; first attempt, 5.714 s                         | `native-review-named.json`          |
| Gemma 4 E2B, WebGPU checkout           | All 8 controls in one usable Form and $53.00 total; second attempt, 35.519 s. Compiler feedback corrected duplicated component names                       | `gemma-checkout-verified.json`      |
| Gemma 4 E2B, WebGPU review             | All 8 entered values shown, dollar total retained, Form and edited values kept in the same `view-1`; first attempt, 11.776 s                               | `gemma-review-verified.json`        |
| Chrome Prompt API separate museum card | Correct title, opening hours, €18 admission and address; first attempt, 4.417 s                                                                            | `native-info-card.json`             |
| Gemma 4 E2B separate museum card       | Correct title, opening hours, €18 admission and address; first attempt, 9.034 s                                                                            | `gemma-info-card.json`              |
| Gemma Stop during streaming            | Cancelled after 106 generated characters; all published surfaces, owned values and visible preview unchanged; worker released and enablement offered again | `gemma-stop-streamed-evidence.json` |

The eight inputs were name, email, street, city, country, delivery, gift wrapping and notes. Automation filled the actual DOM controls with Alex Morgan, alex@example.com, 42 Garden Lane, Vienna, Germany, Express, checked gift wrapping, and Ring apartment 4, then clicked the real submit Button. Both review payloads and visible reviews contained those values. Screenshots `native-review-result.png` and `gemma-review-result.png` show the generated form and review; `native-filled-named.png` and `gemma-filled-verified.png` show the filled form before submission.

The fallback run disabled only the native `LanguageModel` global before navigation, asserted it was absent, and used the actual Gemma worker with cached pinned weights. No weight request occurred before enablement. The cache contained only text embedding and decoder weights, with no audio or vision encoder weights. The route runs no demo-server inference; model and runtime files can be downloaded on first use.

These are targeted acceptance checks, not a reliability benchmark. Earlier native prompt iterations produced malformed lists, detached Forms, or a review that dropped the Form and changed dollars to euros; those failures remain recorded in this artifact directory. The guide used for those receipts had named component declarations, a Form-root teaching example and a matching review example; those examples are no longer included in runtime prompts. Compiler acceptance alone cannot prove that every requested detail is present. Arbitrary requests, long editing conversations and the smaller WASM model have not been accepted through real-device inference. Historical Qwen receipts in `output/playwright/opus-demo-fix/` predate these prompts and do not describe the current fallback.

### Testing with real Chrome

Use installed, headed Google Chrome. Some automation launchers disable `OptimizationHints`, background networking, or component updates, making the native API report unavailable on eligible hardware. Launch a dedicated profile normally and attach automation over CDP. On macOS:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir=/tmp/copilotkit-chrome-prompt-api \
  --remote-debugging-port=9223 \
  --no-first-run \
  http://localhost:4210/a2ui-1.0
```

Use the dev server's actual port (4210 during verification). The profile is separate from your usual Chrome profile. Select **Enable local model** (or **Download & enable**) and wait for **Model enabled** before sending a prompt. Native setup requirements are documented in the [Chrome Prompt API guide](https://developer.chrome.com/docs/ai/prompt-api).

```sh
npx --package @playwright/cli playwright-cli -s=browser-model open \
  http://localhost:4210/a2ui-1.0 \
  --config=examples/v2/angular/demo/chrome-prompt-api.config.json
```

To verify the fallback, use a browser without `LanguageModel`, or disable that global with a test-only initialization script before navigation. Assert the absence of the API, a Transformers.js backend in agent state, real model downloads, model-generated DSL, compiled operations, rendered controls, and actual action values. Do not replace the model with a stub for this browser acceptance check.
