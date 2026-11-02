"""Merge LoRA deltas into the pinned browser-tested ONNX graph's weights.

Keep the fused attention/norm graph and unchanged embedding session. Each
adapted FP16 matrix is checked against the Hugging Face base before its delta
is merged and requantized into the original MatMulNBits tensor layout. The
adapter may come from Unsloth Studio (the E2B rounds) or mlx_lm (E4B).
"""

import argparse
import hashlib
import json
import os
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np
import onnx
from safetensors import safe_open
from onnxruntime.quantization.matmul_nbits_quantizer import (
    DefaultWeightOnlyQuantizer,
    DefaultWeightOnlyQuantConfig,
)

p = argparse.ArgumentParser()
p.add_argument("--base-dir", type=Path, required=True, help="onnx-community checkpoint")
p.add_argument(
    "--hf-base", type=Path, required=True, help="safetensors the adapter was trained on"
)
p.add_argument("--base-model", required=True, help="for example unsloth/gemma-4-E4B-it")
p.add_argument("--base-revision", required=True)
p.add_argument("--graph-revision", required=True)
p.add_argument("--adapter", type=Path, required=True)
p.add_argument("--output-dir", type=Path, required=True)
args = p.parse_args()
base = args.base_dir.resolve()
output = args.output_dir.resolve()
adapter = args.adapter.resolve()
assert not output.exists(), "Export into a new model directory"
config = json.loads((adapter / "adapter_config.json").read_text())
# Studio writes rank and scale at the top level, mlx_lm under lora_parameters.
lora = config.get("lora_parameters", config)
rank, scale = int(lora["rank"]), float(lora["scale"])
assert np.isfinite(scale) and scale > 0
trained_on = config.get("base_model_commit_hash")
assert trained_on in (None, args.base_revision), "Adapter trained on another base"


class HfWeights:
    """The bf16 tensors of a safetensors checkpoint, read in place."""

    def __init__(self, directory):
        self.tensors = {}
        for path in sorted(directory.glob("*.safetensors")):
            with path.open("rb") as f:
                size = int.from_bytes(f.read(8), "little")
                header = json.loads(f.read(size))
            data = np.memmap(path, mode="r", dtype=np.uint8, offset=8 + size)
            for name, meta in header.items():
                if name != "__metadata__":
                    self.tensors[name] = (data, meta)

    def fp16_transposed(self, name):
        """A (out, in) weight as the ONNX MatMul holds it: (in, out) fp16."""
        data, meta = self.tensors[name]
        assert meta["dtype"] == "BF16"
        start, end = meta["data_offsets"]
        bits = np.frombuffer(data[start:end], dtype=np.uint16).reshape(meta["shape"])
        return (bits.astype(np.uint32) << 16).view(np.float32).T.astype(np.float16)


def hf_name(module):
    return module.replace("language_model.model.", "model.language_model.") + ".weight"


def onnx_weight(module):
    """The fp16 graph's MatMul weight for an adapter module, and the half of a
    fused gate_up matrix it occupies."""
    mapped = module.replace("language_model.model.", "model.").replace(
        ".self_attn.", ".attn."
    )
    owner, _, leaf = mapped.rpartition(".")
    part = None
    if leaf in ("gate_proj", "up_proj"):
        part = 0 if leaf == "gate_proj" else 1
        mapped = owner + ".gate_up_proj"
    elif leaf in ("per_layer_input_gate", "per_layer_projection"):
        mapped = owner + ".per_layer." + leaf
    return mapped + ".MatMul.weight", part


hf = HfWeights(args.hf_base)
fp = onnx.load(base / "onnx/decoder_model_merged_fp16.onnx", load_external_data=False)
quant = onnx.load(
    base / "onnx/decoder_model_merged_q4f16.onnx", load_external_data=False
)
fp_tensors = {t.name: t for t in fp.graph.initializer}
qt = {t.name: t for t in quant.graph.initializer}
fp_nodes = {
    n.input[1]: n
    for n in fp.graph.node
    if n.op_type == "MatMul" and n.input[1] in fp_tensors
}
qnodes = {n.name: n for n in quant.graph.node}
groups = defaultdict(list)
with safe_open(adapter / "adapters.safetensors", framework="numpy") as tensors:
    keys = set(tensors.keys())
    modules = {key.removesuffix(".lora_a") for key in keys if key.endswith(".lora_a")}
    assert len(keys) == 2 * len(modules), "Adapter has unmapped trainable state"
    for module in sorted(modules):
        a = tensors.get_tensor(module + ".lora_a").astype(np.float32)
        b = tensors.get_tensor(module + ".lora_b").astype(np.float32)
        assert a.shape[1] == b.shape[0] == rank
        name, part = onnx_weight(module)
        assert name in fp_tensors, f"No ONNX matrix for {module}"
        groups[name].append((module, part, a, b))

output.mkdir(parents=True)
(output / "onnx").mkdir()
for name in [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "generation_config.json",
    "chat_template.jinja",
    "processor_config.json",
    "preprocessor_config.json",
]:
    shutil.copyfile(base / name, output / name)
