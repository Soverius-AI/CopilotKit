"""Package the Express build for Hosting with a verified model source."""

import argparse
import hashlib
import json
import os
import re
import shutil
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parents[3]
# The published fine-tunes, as model-identity.ts: the step-40 adapter of the
# second Gemma 4 E4B run is the default; the E2B step-100 adapter is offered
# beside it. Hub mode hosts both; same-origin packaging bundles the default.
TARGET_ID = "e4b-pilot2s40-d53063f5f606"
ADAPTER_SHA = "d53063f5f606317cd9db5dd4bfc904e034d7f73a06b068155607459acc819fe2"
PUBLISHED = {
    TARGET_ID: ADAPTER_SHA,
    "e2b-mlx1s100-eff96be9f058": "eff96be9f058aec7993a0b1618d1d20c60eb4519d54f54c2352865ad297490f2",
}


# The ONNX matrices an mlx_lm adapter patches: every projection, 300 on E4B
# and 240 on E2B.
def patched_matrices(export_id):
    return 300 if export_id.startswith("e4b-") else 240


PATCHED_MATRICES = patched_matrices(TARGET_ID)
# E4B ids carry their size; the E2B rounds predate it (see localModelId).
MODEL_DIR_NAME = "gemma-4-" + (
    TARGET_ID if TARGET_ID.startswith("e4b-") else "e2b-" + TARGET_ID
)
parser = argparse.ArgumentParser()
parser.add_argument(
    "--model-dir",
    type=Path,
    default=Path(
        "/Volumes/DockerData/models/a2ui-e4b-lora/pilot2-step40-browser-model"
    ),
    help="Local browser export for same-origin packaging without a Hub descriptor",
)
parser.add_argument(
    "--public-dir", type=Path, default=PROJECT / "dist/a2ui-express/browser"
)
hub_descriptor = PROJECT / "deployment/huggingface-models.json"
parser.add_argument(
    "--hub-models",
    type=Path,
    default=hub_descriptor if hub_descriptor.is_file() else None,
    help="Verified Hugging Face model descriptor; uses deployment/huggingface-models.json when present",
)
args = parser.parse_args()


def file_sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


public, source = args.public_dir.resolve(), args.model_dir.resolve()
assert public.is_relative_to(PROJECT / "dist"), "Package into a demo build directory"
index = (public / "index.html").read_text()
assert "<a2ui-express-demo>" in index and "<app-root>" not in index, (
    "Build the dedicated Express entry point first"
)
scripts = list(public.glob("*.js"))
assert scripts and not list(public.glob("*.map")), (
    "Publish the optimized build without source maps"
)
for script in scripts:
    text = script.read_text()
    for forbidden in ["http://127.0.0.1:8899", "localhost:3001"]:
        assert forbidden not in text, f"Local-only endpoint remains in {script.name}"
files = {}
hub_models = None
if args.hub_models:
    descriptor = json.loads(args.hub_models.read_text())
    assert descriptor["stage"] == "uploaded"
    # Every mode the selector offers must be hosted, each by its own adapter.
    assert {m["export_id"] for m in descriptor["models"]} == set(PUBLISHED), (
        "Describe every published fine-tune"
    )
    assert not (public / "models").exists(), (
        "Rebuild before packaging the app without weights"
    )
    hub_models = []
    for published in descriptor["models"]:
        export_id = published["export_id"]
        adapter_sha = PUBLISHED[export_id]
        assert published["adapter_sha256"] == adapter_sha, export_id
        repo, revision = published["repo_id"], published["revision"]
        assert (
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_.-]*", repo)
            and ".." not in repo
        )
        assert re.fullmatch(r"[a-f0-9]{40}", revision), (
            f"Pin the uploaded revision of {export_id}"
        )
        assert any(
            repo in p.read_text() and revision in p.read_text() for p in scripts
        ), f"Build the configured Hub model {export_id} first"
        manifest_url = f"https://huggingface.co/{repo}/resolve/{revision}/a2ui-export-manifest.json"
        with urllib.request.urlopen(manifest_url, timeout=30) as response:
            manifest = json.load(response)
        assert manifest["adapter_sha256"] == adapter_sha, export_id
        assert (
            manifest["dtype"] == "q4f16"
            and manifest["patched_onnx_matrices"] == patched_matrices(export_id)
            and manifest["decoder_graph_unchanged"]
        ), export_id
        hub_models.append(dict(export_id=export_id, repo_id=repo, revision=revision))
else:
    assert any("/models/" in p.read_text() for p in scripts), (
        "Missing same-origin model configuration"
    )
    manifest = json.loads((source / "a2ui-export-manifest.json").read_text())
    assert manifest["adapter_sha256"] == ADAPTER_SHA
    assert (
        manifest["patched_onnx_matrices"] == PATCHED_MATRICES
        and manifest["decoder_graph_unchanged"]
    )
    destination = public / "models/local" / MODEL_DIR_NAME
    destination.mkdir(parents=True, exist_ok=True)
    for name, expected in manifest["files"].items():
        original = (source / name).resolve()
        assert original.is_relative_to(source) and original.is_file()
        assert original.stat().st_size < 2_000_000_000, (
            "Firebase Hosting file limit exceeded"
        )
        assert (
            file_sha(original) == expected["sha256"]
            and original.stat().st_size == expected["bytes"]
        ), name
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            try:
                os.link(original, target)
            except OSError:
                shutil.copyfile(original, target)
        else:
            assert target.stat().st_size == expected["bytes"] and (
                os.path.samefile(target, original)
                or file_sha(target) == expected["sha256"]
            ), "Never overwrite different model bytes"
        files[name] = expected

    # Keep private training paths and internal matrix audit records out of Hosting.
    allowed = [
        "base_model",
        "base_revision",
        "graph_revision",
        "adapter_sha256",
        "dtype",
        "adapted_logical_matrices",
        "patched_onnx_matrices",
        "decoder_graph_unchanged",
    ]
    published = {key: manifest[key] for key in allowed}
    published["files"] = files
    (destination / "a2ui-export-manifest.json").write_text(
        json.dumps(published, indent=2) + "\n"
    )
    for name in ["MODEL_CARD.md", "LICENSE-APACHE-2.0.txt", "NOTICE.txt"]:
        shutil.copyfile(PROJECT / "deployment" / name, destination / name)
    shutil.copyfile(WORKSPACE / "LICENSE", destination / "LICENSE-COPILOTKIT.txt")
if (public.parent / "3rdpartylicenses.txt").is_file():
    shutil.copyfile(
        public.parent / "3rdpartylicenses.txt", public / "3rdpartylicenses.txt"
    )
shutil.copyfile(WORKSPACE / "LICENSE", public / "LICENSE.txt")
total = sum(path.stat().st_size for path in public.rglob("*") if path.is_file())
assert total < 10_000_000_000, (
    "Dedicated output exceeds Firebase no-cost storage allowance"
)
receipt = dict(
    public_directory=str(public),
    target_model=TARGET_ID,
    adapter_sha256=ADAPTER_SHA,
    model_files=len(files),
    total_bytes=total,
    same_origin_weights=hub_models is None,
    hugging_face_models=hub_models,
    private_metadata_removed=True,
    maximum_file_bytes=max(p.stat().st_size for p in public.rglob("*") if p.is_file()),
)
(PROJECT / "dist/a2ui-express/package-receipt.json").write_text(
    json.dumps(receipt, indent=2) + "\n"
)
print(json.dumps(receipt))
