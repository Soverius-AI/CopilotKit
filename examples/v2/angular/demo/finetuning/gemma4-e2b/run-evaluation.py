"""Generate first-attempt Studio candidates for the frozen acceptance suite.

This is offline MLX evaluation. The separate native compiler gate and real
ONNX browser checks must run before any model promotion.
"""

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from transformers import AutoTokenizer

parser = argparse.ArgumentParser()
parser.add_argument("--inputs", type=Path, required=True)
parser.add_argument("--model", required=True)
parser.add_argument("--label", choices=["base", "pilot", "adapter"], required=True)
parser.add_argument("--output-dir", type=Path, required=True)
parser.add_argument("--browser-template", type=Path, required=True)
parser.add_argument(
    "--session-file", type=Path, default=Path("/tmp/unsloth-a2ui-session.json")
)
args = parser.parse_args()
tokenizer = AutoTokenizer.from_pretrained(
    "unsloth/gemma-4-E2B-it",
    revision="d36bdd3855c82a6a1a23f7c459b749f5724ae75d",
    local_files_only=True,
    trust_remote_code=False,
)
browser_template = args.browser_template.read_text()
bench_dir = Path(__file__).parent / "evaluation"
manifest = json.loads((bench_dir / "manifest.json").read_text())
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
assert sha((bench_dir / "cases.jsonl").read_text()) == manifest["cases_sha256"]
cases = [json.loads(x) for x in args.inputs.read_text().splitlines()]
expected = {r["case_id"]: r for r in manifest["cases"]}
assert len(cases) == len(expected) and {r["case_id"] for r in cases} == set(expected)
for row in cases:
    assert sha(row["request"]) == expected[row["case_id"]]["request_sha256"]
    assert sha(row["system_prompt"]) == manifest["system_prompt_sha256"]
    assert "source" not in row and "dsl" not in row
assert args.session_file.stat().st_mode & 0o077 == 0, "Session file must be private"
args.output_dir.mkdir(parents=True, exist_ok=True)
output = args.output_dir / (args.label + "-candidates.jsonl")
assert not output.exists(), (
    "Use a new run directory; never overwrite evaluation results"
)


def send(path, body=None, token=None, timeout=600):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        "http://127.0.0.1:8898" + path,
        data=None if body is None else json.dumps(body).encode(),
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def api(path, body=None):
    session = json.loads(args.session_file.read_text())
    try:
        return send(path, body, session["access_token"])
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
        session = send("/api/auth/refresh", {"refresh_token": session["refresh_token"]})
        args.session_file.write_text(json.dumps(session))
        args.session_file.chmod(0o600)
        return send(path, body, session["access_token"])


assert not api("/api/train/status")["is_training_running"], (
    "Wait for training to release memory"
)
state = api("/api/inference/status")
assert not state.get("loaded") and not state.get("loading"), (
    "Leave unrelated inference models untouched"
)
print(json.dumps({"loading": args.label, "model": args.model}), flush=True)
loaded = api(
    "/api/inference/load",
    dict(
        model_path=args.model,
        is_lora=args.label != "base",
        load_in_4bit=True,
        max_seq_length=32768,
        chat_template_override=browser_template,
        trust_remote_code=False,
    ),
)
(args.output_dir / (args.label + "-load.json")).write_text(json.dumps(loaded, indent=2))
state = api("/api/inference/status")
assert (
    state.get("is_mlx")
    and len(state.get("loaded", [])) == 1
    and not state.get("loading")
), "Model load failed"
active_model = state["loaded"][0]
weights = {}
if args.label != "base":
    checkpoint = Path(args.model)
    config = json.loads((checkpoint / "adapter_config.json").read_text())
    weights = {
        "base_revision": config.get("base_model_commit_hash"),
        "adapter_sha256": hashlib.sha256(
            (checkpoint / "adapters.safetensors").read_bytes()
        ).hexdigest(),
    }
elif Path(args.model).is_dir():
    weights = {"base_revision": Path(args.model).name}
metadata = dict(
    label=args.label,
    requested_model=args.model,
    loaded_model=active_model,
    backend="studio_mlx_offline",
    browserVerified=False,
    requested_load_in_4bit=True,
    resolved_load_in_4bit=state.get("load_in_4bit"),
    engine_precision=state.get("engine_precision"),
    benchmark_sha256=manifest["cases_sha256"],
    system_prompt_sha256=manifest["system_prompt_sha256"],
    generation=manifest["generation"],
    weights=weights,
    first_attempt_only=True,
    automatic_repairs=0,
    harness="raw_browser_tokens_v2",
    endpoint="/v1/completions",
)
(args.output_dir / (args.label + "-run.json")).write_text(
    json.dumps(metadata, indent=2)
)
try:
    for case in cases:
        started = time.monotonic()
        messages = [
            {"role": "system", "content": case["system_prompt"]},
            {"role": "user", "content": case["model_request"]},
        ]
        rendered = tokenizer.apply_chat_template(
            messages,
            chat_template=browser_template,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        ids = tokenizer.encode(rendered, add_special_tokens=False)
        response = api(
            "/v1/completions",
            dict(
                model=active_model,
                prompt=ids,
                stream=False,
                temperature=0,
                top_p=1,
                top_k=1,
                min_p=0,
                repeat_penalty=1.0,
                presence_penalty=0,
                frequency_penalty=0,
                max_tokens=3072,
                seed=3407,
            ),
        )
        actual_tokens = response["usage"]["prompt_tokens"]
        assert actual_tokens == len(ids), (
            f"Prompt mismatch: browser {len(ids)}, Studio {actual_tokens}"
        )
        evidence = dict(
            browser_prompt_tokens=len(ids),
            actual_prompt_tokens=actual_tokens,
            prompt_token_ids_sha256=sha(json.dumps(ids, separators=(",", ":"))),
            exact_token_ids_sent=True,
        )
        result = {
            **case,
            **metadata,
            "source": response["choices"][0]["text"],
            "prompt_evidence": evidence,
            "model_response": response,
            "elapsed_seconds": time.monotonic() - started,
        }
        with output.open("a") as f:
            f.write(json.dumps(result, ensure_ascii=False) + "\n")
        print(
            json.dumps(
                {
                    "case_id": case["case_id"],
                    "model": args.label,
                    "seconds": round(result["elapsed_seconds"], 1),
                    "finish_reason": response["choices"][0]["finish_reason"],
                }
            ),
            flush=True,
        )
finally:
    api("/api/inference/unload", {"model_path": active_model})
print(
    json.dumps(
        {"complete": args.label, "candidates": len(cases), "output": str(output)}
    ),
    flush=True,
)
