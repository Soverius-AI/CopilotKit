"""Reject generated requests that disagree with their deterministic specification."""

import argparse
import json
import re
import unicodedata
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("input", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()


def normalized(value):
    return " ".join(unicodedata.normalize("NFC", str(value)).casefold().split())


raw = args.input.read_text()
try:
    dataset = json.loads(raw)
    rows = dataset.get("dataset", []) if isinstance(dataset, dict) else dataset
except json.JSONDecodeError:
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
accepted, rejected = [], []
for row in rows:
    spec = json.loads(row["spec_json"])
    text = row.get("request", "")
    errors = []
    required = list(spec["required_text"]) + [spec["submit_label"]]
    required += [field["label"] for field in spec["required_fields"]]
    required += [
        option for field in spec["required_fields"] for option in field["options"]
    ]
    for value in required:
        if value and normalized(value) not in normalized(text):
            errors.append("Missing exact requested content: " + value)
    keys = [field["key"] for field in spec["required_fields"]]
    labels = [normalized(field["label"]) for field in spec["required_fields"]]
    if len(set(keys)) != len(keys) or len(set(labels)) != len(labels):
        errors.append("Duplicate keys or labels in specification")
    if re.search(r"\b(terms|agreement|payment|credit card)\b", text, re.I):
        errors.append("Invented transactional or agreement requirement")
    if spec["required_fields"]:
        for clause in ["when i submit", "original editable form", "same surface"]:
            if clause not in normalized(text):
                errors.append("Missing submission/preservation requirement: " + clause)
    for field in spec["required_fields"]:
        if field["kind"] == "checkbox" and field["value"] not in ["true", "false"]:
            errors.append("Invalid checkbox test value")
        if field["kind"] == "select" and field["value"] not in field["options"]:
            errors.append("Invalid select test value")
    result = {
        **row,
        "spec": spec,
        "scenario_audit": {
            "accepted": not errors,
            "errors": errors,
            "browserVerified": False,
        },
    }
    (rejected if errors else accepted).append(result)
args.output.write_text(
    "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in accepted)
)
reject_path = args.output.with_name(args.output.stem + "-rejected.jsonl")
reject_path.write_text(
    "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rejected)
)
print(
    json.dumps(
        {
            "rows": len(rows),
            "accepted": len(accepted),
            "rejected": len(rejected),
            "output": str(args.output),
            "rejections": str(reject_path),
        }
    )
)
