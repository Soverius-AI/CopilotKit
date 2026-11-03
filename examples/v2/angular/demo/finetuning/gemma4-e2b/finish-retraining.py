"""Finish a recorded Studio retrain without using test results for selection.

Training starts separately. This continuation preserves the previous rounds,
selects only among saved checkpoints with development loss, runs the unchanged
diagnostic suite, and prepares an opt-in browser export. It never publishes.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[5]
parser = argparse.ArgumentParser()
parser.add_argument("--round", type=Path, required=True)
args = parser.parse_args()
root = args.round.resolve()
experiment = json.loads((root / "experiment.json").read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def status(phase, **details):
    record = dict(
        phase=phase,
        updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        target_model=experiment["model"],
        **details,
    )
    (root / "continuation-status.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record), flush=True)


def run(command, logfile, env=None):
    with (root / logfile).open("x") as stream:
        subprocess.run(
            command,
            cwd=WORKSPACE,
            env=env,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=True,
        )


def main():
    assert not (root / "selected-model.json").exists(), (
        "Never overwrite a frozen selection"
    )
    for entry in experiment["files"].values():
        assert digest(entry["file"]) == entry["sha256"], (
            "Training/development data changed"
        )
    assert digest(experiment["blind"]["file"]) == experiment["blind"]["sha256"]
    # These are historical acceptance diagnostics, never checkpoint selectors.
    for name, expected in {
        "cases.jsonl": "39ad3e9236f231124791bf28b7e8af9fefda9b0f9518568a277ff7900112b41f",
        "manifest.json": "6dade56e8e8c88f19f85a392a3b3e1b23278c285f9692ed3b4380e317e3ad7ed",
    }.items():
        assert digest(HERE / "evaluation" / name) == expected
    assert (
        digest(HERE / "validate-express.ts")
        == "401134fec7cab415164b2c050935f749208965ef5b162b6c725c17179d3a3a6f"
    )
    status("waiting_for_training", training_started=True)
    deadline = time.monotonic() + 12 * 3600
    completed = root / "training/training-completed.json"
    while not completed.exists():
        snapshot = root / "training/training-status.json"
        if snapshot.exists():
            state = json.loads(snapshot.read_text())
            assert state.get("phase") not in [
                "failed",
                "error",
                "cancelled",
                "stopped",
            ], state.get("error") or state["phase"]
        assert time.monotonic() < deadline, "Training continuation exceeded 12 hours"
        time.sleep(15)
    state = json.loads(completed.read_text())
    assert state["phase"] == "completed" and not state.get("error")
    output = Path(state["details"]["output_dir"])
    history = state["metric_history"]
    eligible = []
    for step, loss in zip(history["eval_steps"], history["eval_loss"]):
        checkpoint = output / f"checkpoint-{step}"
        if (checkpoint / "adapters.safetensors").is_file():
            eligible.append((float(loss), step, checkpoint))
    assert eligible, "No saved checkpoint has a matching development loss"
    loss, step, checkpoint = min(eligible)
    config = json.loads((checkpoint / "adapter_config.json").read_text())
    assert config["base_model_commit_hash"] == experiment["base_revision"]
    assert config["rank"] == 8 and config["scale"] == 2
    quantization = config.get("base_quantization_config")
    assert quantization and all(value["bits"] == 4 for value in quantization.values())
    adapter_sha = digest(checkpoint / "adapters.safetensors")
    selected = dict(
        selection="minimum development loss among saved checkpoints; test outputs not consulted",
        step=step,
        development_loss=loss,
        eligible_steps=[item[1] for item in eligible],
        adapter=str(checkpoint),
        adapter_sha256=adapter_sha,
        blind_cases_sha256=experiment["blind"]["sha256"],
        blind_is_fresh=False,
        base_quantization=dict(bits=4, mode="affine", group_size=64),
    )
    (root / "selected-model.json").write_text(json.dumps(selected, indent=2) + "\n")
    status("known_suite_evaluation", training_started=True, selected=selected)
    evaluation = root / "known-suite"
    run(
        [
            sys.executable,
            str(HERE / "run-evaluation.py"),
            "--inputs",
            str(root.parent / "standard-guide/evaluation-model-inputs.jsonl"),
            "--model",
            str(checkpoint),
            "--label",
            "adapter",
            "--output-dir",
            str(evaluation),
            "--browser-template",
            str(root.parent / "browser-chat-template.jinja"),
        ],
        "known-suite-generation.log",
    )
    env = dict(os.environ)
    env["PATH"] = "/Users/wolfmanfx/.nvm/versions/node/v24.15.0/bin:" + env.get(
        "PATH", ""
    )
    env["NX_DAEMON"] = "false"
    run(
        [
            str(WORKSPACE / "node_modules/.bin/nx"),
            "run",
            "@copilotkit/angular-demo:validate-training-data",
            "--excludeTaskDependencies",
            "--",
            str(evaluation / "adapter-candidates.jsonl"),
            str(evaluation / "adapter-validation.jsonl"),
        ],
        "known-suite-validation.log",
        env,
    )
    for previous_round, previous_file in [
        ("round2", root.parent / "round2/evaluation/adapter-validation.jsonl"),
        ("round3", root.parent / "round3/known-suite/adapter-validation.jsonl"),
    ]:
        run(
            [
                sys.executable,
                str(HERE / "compare-eval-rounds.py"),
                "--previous",
                str(previous_file),
                "--current",
                str(evaluation / "adapter-validation.jsonl"),
                "--output",
                str(root / f"comparison-{previous_round}.json"),
            ],
            f"comparison-{previous_round}.log",
        )
    status("exporting", training_started=True, selected=selected)
    model_id = root.name + "-" + adapter_sha[:12]
    destination = root / "browser-models" / model_id
    env["OPENBLAS_NUM_THREADS"] = "4"
    run(
        [
            "/Users/wolfmanfx/.unsloth/studio/a2ui-export-env/bin/python",
            str(HERE / "export-browser-adapter.py"),
            "--base-dir",
            str(root.parent / "export-probe"),
            "--adapter",
            str(checkpoint),
            "--output-dir",
            str(destination),
        ],
        "export.log",
        env,
    )
    exported = json.loads((destination / "a2ui-export-manifest.json").read_text())
    assert (
        exported["adapter_sha256"] == adapter_sha
        and exported["decoder_graph_unchanged"]
    )
    assert exported["patched_onnx_matrices"] == 170
    frozen = dict(
        model_id=model_id,
        directory=str(destination),
        adapter_sha256=adapter_sha,
        files=exported["files"],
        blind_cases_sha256=experiment["blind"]["sha256"],
        blind_case_count=300,
        blind_is_fresh=False,
        browser_verified=False,
    )
    (root / "browser-ready.json").write_text(json.dumps(frozen, indent=2) + "\n")
    status(
        "awaiting_browser_evaluation",
        training_started=True,
        exported=True,
        model_id=model_id,
        blind_cases=300,
        blind_is_fresh=False,
    )


try:
    main()
except Exception as error:
    status("failed", error=str(error))
    raise
