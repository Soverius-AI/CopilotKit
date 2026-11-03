"""Resume only after corpus + browser-inference gates, then train and export.

Uses Studio's actual training endpoint. Selects a checkpoint on development
loss alone, freezes its hash before any blind evaluation, and preserves every
receipt. Does not publish anything or touch Git.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
spec = importlib.util.spec_from_file_location("studio_api", HERE / "studio-api.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
api = mod.Studio()
p = argparse.ArgumentParser()
p.add_argument("--round", type=Path, required=True)
p.add_argument("--teacher-pid", type=int, required=True)
p.add_argument("--train-count", type=int, default=1000)
p.add_argument("--lora-r", type=int, default=8)
p.add_argument("--lora-alpha", type=int, default=16)
p.add_argument("--no-quantization", action="store_true")
p.add_argument("--learning-rate", default="5e-5")
args = p.parse_args()
root = args.round.resolve()


def status(phase, **details):
    data = {
        "phase": phase,
        "target_model": "unsloth/gemma-4-E2B-it",
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **details,
    }
    (root / "continuation-status.json").write_text(json.dumps(data, indent=2) + "\n")
    print(json.dumps(data), flush=True)


def run(command, log):
    with (root / log).open("w") as stream:
        subprocess.run(
            command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, check=True
        )


def main():
    deadline = time.monotonic() + 36 * 3600
    status("waiting_for_validated_corpus", training_started=False)
    while True:
        path = root / "bulk/status.json"
        if path.exists():
            corpus_status = json.loads(path.read_text())
            assert corpus_status.get("phase") != "failed", corpus_status.get(
                "error", "Corpus generation failed"
            )
            if corpus_status.get("phase") == "corpus-complete":
                break
        assert time.monotonic() < deadline, "Corpus wait exceeded 36 hours"
        time.sleep(30)
    manifest = json.loads((root / "bulk/dataset/manifest.json").read_text())
    assert (
        manifest["counts"] == {"train": args.train_count, "eval": 100, "blind": 300}
        and manifest["separation_checks_passed"]
    )
    if args.no_quantization:
        memory = json.loads((root / "lora32-bf16-probe.json").read_text())
        assert (
            memory["quantized_modules"] == 0
            and memory["rank"] == args.lora_r
            and memory["base_dtypes"] == ["mlx.core.bfloat16"]
        )
        patch = json.loads((root / "studio-bf16-loader-patch.json").read_text())
        assert (
            hashlib.sha256(Path(patch["path"]).read_bytes()).hexdigest()
            == patch["patched_sha256"]
        ), "Studio changed after the BF16 loader check"
    proof = json.loads(
        (root.parent / "export-probe/round2-browser-proof.json").read_text()
    )
    assert (
        proof["webgpu_inference_verified"]
        and proof["exported_adapter_used"]
        and proof["system_prompt_sha256"]
        == "2b0b389c765d474bff8f93c7e3187e03b21d1693b0f53e83d1a6ea0bf2828dd2"
    )
    # This exact teacher was started by this task. Never stop an unrelated process.
    command = subprocess.run(
        ["ps", "-p", str(args.teacher_pid), "-o", "command="],
        capture_output=True,
        text=True,
    ).stdout
    if command:
        assert (
            "/Users/wolfmanfx/.unsloth/llama.cpp/build/bin/llama-server" in command
            and "--port 5802" in command
            and "--parallel 4" in command
        )
        os.kill(args.teacher_pid, signal.SIGTERM)
    status("tokenizing", training_started=False)
    run(
        [
            sys.executable,
            str(HERE / "tokenize-dataset.py"),
            "--dataset-dir",
            str(root / "bulk/dataset"),
            "--browser-template",
            str(root.parent / "browser-chat-template.jinja"),
            "--output-dir",
            str(root / "tokens"),
            "--max-tokens",
            "32768",
        ],
        "tokenization.log",
    )
    report = json.loads((root / "tokens/tokenization-report.json").read_text())
    assert (
        len(report["rows"]) == args.train_count + 100
        and max(r["tokens"] for r in report["rows"]) <= 32768
    )
    # Explicitly reject truncation in both data preparation and Studio's preview.
    train = api.upload_dataset(root / "tokens/train.jsonl")
    dev = api.upload_dataset(root / "tokens/eval.jsonl")
    (root / "dataset-uploads.json").write_text(
        json.dumps({"train": train, "dev": dev}, indent=2) + "\n"
    )

    def dataset_path(receipt):
        return (
            receipt.get("stored_path")
            or receipt.get("path")
            or receipt.get("file_path")
            or receipt.get("dataset_path")
        )

    trainpath = dataset_path(train)
    devpath = dataset_path(dev)
    assert trainpath and devpath, "Unexpected upload receipt; preserve it and inspect"
    request = json.loads((root.parent / "round2/training-request.json").read_text())
    interval = max(1, args.train_count // 4)
    request.update(
        local_datasets=[trainpath],
        local_eval_datasets=[devpath],
        max_steps=args.train_count,
        num_epochs=1,
        load_in_4bit=not args.no_quantization,
        lora_r=args.lora_r,
        lora_alpha=args.lora_alpha,
        weight_decay=0.01,
        learning_rate=args.learning_rate,
        warmup_steps=max(5, args.train_count // 20),
        save_steps=interval,
        eval_steps=float(interval),
        project_name=f"a2ui-gemma4-e2b-round3-{args.train_count}-rank{args.lora_r}",
        start_request_id="a2ui-round3-" + uuid.uuid4().hex,
    )
    preview_request = {
        "model_name": request["model_name"],
        "dataset_name": trainpath,
        "dataset_local_path": trainpath,
        "dataset_known_cached": True,
        "format_type": "auto",
        "max_seq_length": 32768,
        "train_on_completions": True,
        "num_samples": 3,
        "seed": 3407,
    }
    preview = api.request("/api/train/token-preview", preview_request)
    (root / "studio-token-preview.json").write_text(
        json.dumps(preview, indent=2) + "\n"
    )
    assert (
        preview["final_format"] == "pretokenized" and not preview["add_special_tokens"]
    )
    sequences = {
        tuple(json.loads(line)["input_ids"])
        for line in (root / "tokens/train.jsonl").read_text().splitlines()
    }
    assert preview["samples"] and all(
        tuple(sample["input_ids"]) in sequences and sample["truncated_from"] is None
        for sample in preview["samples"]
    )
    # Only pretokenized rows are uploaded; their exact assistant masks are audited above.
    path = root / "training-request.json"
    path.write_text(json.dumps(request, indent=2) + "\n")
    status(
        "training",
        training_started=True,
        examples=args.train_count,
        development=100,
        blind=300,
        load_in_4bit=request["load_in_4bit"],
        lora_rank=args.lora_r,
        lora_alpha=args.lora_alpha,
    )
    run(
        [
            sys.executable,
            str(HERE / "run-training.py"),
            "--request",
            str(path),
            "--output-dir",
            str(root / "training"),
            "--timeout-hours",
            "24",
        ],
        "training.log",
    )
    completed = json.loads((root / "training/training-completed.json").read_text())
    history = completed["metric_history"]
    pairs = list(zip(history["eval_steps"], history["eval_loss"]))
    assert pairs and all(float(loss) > 0 for _, loss in pairs)
    step, loss = min(pairs, key=lambda item: item[1])
    checkpoint = Path(completed["details"]["output_dir"]) / ("checkpoint-" + str(step))
    assert (checkpoint / "adapters.safetensors").is_file()
    config = json.loads((checkpoint / "adapter_config.json").read_text())
    assert config["rank"] == args.lora_r
    if args.no_quantization:
        assert not config.get("base_quantization_config"), (
            "The base was quantized despite the requested LoRA mode"
        )
    adapter_hash = hashlib.sha256(
        (checkpoint / "adapters.safetensors").read_bytes()
    ).hexdigest()
    selected = {
        "selection": "minimum development loss; blind set never consulted",
        "step": step,
        "development_loss": loss,
        "adapter": str(checkpoint),
        "adapter_sha256": adapter_hash,
        "blind_cases_sha256": json.loads(
            (root / "bulk/blind/manifest.json").read_text()
        )["cases_sha256"],
    }
    (root / "selected-model.json").write_text(json.dumps(selected, indent=2) + "\n")
    # The artifact has already been selected on development loss. Re-run the
    # immutable historical suite for a paired diagnostic, with exact browser
    # token IDs, before starting the separate blind browser run.
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
    nxenv = dict(os.environ)
    nxenv["PATH"] = "/Users/wolfmanfx/.nvm/versions/node/v24.15.0/bin:" + nxenv.get(
        "PATH", ""
    )
    nxenv["NX_DAEMON"] = "false"
    with (root / "known-suite-validation.log").open("w") as stream:
        subprocess.run(
            [
                str(ROOT / "node_modules/.bin/nx"),
                "run",
                "@copilotkit/angular-demo:validate-training-data",
                "--excludeTaskDependencies",
                "--",
                str(evaluation / "adapter-candidates.jsonl"),
                str(evaluation / "adapter-validation.jsonl"),
            ],
            cwd=ROOT,
            env=nxenv,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=True,
        )
    run(
        [
            sys.executable,
            str(HERE / "compare-eval-rounds.py"),
            "--previous",
            str(root.parent / "round2/evaluation/adapter-validation.jsonl"),
            "--current",
            str(evaluation / "adapter-validation.jsonl"),
            "--output",
            str(root / "round-comparison.json"),
        ],
        "known-suite-comparison.log",
    )
    status("exporting", training_started=True, selected=selected)
    model_id = "round3-" + adapter_hash[:12]
    output = root / "browser-models" / model_id
    env = dict(os.environ)
    env["OPENBLAS_NUM_THREADS"] = "4"
    with (root / "export.log").open("w") as stream:
        subprocess.run(
            [
                "/Users/wolfmanfx/.unsloth/studio/a2ui-export-env/bin/python",
                str(HERE / "export-browser-adapter.py"),
                "--base-dir",
                str(root.parent / "export-probe"),
                "--adapter",
                str(checkpoint),
                "--output-dir",
                str(output),
            ],
            cwd=ROOT,
            env=env,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=True,
        )
    artifact = json.loads((output / "a2ui-export-manifest.json").read_text())
    assert artifact["adapter_sha256"] == adapter_hash
    # Selection is frozen before the blind set can be served to the browser.
    frozen = {
        "model_id": model_id,
        "directory": str(output),
        "adapter_sha256": adapter_hash,
        "files": artifact["files"],
        "blind_cases_sha256": selected["blind_cases_sha256"],
        "blind_case_count": 300,
        "browser_verified": False,
    }
    (root / "browser-ready.json").write_text(json.dumps(frozen, indent=2) + "\n")
    status(
        "awaiting_browser_evaluation",
        training_started=True,
        exported=True,
        model_id=model_id,
        blind_cases=300,
    )


try:
    main()
except Exception as error:
    status("failed", error=str(error))
    raise
