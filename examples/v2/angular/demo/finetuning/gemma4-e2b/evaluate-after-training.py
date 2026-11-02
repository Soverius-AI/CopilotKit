"""Complete the frozen evaluation after one owned training run; never promote a browser model."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--round-dir", type=Path, required=True)
args = p.parse_args()
root = args.round_dir.resolve()
helpers = Path(__file__).resolve().parent
workspace = next(path for path in helpers.parents if (path / "nx.json").exists())
started = json.loads((root / "training-start.json").read_text())
job_id = started["job_id"]
deadline = time.monotonic() + 7200
while not (root / "training-completed.json").exists():
    if (root / "training-status.json").exists():
        s = json.loads((root / "training-status.json").read_text())
        assert s["job_id"] == job_id, "Training run changed"
        assert s["phase"] not in ["error", "failed", "cancelled"], (
            "Training did not complete"
        )
    assert time.monotonic() < deadline, (
        "Training did not complete within the bounded wait"
    )
    time.sleep(15)
completed = json.loads((root / "training-completed.json").read_text())
assert completed["job_id"] == job_id and completed["phase"] == "completed"
checkpoint = completed["details"]["output_dir"]
evaluation = root / "evaluation"


def run(name, command):
    print(json.dumps({"starting": name}), flush=True)
    with (root / (name + ".log")).open("w") as log:
        subprocess.run(
            command,
            cwd=workspace,
            env={**os.environ, "NX_DAEMON": "false"},
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
        )
    print(json.dumps({"completed": name}), flush=True)


run(
    "evaluation-adapter",
    [
        sys.executable,
        str(helpers / "run-evaluation.py"),
        "--inputs",
        str(
            workspace
            / "output/finetuning/gemma4-e2b/standard-guide/evaluation-model-inputs.jsonl"
        ),
        "--model",
        checkpoint,
        "--label",
        "adapter",
        "--output-dir",
        str(evaluation),
        "--browser-template",
        str(workspace / "output/finetuning/gemma4-e2b/browser-chat-template.jinja"),
    ],
)
run(
    "adapter-validation",
    [
        str(workspace / "node_modules/.bin/nx"),
        "run",
        "@copilotkit/angular-demo:validate-training-data",
        "--excludeTaskDependencies",
        "--",
        str(evaluation / "adapter-candidates.jsonl"),
        str(evaluation / "adapter-validation.jsonl"),
    ],
)
run(
    "round2-score",
    [
        sys.executable,
        str(helpers / "score-evaluation.py"),
        "--base",
        str(evaluation / "base-validation.jsonl"),
        "--adapter",
        str(evaluation / "adapter-validation.jsonl"),
        "--output",
        str(evaluation / "comparison.json"),
    ],
)
pilot = json.loads((evaluation / "pilot-comparison.json").read_text())
current = json.loads((evaluation / "comparison.json").read_text())
protection = json.loads((root / "eval-protection.json").read_text())
for name, digest in protection["protected_files"].items():
    assert (
        hashlib.sha256((helpers / "evaluation" / name).read_bytes()).hexdigest()
        == digest
    ), "Frozen evaluation changed"
models = {
    "base": current["summary"]["base"],
    "first_pilot": pilot["summary"]["adapter"],
    "round2": current["summary"]["adapter"],
}
before = models["first_pilot"]["splits"]["acceptance"]["passed"]
after = models["round2"]["splits"]["acceptance"]["passed"]
report = dict(
    status="completed_offline",
    training_job_id=job_id,
    checkpoint=checkpoint,
    new_valid_studio_examples=96,
    training_examples=104,
    training_validation_examples=15,
    training_steps=completed["details"]["step"],
    max_seq_length=32768,
    harness="raw_browser_tokens_v2",
    prompt_token_parity_verified=True,
    frozen_evaluation_unchanged=True,
    protected_files=protection["protected_files"],
    acceptance_cases=12,
    separate_shopping_regression_cases=1,
    models=models,
    improved_over_first_pilot=after > before,
    fixed=current["fixed"],
    regressions=current["regressions"],
    offline_threshold_met=current["offline_threshold_met"],
    browserVerified=False,
    browser_model_promoted=False,
)
(root / "round-comparison.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report), flush=True)
