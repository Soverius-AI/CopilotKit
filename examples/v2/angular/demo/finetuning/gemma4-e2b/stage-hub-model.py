"""Stage a browser export as a Hugging Face model repository directory.

The directory mirrors the published E2B repository: the q4f16 ONNX text
sessions and tokenizer files at the root, the public manifest without private
paths or audit records, the native MLX adapter under adapter-mlx/, the system
guide, the training settings, the model card and the licence notices. Upload
it with `hf upload <repo> <directory> . --repo-type model`.
"""

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parents[1]
WORKSPACE = DEMO.parents[3]
PUBLIC_MANIFEST_KEYS = [
    "base_model",
    "base_revision",
    "graph_revision",
    "adapter_sha256",
    "dtype",
    "adapted_logical_matrices",
    "patched_onnx_matrices",
    "decoder_graph_unchanged",
]
# mlx_lm records its whole argument list; these name private machines or runs.
PRIVATE_ADAPTER_KEYS = [
    "adapter_path",
    "config",
    "data",
    "project_name",
    "report_to",
    "resume_adapter_file",
]

parser = argparse.ArgumentParser()
parser.add_argument("--export-dir", type=Path, required=True)
parser.add_argument(
    "--adapter", type=Path, required=True, help="mlx_lm adapter directory"
)
parser.add_argument("--system-prompt", type=Path, required=True)
parser.add_argument("--card", type=Path, required=True, help="README.md model card")
parser.add_argument("--training-config", type=Path, required=True)
parser.add_argument("--notice", type=Path, required=True)
parser.add_argument("--output-dir", type=Path, required=True)
args = parser.parse_args()


def file_sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def place(original, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    try:
        os.link(original, target)
    except OSError:
        shutil.copyfile(original, target)


export = args.export_dir.resolve()
out = args.output_dir.resolve()
assert not out.exists() or not any(out.iterdir()), f"{out} is not empty"
manifest = json.loads((export / "a2ui-export-manifest.json").read_text())
assert manifest["dtype"] == "q4f16" and manifest["decoder_graph_unchanged"]

for name, expected in manifest["files"].items():
    original = (export / name).resolve()
    assert original.is_relative_to(export) and original.is_file(), name
    assert original.stat().st_size == expected["bytes"], name
    assert file_sha(original) == expected["sha256"], name
    place(original, out / name)

public = {key: manifest[key] for key in PUBLIC_MANIFEST_KEYS}
public["files"] = manifest["files"]
(out / "a2ui-export-manifest.json").write_text(json.dumps(public, indent=2) + "\n")

weights = args.adapter / "adapters.safetensors"
assert file_sha(weights) == manifest["adapter_sha256"], (
    "Adapter differs from the export"
)
place(weights, out / "adapter-mlx/adapters.safetensors")
adapter_config = json.loads((args.adapter / "adapter_config.json").read_text())
for key in PRIVATE_ADAPTER_KEYS:
    adapter_config.pop(key, None)
adapter_config["model"] = manifest["base_model"]
(out / "adapter-mlx/adapter_config.json").write_text(
    json.dumps(adapter_config, indent=2) + "\n"
)

training = json.loads(args.training_config.read_text())
assert training["adapter_sha256"] == manifest["adapter_sha256"]
assert training["sdk_system_prompt_sha256"] == file_sha(args.system_prompt)
shutil.copyfile(args.training_config, out / "training_config.json")
shutil.copyfile(args.system_prompt, out / "system_prompt.txt")
card = args.card.read_text()
assert manifest["adapter_sha256"] in card and manifest["base_model"] in card
shutil.copyfile(args.card, out / "README.md")
notice = args.notice.read_text()
assert manifest["adapter_sha256"] in notice
shutil.copyfile(args.notice, out / "NOTICE.txt")
shutil.copyfile(DEMO / "deployment/LICENSE-APACHE-2.0.txt", out / "LICENSE")
shutil.copyfile(WORKSPACE / "LICENSE", out / "LICENSE-COPILOTKIT.txt")

listing = sorted(
    (str(path.relative_to(out)), path.stat().st_size)
    for path in out.rglob("*")
    if path.is_file()
)
for name, size in listing:
    print(f"{size:>12} {name}")
print(
    json.dumps(
        {"staged": str(out), "files": len(listing), "bytes": sum(s for _, s in listing)}
    )
)
