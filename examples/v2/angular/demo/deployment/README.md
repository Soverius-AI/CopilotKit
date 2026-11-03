# Express-only Firebase demo

Public site: <https://a2ui-express-demo-8d8183.web.app/>

Published models: the default
[wolfmanfx/gemma-4-E4B-it-A2UI-Express-ONNX](https://huggingface.co/wolfmanfx/gemma-4-E4B-it-A2UI-Express-ONNX)
and the smaller comparison
[wolfmanfx/gemma-4-E2B-it-A2UI-Express-ONNX](https://huggingface.co/wolfmanfx/gemma-4-E2B-it-A2UI-Express-ONNX),
whose head now holds the E2B adapter retrained on the same rows; its earlier
round-two export stays at revision `4560ee18bbca5c8bf7a1e1d0eeb36a40e94547fa`.
The verified revisions are recorded in `deployment/huggingface-models.json`.

The repository directory for a Hub upload is assembled by
`finetuning/gemma4-e2b/stage-hub-model.py` from a browser export, its
`mlx_lm` adapter, the system guide, the training settings, the model card
and the notices; upload it with `hf upload <repo> <directory> . --repo-type model`
and record each resulting revision in the descriptor and `deployment.firebase.ts`.

The `express-firebase` configuration bootstraps only `A2ui10DemoComponent`.
It does not include the multi-demo router, other demo providers, Inspector,
or a remote inference runtime. `/` and `/a2ui-1.0` open Express;
other demo routes return 404.

From the repository root, build and package:

```sh
pnpm exec nx run @copilotkit/angular-demo:build:express --excludeTaskDependencies
pnpm exec nx run @copilotkit/angular-demo:prepare:firebase --excludeTaskDependencies
```

When `deployment/huggingface-models.json` is present, packaging verifies each
published fine-tune's public manifest at its pinned Hugging Face revision and
checks that the actual app bundle contains that same repository and revision.
This mode publishes the app and its licence notices without bundling model
weights. The loader also checks each adapter's identity before starting
inference. The descriptor and `deployment.firebase.ts` must refer to the same
revisions, and the descriptor must cover every fine-tune the selector offers.

Without that descriptor, packaging uses the local export given by
`--model-dir` (by default the selected E4B export on the external model disk),
verifies all file hashes, and bundles its files and notices for same-origin
hosting of the default mode alone; the E2B mode has no weights in that
packaging. The E4B export's largest shard exceeds Firebase Hosting's 2 GB file
limit, so this fallback only works for the smaller E2B exports; the demo is
published in Hub mode. Both modes reject local server URLs in the public
bundle. The packaging receipt stays outside the public directory. Rebuilding
clears the output, so always package after a build.

To check the static deployment locally, run from `examples/v2/angular/demo`:

```sh
firebase emulators:start --only hosting --project demo-a2ui-express --config firebase.express.json
```

Open <http://127.0.0.1:4310>. The configured Hub model uses its immutable
Hugging Face revision. The fallback packaging mode serves model files from
this origin's `/models/` directory. Public pages reject local file-server URLs;
Hub configuration requires an explicit repository and full revision hash.

To deploy the dedicated output, run from the same demo directory:

```sh
firebase deploy --only hosting --config firebase.express.json --project a2ui-express-demo-8d8183 --non-interactive
```

The explicit project ID keeps this separate from existing Firebase projects.
This deploys static Hosting only; it does not commit or push Git changes.
It needs an authenticated Firebase CLI account with access to that project.

The fine-tuned text sessions total about 4.9 GB for E4B and 3.1 GB for E2B. In
Hub mode visitors download the weights of the mode they enable from Hugging
Face; Firebase serves the app and its static assets.
In fallback mode bundled weight downloads consume Firebase's transfer allowance.
The project was created without a paid billing upgrade. See
[Firebase quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing).

Visitors enable inference themselves. Fine-tuned Gemma requires WebGPU with
half precision; original Gemma downloads its pinned Hugging Face model;
Chrome Prompt API depends on the visitor's browser support. Models never
silently substitute for one another. Training runs locally with `mlx_lm`,
not in Firebase or the visitor's browser. See [the model card](MODEL_CARD.md)
for training settings, measured results and limits.
