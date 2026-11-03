"""Bounded teacher comparison using synthetic training cases only; never blind data."""

import argparse
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--input", type=Path, action="append", required=True)
p.add_argument("--output-dir", type=Path, required=True)
args = p.parse_args()
root = args.output_dir.resolve()
root.mkdir(parents=True, exist_ok=False)
accepted = {}
for path in args.input:
    for line in path.read_text().splitlines():
        row = json.loads(line)
        if isinstance(row.get("spec_json"), str):
            row["spec"] = json.loads(row["spec_json"])
        if row["validation"]["accepted"] and row.get("quality_gate", {}).get(
            "request_fidelity", True
        ):
            accepted[row["case_id"]] = row
ordered = sorted(accepted.values(), key=lambda r: len(r["spec"]["required_fields"]))
selected = [ordered[0], ordered[len(ordered) // 2], ordered[-1]]
assert len({r["case_id"] for r in selected}) == 3
assert all(r["split"] == "train" for r in selected)
schema = {
    "type": "object",
    "additionalProperties": False,
    "required": ["examples"],
    "properties": {
        "examples": {
            "type": "array",
            "minItems": 3,
            "maxItems": 3,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["case_id", "source"],
                "properties": {
                    "case_id": {
                        "type": "string",
                        "enum": [r["case_id"] for r in selected],
                    },
                    "source": {"type": "string"},
                },
            },
        }
    },
}
(root / "schema.json").write_text(json.dumps(schema, indent=2) + "\n")
cases = []
for row in selected:
    oracle = {k: v for k, v in row["spec"].items() if k != "required_fields"}
    oracle["required_fields"] = [
        {k: v for k, v in field.items() if k != "value"}
        for field in row["spec"]["required_fields"]
    ]
    cases.append(
        {
            "case_id": row["case_id"],
            "user_request": row["initial_model_request"],
            "requirements": oracle,
        }
    )
prompt = (
    "Act only as a synthetic UI-program teacher. Do not use tools, read files, run commands, change files, commit or push. All context is supplied here. "
    "For each of the three synthetic training cases below, generate a complete Express program following the standard SDK guide. "
    "Return only the requested JSON object. Each source must be exactly one <a2ui> block. Use minimal styling. "
    "Preserve all visible facts, item-price associations, control kinds, options in order, exact initial values, unique bindings and a submit Event containing every path. "
    "A form needs a submit=true Button inside it. Never prefill later user entries or show a review before submission. "
    "For an informational card use no Form, inputs or buttons. Every declared component must be reachable. "
    "Use the actual outer constructor in root, never an alias.\n\nSTANDARD SDK EXPRESS GUIDE:\n"
    + selected[0]["system_prompt"]
    + "\n\nCASES:\n"
    + json.dumps(cases, ensure_ascii=False)
)
(root / "prompt.txt").write_text(prompt)
binary = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
started = time.monotonic()
environment = dict(os.environ)
with (
    tempfile.TemporaryDirectory(prefix="a2ui-codex-teacher-") as empty_workspace,
    (root / "events.jsonl").open("w") as events,
    (root / "stderr.log").open("w") as errors,
):
    command = [
        binary,
        "exec",
        "--ignore-user-config",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        "--output-schema",
        str(root / "schema.json"),
        "--output-last-message",
        str(root / "response.json"),
        "-",
    ]
    result = subprocess.run(
        command,
        input=prompt,
        text=True,
        cwd=empty_workspace,
        env=environment,
        stdout=events,
        stderr=errors,
        timeout=900,
    )
    assert result.returncode == 0, "Codex teacher failed; inspect preserved logs"
response = json.loads((root / "response.json").read_text())
sources = {r["case_id"]: r["source"] for r in response["examples"]}
assert len(sources) == 3 and set(sources) == {r["case_id"] for r in selected}
output = [
    {
        **row,
        "source": sources[row["case_id"]],
        "teacher": "codex_cli_pilot",
        "validation": None,
    }
    for row in selected
]
(root / "candidates.jsonl").write_text(
    "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in output)
)
receipt = {
    "teacher": "Codex CLI via existing ChatGPT login",
    "cases": 3,
    "field_counts": [len(r["spec"]["required_fields"]) for r in selected],
    "elapsed_seconds": time.monotonic() - started,
    "blind_data_used": False,
    "acceptance": "pending independent compiler/content checks",
}
(root / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt), flush=True)
