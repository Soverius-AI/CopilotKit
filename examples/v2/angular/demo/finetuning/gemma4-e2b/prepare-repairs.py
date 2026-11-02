"""Keep failed model drafts as input evidence, never assistant targets."""

import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("input", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--origin", default="target_e2b_mlx")
args = parser.parse_args()
repairs = []
for line in args.input.read_text().splitlines():
    row = json.loads(line)
    if row["validation"]["accepted"]:
        continue
    spec = json.loads(row["spec_json"])
    draft = row.pop("source")
    error = row.pop("validation")["error"]
    row["draft"] = draft
    row["diagnostic"] = error
    row["initial_model_request"] = row.get(
        "initial_model_request", row["model_request"]
    )
    row["repair_round"] = row.get("repair_round", 0) + 1
    row["repair_origin"] = args.origin
    phase = (
        (
            "This is a CREATE turn. The host calls the model again after the submit Event. "
            "Generate only the initial interface, with no review/summary section or if/visibility conditions. "
            "The Form Event must carry every input path. Initialize every input path at the top. "
            "The later ACTION reply generates the review."
        )
        if spec["required_fields"]
        else ("This is CARD ONLY: no Form, input or submit Button.")
    )
    row["model_request"] = (
        row["initial_model_request"] + "\n\nThe draft below was rejected. "
        "Fix only its defects, preserving everything the actual request requires.\n"
        + phase
        + "\nExact required content: "
        + json.dumps(spec["required_text"], ensure_ascii=False)
        + "\nDiagnostic: "
        + error
        + "\nRejected draft:\n"
        + draft
        + "\nReturn only the complete corrected <a2ui> block."
    )
    repairs.append(row)
args.output.write_text(
    "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in repairs)
)
print(
    json.dumps(
        {
            "repair_inputs": len(repairs),
            "origin": args.origin,
            "output": str(args.output),
        }
    )
)
