"""Check expanded SFT files without reading evaluation cases into model requests."""

import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--dataset-dir", type=Path, required=True)
p.add_argument("--protection", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
args = p.parse_args()
root = Path(__file__).parent
protected = json.loads(args.protection.read_text())
for name, digest in protected["protected_files"].items():
    assert (
        hashlib.sha256((root / "evaluation" / name).read_bytes()).hexdigest() == digest
    ), "Frozen evaluation changed"
benchmark = json.loads((root / "evaluation/manifest.json").read_text())
cases = [
    json.loads(x) for x in (root / "evaluation/cases.jsonl").read_text().splitlines()
]
manifest = json.loads((args.dataset_dir / "manifest.json").read_text())
assert manifest["evaluation_leak_checks_passed"]
assert manifest["protected_evaluation_sha256"] == benchmark["cases_sha256"]
assert not (
    {row["case_id"] for row in manifest["rows"]} & {row["case_id"] for row in cases}
)
hashes = {}
counts = {}
prompt_hashes = set()
for split in ["train", "eval"]:
    rows = [
        json.loads(x)
        for x in (args.dataset_dir / (split + ".jsonl")).read_text().splitlines()
    ]
    counts[split] = len(rows)
    hashes[split] = {"requests": set(), "targets": set()}
    for row in rows:
        messages = row["messages"]
        assert [m["role"] for m in messages] == ["system", "user", "assistant"]
        system, user, target = (m["content"] for m in messages)
        digest = hashlib.sha256(system.encode()).hexdigest()
        assert digest == benchmark["system_prompt_sha256"], "Noncanonical system guide"
        prompt_hashes.add(digest)
        assert (
            "Offline teacher task" not in user
            and "MODEL-GENERATED compiler-verified reference" not in user
        ), "Teacher scaffolding leaked into student input"
        for case in cases:
            assert case["request"] not in user, "Frozen evaluation request leaked"
            title = case.get("spec", {}).get("title")
            if title:
                assert title not in user and title not in target, (
                    "Frozen evaluation title leaked"
                )
        hashes[split]["requests"].add(hashlib.sha256(user.encode()).hexdigest())
        hashes[split]["targets"].add(hashlib.sha256(target.encode()).hexdigest())
assert not (hashes["train"]["requests"] & hashes["eval"]["requests"]), (
    "Training/validation request overlap"
)
assert not (hashes["train"]["targets"] & hashes["eval"]["targets"]), (
    "Training/validation target overlap"
)
assert counts == manifest["counts"]
result = dict(
    passed=True,
    counts=counts,
    frozen_eval_unchanged=True,
    acceptance_rows_used_in_training=0,
    training_validation_request_overlap=0,
    training_validation_target_overlap=0,
    canonical_system_prompt_sha256=next(iter(prompt_hashes)),
    teacher_scaffolding_in_student_inputs=False,
    protected_files=protected["protected_files"],
    dataset_sha256={
        s: hashlib.sha256((args.dataset_dir / (s + ".jsonl")).read_bytes()).hexdigest()
        for s in counts
    },
)
args.output.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
