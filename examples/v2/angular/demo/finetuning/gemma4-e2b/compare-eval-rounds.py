"""Compare the unchanged known suite after selection; never select on these results."""

import argparse
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--previous", type=Path, required=True)
p.add_argument("--current", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
args = p.parse_args()


def read(path):
    data = [json.loads(line) for line in path.read_text().splitlines()]
    result = {r["case_id"]: r for r in data}
    assert len(result) == len(data)
    return result


previous, current = read(args.previous), read(args.current)
assert set(previous) == set(current)
paired = []
for identity, old in previous.items():
    new = current[identity]
    for key in [
        "benchmark_sha256",
        "system_prompt_sha256",
        "harness",
        "generation",
        "model_request",
        "system_prompt",
    ]:
        assert old[key] == new[key], key + " changed"
    assert old["harness"] == "raw_browser_tokens_v2"
    assert (
        old["prompt_evidence"]["prompt_token_ids_sha256"]
        == new["prompt_evidence"]["prompt_token_ids_sha256"]
    )
    assert old["validation"]["validatorSha256"] == new["validation"]["validatorSha256"]
    assert old["weights"]["base_revision"] == new["weights"]["base_revision"]
    for row in [old, new]:
        assert (
            row["first_attempt_only"]
            and row["automatic_repairs"] == 0
            and row["prompt_evidence"]["exact_token_ids_sent"]
        )
    paired.append(
        {
            "case_id": identity,
            "split": old["evaluation_split"],
            "previous_pass": old["validation"]["accepted"],
            "current_pass": new["validation"]["accepted"],
            "previous_error": old["validation"].get("error"),
            "current_error": new["validation"].get("error"),
        }
    )
summary = {}
for split in sorted({row["split"] for row in paired}):
    selected = [row for row in paired if row["split"] == split]
    before = sum(row["previous_pass"] for row in selected)
    after = sum(row["current_pass"] for row in selected)
    summary[split] = {
        "previous_passed": before,
        "current_passed": after,
        "total": len(selected),
        "change_percentage_points": 100 * (after - before) / len(selected),
    }
report = {
    "status": "paired_offline_comparison",
    "browserVerified": False,
    "checkpoint_selection_used_this_suite": False,
    "summary": summary,
    "cases": paired,
    "fixed": [
        r["case_id"] for r in paired if not r["previous_pass"] and r["current_pass"]
    ],
    "regressions": [
        r["case_id"] for r in paired if r["previous_pass"] and not r["current_pass"]
    ],
}
args.output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(summary), flush=True)
