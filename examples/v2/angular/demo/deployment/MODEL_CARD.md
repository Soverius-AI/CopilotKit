# Gemma 4 E4B for A2UI Express

This export combines `unsloth/gemma-4-E4B-it` (revision
`4e22d7e59e078e63a14f351efdc5232ed366b621`) with an Express-focused LoRA
adapter trained with `mlx_lm.lora` on a 4-bit MLX conversion of that
checkpoint. Its browser graph derives from
`onnx-community/gemma-4-E4B-it-ONNX`, revision
`2b6d2e26a962f70a33da8f7cd81e1afdd8d9cfb2`.

The selected adapter SHA-256 is
`d53063f5f606317cd9db5dd4bfc904e034d7f73a06b068155607459acc819fe2`.
It is the step-40 checkpoint of a run over 159 training rows and 21
validation rows: rank 8, scale 2.0, learning rate 0.0001, batch 1, a
12,288-token sequence cap with the prompt masked, seed 3407. Spacing values
in the training targets were rewritten as the catalog's 4px steps. The
browser export uses q4f16 text sessions, about 4.9 GB.

On eight held-out cases run with greedy decoding on MLX, the adapter compiled
7/8 on the first attempt, showed all 14 requested facts and prices and bound
every input; the one failure was a single invalid argument that the demo's
line repair corrects. In actual Chrome WebGPU runs of this demo, five requests
committed on their first attempt: a fitting form, its submit, an edit, the
Book Delivery form with its four price rows and the aquarium card. These are
demonstration checks rather than a benchmark; arbitrary requests are not
validated. Inspect compiler feedback and verify output before use.

The model files download into the browser, where inference runs locally.
The demo uses the standard catalog-generated Express system guide with its
generation guidance and three syntax lessons.

Sources:

- https://huggingface.co/google/gemma-4-E4B-it
- https://huggingface.co/unsloth/gemma-4-E4B-it
- https://huggingface.co/onnx-community/gemma-4-E4B-it-ONNX
- https://github.com/ml-explore/mlx-lm
- https://a2ui.org/specification/proposals/express/

Gemma 4 is licensed under Apache License 2.0. The included license and notice
apply to this modified export. See the source repositories for provenance.
