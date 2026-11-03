# Frozen Gemma Express evaluation, version 1

This set contains **12 unseen acceptance requests** plus the original ten-input shopping **regression**. It contains natural-language requests and observable expectations, with no target Express programs. It is forbidden as training data. The three rows used for training loss are a separate validation split and do not count toward acceptance.

The acceptance cases cover four informational cards and eight forms, including email, quantities, selections, checkboxes, multiline input, addresses, quoted/Unicode text, several currencies, and two ten-input checkouts. Test values include punctuation and newlines. Cases and their hashes are frozen in `cases.jsonl` and `manifest.json`; changing a request after inspecting results requires a new benchmark version. There is no exact request overlap with the pilot's 20 training rows. This small developer-authored set is a pilot benchmark, not a statistically representative quality estimate.

Each model receives the actual SDK-generated Express prompt and the same canonical demo request. The runner renders the pinned browser template locally, sends those exact token IDs to Studio's untemplated `/v1/completions` endpoint, and checks the reported input length against the browser prefix. It uses greedy generation, thinking disabled in that prefix, 3,072 new tokens and no automatic repairs. The training sequence cap remains 32,768. Compare the untouched base checkpoint with the saved adapter on the same set.

The earlier `evaluation-v1` run used Studio's chat endpoint. Its usage reported 11,105 input tokens for a request whose canonical browser prefix has 5,246 tokens; all 26 results showed a mismatch. Those historical scores are not browser-prompt comparable. `prompt-mismatch-audit.json` preserves the discrepancy. The corrected harness is `raw_browser_tokens_v2`; the scorer refuses legacy rows and requires matching prompt-token hashes for both models. The frozen requests, expectations, system guide and content grader are unchanged. Baselines must be rerun through the corrected harness before comparing another training round.

The existing Nx `validate-training-data` target checks the real compiler, native graph, reachable content and prices, exact controls and options, initialized unique bindings, submit buttons, and named Form Events that include every input path. These are offline checks. Actual browser control interaction, submit dispatch, action replies preserving entered values, streaming, and ONNX quantization are separate required gates. A lower training loss is not a pass.

From the workspace root:

```sh
# Build specifications and verify no exact training-request overlap.
python examples/v2/angular/demo/finetuning/gemma4-e2b/build-evaluation.py \
  --artifact-dir output/finetuning/gemma4-e2b/standard-guide

# Export requests through the real demo prompt generator.
pnpm exec nx run @copilotkit/angular-demo:validate-training-data --excludeTaskDependencies -- \
  --prepare "$PWD/examples/v2/angular/demo/finetuning/gemma4-e2b/evaluation/cases.jsonl" \
  "$PWD/output/finetuning/gemma4-e2b/standard-guide/evaluation-model-inputs.jsonl"

# Run once for each label, using a pinned base snapshot or completed adapter path.
python examples/v2/angular/demo/finetuning/gemma4-e2b/run-evaluation.py \
  --inputs output/finetuning/gemma4-e2b/standard-guide/evaluation-model-inputs.jsonl \
  --model /absolute/path/to/checkpoint --label base \
  --output-dir output/finetuning/gemma4-e2b/standard-guide/evaluation-v1 \
  --browser-template output/finetuning/gemma4-e2b/browser-chat-template.jinja

# Validate each candidate file through Nx, then compare the validated files.
pnpm exec nx run @copilotkit/angular-demo:validate-training-data --excludeTaskDependencies -- \
  "$PWD/output/finetuning/gemma4-e2b/standard-guide/evaluation-v1/base-candidates.jsonl" \
  "$PWD/output/finetuning/gemma4-e2b/standard-guide/evaluation-v1/base-validation.jsonl"

python examples/v2/angular/demo/finetuning/gemma4-e2b/score-evaluation.py \
  --base output/finetuning/gemma4-e2b/standard-guide/evaluation-v1/base-validation.jsonl \
  --adapter output/finetuning/gemma4-e2b/standard-guide/evaluation-v1/adapter-validation.jsonl \
  --output output/finetuning/gemma4-e2b/standard-guide/evaluation-v1/comparison.json
```

Use Studio's Python environment with the prepared dependencies. The runner reads an existing private local session file, refreshes it when needed, and sends requests only to loopback Studio. It refuses to replace an unrelated loaded model and unloads its own model afterward. Save new runs in new directories; results are never overwritten.

The offline threshold is at least 90% first-pass acceptance, reported separately from the regression. The browser model cannot be promoted until functional browser checks pass. Keep the set outside Data Recipe seeds and LoRA uploads; add newly discovered failures to a future curriculum and reserve a new independent benchmark when iterating against these results.
