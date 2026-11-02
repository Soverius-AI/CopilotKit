"""Compare paired first attempts, keeping offline scores separate from browser acceptance."""

import argparse
import hashlib
import json
import statistics
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--base", type=Path, required=True)
p.add_argument("--adapter", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
args = p.parse_args()
manifest = json.loads((Path(__file__).parent / "evaluation/manifest.json").read_text())
expected = {row["case_id"]: row for row in manifest["cases"]}


def read(path):
    rows = [json.loads(x) for x in path.read_text().splitlines()]
    assert len(rows) == len(expected) and {x["case_id"] for x in rows} == set(
        expected
    ), "Incomplete benchmark"
    for row in rows:
        assert row["benchmark_sha256"] == manifest["cases_sha256"], "Benchmark drift"
        assert row["system_prompt_sha256"] == manifest["system_prompt_sha256"], (
            "Prompt drift"
        )
        assert row["first_attempt_only"] and row["automatic_repairs"] == 0
        assert row.get("harness") == "raw_browser_tokens_v2", (
            "Legacy chat-endpoint results are not browser-prompt comparable"
        )
        assert row["prompt_evidence"]["exact_token_ids_sent"]
        assert (
            row["prompt_evidence"]["browser_prompt_tokens"]
            == row["prompt_evidence"]["actual_prompt_tokens"]
        )
        assert row["generation"] == manifest["generation"], "Generation settings differ"
        assert (
            hashlib.sha256(row["request"].encode()).hexdigest()
            == expected[row["case_id"]]["request_sha256"]
        )
        assert row["validation"]["level"] == "compiler_graph_and_owned_state"
    return {row["case_id"]: row for row in rows}


models = {"base": read(args.base), "adapter": read(args.adapter)}
assert (
    len(
        {
            r["validation"]["validatorSha256"]
            for rows in models.values()
            for r in rows.values()
        }
    )
    == 1
), "Validator changed between models"
summary = {}
for name, rows in models.items():
    groups = {}
    for split in ["acceptance", "browser_regression"]:
        selected = [r for key, r in rows.items() if expected[key]["split"] == split]
        passed = sum(r["validation"]["accepted"] for r in selected)
        groups[split] = {
            "passed": passed,
            "total": len(selected),
            "first_pass_rate": passed / len(selected),
            "median_seconds": statistics.median(r["elapsed_seconds"] for r in selected),
        }
    categories = {}
    for row in rows.values():
        if row["evaluation_split"] != "acceptance":
            continue
        category = row["scenario_family"].removeprefix("acceptance_")
        group = categories.setdefault(category, {"passed": 0, "total": 0})
        group["total"] += 1
        group["passed"] += int(row["validation"]["accepted"])
    summary[name] = {"splits": groups, "categories": categories}
paired = []
for case_id in expected:
    base, adapter = (models[x][case_id] for x in ["base", "adapter"])
    assert (
        base["model_request"] == adapter["model_request"]
        and base["system_prompt"] == adapter["system_prompt"]
    )
    assert (
        base["prompt_evidence"]["prompt_token_ids_sha256"]
        == adapter["prompt_evidence"]["prompt_token_ids_sha256"]
    )
    assert Path(base["requested_model"]).name == adapter["weights"]["base_revision"], (
        "Base checkpoint revision differs"
    )
    paired.append(
        {
            "case_id": case_id,
            "split": expected[case_id]["split"],
            "base_pass": base["validation"]["accepted"],
            "adapter_pass": adapter["validation"]["accepted"],
            "base_error": base["validation"].get("error"),
            "adapter_error": adapter["validation"].get("error"),
            "base_seconds": base["elapsed_seconds"],
            "adapter_seconds": adapter["elapsed_seconds"],
        }
    )
result = {
    "benchmark_version": manifest["version"],
    "benchmark_sha256": manifest["cases_sha256"],
    "harness": "raw_browser_tokens_v2",
    "prompt_token_parity_verified": True,
    "status": "offline_evaluation_complete_browser_gate_pending",
    "browserVerified": False,
    "system_prompt_sha256": manifest["system_prompt_sha256"],
    "summary": summary,
    "cases": paired,
    "acceptance_improved": summary["adapter"]["splits"]["acceptance"]["passed"]
    > summary["base"]["splits"]["acceptance"]["passed"],
    "regressions": [
        r["case_id"] for r in paired if r["base_pass"] and not r["adapter_pass"]
    ],
    "fixed": [r["case_id"] for r in paired if not r["base_pass"] and r["adapter_pass"]],
    "offline_threshold_met": summary["adapter"]["splits"]["acceptance"][
        "first_pass_rate"
    ]
    >= manifest["promotion_gate"]["acceptance_first_pass_minimum"],
    "promote_browser_model": False,
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(
    json.dumps(
        {
            k: result[k]
            for k in [
                "summary",
                "fixed",
                "regressions",
                "offline_threshold_met",
                "promote_browser_model",
            ]
        }
    )
)
