"""Start and record a bounded local Studio training run after owned evaluation releases memory."""

import argparse
import importlib.util
import json
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "studio_api", Path(__file__).with_name("studio-api.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
api = module.Studio()
p = argparse.ArgumentParser()
p.add_argument("--request", type=Path, required=True)
p.add_argument("--output-dir", type=Path, required=True)
p.add_argument(
    "--wait-for-model", help="Wait for only this owned evaluation model to unload"
)
p.add_argument(
    "--timeout-hours", type=float, default=2, help="Bound the wait for long local runs"
)
args = p.parse_args()
root = args.output_dir
root.mkdir(parents=True, exist_ok=True)
assert not (root / "training-start.json").exists(), "Preserve prior training receipts"
body = json.loads(args.request.read_text())
deadline = time.monotonic() + 900
while True:
    state = api.request("/api/inference/status")
    if not state.get("loaded") and not state.get("loading"):
        break
    assert args.wait_for_model and set(state.get("loaded", [])) == {
        args.wait_for_model
    }, "Unrelated inference must remain untouched"
    assert time.monotonic() < deadline, "Owned evaluation has not released memory"
    time.sleep(10)
assert not api.request("/api/train/status")["is_training_running"], (
    "Another job is already running"
)
started = api.request("/api/train/start", body)
(root / "training-start.json").write_text(json.dumps(started, indent=2) + "\n")
assert started.get("job_id") and not started.get("error"), started
print(json.dumps(started), flush=True)
job_id = started["job_id"]
previous = None
deadline = time.monotonic() + args.timeout_hours * 3600
while True:
    state = api.request("/api/train/status")
    assert state["job_id"] == job_id, "Another training job replaced this run"
    (root / "training-status.json").write_text(json.dumps(state, indent=2) + "\n")
    details = state["details"]
    progress = (state["phase"], details["step"])
    if progress != previous:
        print(
            json.dumps(
                {
                    "job_id": job_id,
                    "phase": state["phase"],
                    "step": details["step"],
                    "total": details["total_steps"],
                    "loss": details["loss"],
                    "elapsed": details["elapsed_seconds"],
                    "eta_seconds": details["eta_seconds"],
                }
            ),
            flush=True,
        )
        previous = progress
    if not state["is_training_running"]:
        assert state["phase"] == "completed" and not state["error"], (
            state.get("error") or state["phase"]
        )
        break
    assert time.monotonic() < deadline, "Training exceeded bounded wait"
    time.sleep(15)
checkpoint = Path(state["details"]["output_dir"])
assert (checkpoint / "adapters.safetensors").is_file()
config = json.loads((checkpoint / "adapter_config.json").read_text())
assert config["base_model_commit_hash"] == "d36bdd3855c82a6a1a23f7c459b749f5724ae75d"
(root / "training-completed.json").write_text(json.dumps(state, indent=2) + "\n")
print(
    json.dumps(
        {"completed": job_id, "checkpoint": str(checkpoint), "steps": details["step"]}
    ),
    flush=True,
)
