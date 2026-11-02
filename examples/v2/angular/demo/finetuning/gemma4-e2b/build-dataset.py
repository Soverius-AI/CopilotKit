"""Build a small SFT pilot from accepted, model-generated programs only."""

import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument(
    "--collection",
    action="append",
    required=True,
    help="provenance=validation.jsonl; later accepted rows take precedence",
)
parser.add_argument("--output-dir", type=Path, required=True)
parser.add_argument("--held-out-family", action="append", default=[])
parser.add_argument("--min-train", type=int, default=16)
parser.add_argument("--min-eval", type=int, default=2)
parser.add_argument(
    "--protected-evaluation", type=Path, default=Path(__file__).parent / "evaluation"
)
args = parser.parse_args()
validator_hash = hashlib.sha256(
    (Path(__file__).parent / "validate-express.ts").read_bytes()
).hexdigest()
protected_manifest = json.loads(
    (args.protected_evaluation / "manifest.json").read_text()
)
protected_content = (args.protected_evaluation / "cases.jsonl").read_text()
protected_hash = hashlib.sha256(protected_content.encode()).hexdigest()
if protected_hash != protected_manifest["cases_sha256"]:
    raise ValueError("Frozen evaluation content changed")
protected_rows = [json.loads(line) for line in protected_content.splitlines()]
protected_ids = {row["case_id"] for row in protected_rows}
protected_requests = {row["request"] for row in protected_rows}
protected_titles = {row.get("spec", {}).get("title") for row in protected_rows} - {
    None,
    "",
}
if args.output_dir.resolve().is_relative_to(args.protected_evaluation.resolve()):
    raise ValueError(
        "Training output must be outside the protected evaluation directory"
    )
chosen = {}
for item in args.collection:
    provenance, filename = item.split("=", 1)
    for line in Path(filename).read_text().splitlines():
        row = json.loads(line)
        spec = (
            json.loads(row["spec_json"]) if "spec_json" in row else row.get("spec", {})
        )
        user = row.get("initial_model_request", row.get("model_request", ""))
        if (
            row.get("case_id") in protected_ids
            or row.get("request") in protected_requests
            or row.get("evaluation_split") in {"acceptance", "browser_regression"}
            or spec.get("title") in protected_titles
            or any(request in user for request in protected_requests)
        ):
            raise ValueError(
                "Protected evaluation row cannot enter training: "
                + str(row.get("case_id"))
            )
        if row.get("collection") == "regression":
            continue
        validation = row.get("validation", {})
        if not validation.get("accepted"):
            continue
        if validation.get("validatorSha256") != validator_hash:
            raise ValueError("Revalidate stale accepted row: " + row["case_id"])
        identity = row["case_id"]
        if (
            hashlib.sha256(row["system_prompt"].encode()).hexdigest()
            != protected_manifest["system_prompt_sha256"]
        ):
            raise ValueError("Training prompt differs from the frozen evaluation guide")
        if identity in chosen and chosen[identity]["user"] != user:
            raise ValueError("Case ID has conflicting original requests: " + identity)
        chosen[identity] = {
            "row": row,
            "user": user,
            "provenance": row.get("collection", provenance),
        }
held_out = {"quoted_strings", "currency_preserved", *args.held_out_family}
splits = {"train": [], "eval": []}
manifest = []
for identity, data in sorted(chosen.items()):
    row = data["row"]
    split = "eval" if row["scenario_family"] in held_out else "train"
    messages = [
        {"role": "system", "content": row["system_prompt"]},
        {"role": "user", "content": data["user"]},
        {"role": "assistant", "content": row["source"]},
    ]
    splits[split].append({"messages": messages})
    manifest.append(
        {
            "case_id": identity,
            "split": split,
            "scenario_family": row["scenario_family"],
            "provenance": data["provenance"],
            "browserVerified": False,
            "validatorSha256": validator_hash,
            "source_sha256": hashlib.sha256(row["source"].encode()).hexdigest(),
            "system_prompt_sha256": hashlib.sha256(
                row["system_prompt"].encode()
            ).hexdigest(),
            "original_generation_system_sha256": row.get(
                "original_generation_system_sha256",
                hashlib.sha256(row["system_prompt"].encode()).hexdigest(),
            ),
        }
    )
if len(splits["train"]) < args.min_train or len(splits["eval"]) < args.min_eval:
    raise ValueError(
        "Insufficient verified pilot data: "
        + str({k: len(v) for k, v in splits.items()})
    )
args.output_dir.mkdir(parents=True, exist_ok=True)
for split, rows in splits.items():
    (args.output_dir / (split + ".jsonl")).write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    )
(args.output_dir / "manifest.json").write_text(
    json.dumps(
        {
            "status": "offline_pilot_only",
            "counts": {k: len(v) for k, v in splits.items()},
            "held_out_families": sorted(held_out),
            "protected_evaluation_sha256": protected_hash,
            "evaluation_leak_checks_passed": True,
            "browserVerified": False,
            "rows": manifest,
        },
        ensure_ascii=False,
        indent=2,
    )
    + "\n"
)
print(
    json.dumps(
        {
            "counts": {k: len(v) for k, v in splits.items()},
            "output": str(args.output_dir),
            "browserVerified": False,
        }
    )
)