for name in ["decoder_model_merged_q4f16.onnx", "embed_tokens_q4f16.onnx"]:
    shutil.copyfile(base / "onnx" / name, output / "onnx" / name)
data_names = sorted(
    path.name for path in (base / "onnx").glob("decoder_model_merged_q4f16.onnx_data*")
)
for name in data_names:
    shutil.copyfile(base / "onnx" / name, output / "onnx" / name)
embedding = base / "onnx/embed_tokens_q4f16.onnx_data"
try:
    os.link(embedding, output / "onnx" / embedding.name)
except OSError:
    shutil.copyfile(embedding, output / "onnx" / embedding.name)


def external(tensor):
    return {entry.key: entry.value for entry in tensor.external_data}


def fp_array(tensor):
    meta = external(tensor)
    assert tensor.data_type == onnx.TensorProto.FLOAT16
    return np.memmap(
        base / "onnx" / meta["location"],
        mode="r",
        dtype=np.float16,
        offset=int(meta.get("offset", 0)),
        shape=tuple(tensor.dims),
    )


quantizer = DefaultWeightOnlyQuantizer(
    DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=False)
)
shards = {}


def shard(location):
    """The copied weight file a quantized tensor lives in, open for patching."""
    assert location in data_names, f"Unexpected weight file {location}"
    if location not in shards:
        shards[location] = (output / "onnx" / location).open("r+b")
    return shards[location]


stats = []
matrix_map = []
for index, (name, deltas) in enumerate(sorted(groups.items())):
    original = fp_array(fp_tensors[name])
    merged = np.array(original, dtype=np.float32)
    for module, part, a, b in deltas:
        if part is None:
            columns = slice(None)
        else:
            assert merged.shape[1] % 2 == 0
            half = merged.shape[1] // 2
            columns = slice(part * half, (part + 1) * half)
        expected = hf.fp16_transposed(hf_name(module))
        delta = scale * (a @ b)
        before = np.asarray(original[:, columns])
        assert before.shape == expected.shape == delta.shape, module
        exact = bool(np.array_equal(before, expected))
        matrix_map.append(
            dict(
                module=module,
                matrix=name,
                part=part,
                shape=list(expected.shape),
                exact_base_match=exact,
                max_error=float(
                    np.abs(
                        before.astype(np.float32) - expected.astype(np.float32)
                    ).max()
                ),
            )
        )
        assert exact, f"{module} is not the Hugging Face base weight"
        merged[:, columns] += delta
    assert np.isfinite(merged).all()
    merged = merged.astype(np.float16)
    assert np.isfinite(merged).all(), "Merged weights overflow FP16"
    qnode = qnodes[fp_nodes[name].name + "_Quant"]
    attrs = {a.name: onnx.helper.get_attribute_value(a) for a in qnode.attribute}
    assert (
        qnode.op_type == "MatMulNBits"
        and attrs["bits"] == 4
        and attrs["block_size"] == 32
    )
    assert attrs["K"] == merged.shape[0] and attrs["N"] == merged.shape[1]
    arrays = quantizer.qbits_block_quant(merged)
    assert len(qnode.input) == 4
    changed_bytes = 0
    for value, tensor_name in zip(arrays, qnode.input[1:]):
        tensor = qt[tensor_name]
        meta = external(tensor)
        assert tuple(tensor.dims) == value.shape
        content = value.tobytes(order="C")
        assert len(content) == int(meta["length"])
        data = shard(meta["location"])
        data.seek(int(meta["offset"]))
        before = data.read(len(content))
        changed_bytes += sum(x != y for x, y in zip(before, content))
        data.seek(int(meta["offset"]))
        data.write(content)
    stats.append(
        dict(
            matrix=name,
            adapter_modules=[x[0] for x in deltas],
            changed_bytes=changed_bytes,
        )
    )
    if (index + 1) % 20 == 0:
        print(
            json.dumps({"patched_matrices": index + 1, "total": len(groups)}),
            flush=True,
        )
for data in shards.values():
    data.close()
assert sum(row["changed_bytes"] for row in stats) > 0


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


files = {
    str(path.relative_to(output)): {"bytes": path.stat().st_size, "sha256": sha(path)}
    for path in output.rglob("*")
    if path.is_file()
}
manifest = dict(
    base_model=args.base_model,
    base_revision=args.base_revision,
    graph_revision=args.graph_revision,
    adapter=str(adapter),
    adapter_sha256=sha(adapter / "adapters.safetensors"),
    dtype="q4f16",
    adapted_logical_matrices=len(modules),
    patched_onnx_matrices=len(stats),
    decoder_graph_unchanged=sha(output / "onnx/decoder_model_merged_q4f16.onnx")
    == sha(base / "onnx/decoder_model_merged_q4f16.onnx"),
    browser_verified=False,
    files=files,
    matrix_map=matrix_map,
    matrix_stats=stats,
)
assert manifest["decoder_graph_unchanged"]
(output / "a2ui-export-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(
    json.dumps(
        {
            "exported": str(output),
            "adapter_matrices": len(modules),
            "onnx_matrices": len(stats),
            "browser_verified": False,
        }
    ),
    flush=True,
)
