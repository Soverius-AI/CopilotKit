"""Run or collect an actual Studio Data Recipe; preserve raw model-generated rows."""

import argparse
import importlib.util
import json
import time
from pathlib import Path

module_spec = importlib.util.spec_from_file_location(
    "studio_api", Path(__file__).with_name("studio-api.py")
)
module = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(module)
api = module.Studio()
p = argparse.ArgumentParser()
p.add_argument("--recipe", type=Path)
p.add_argument("--job", type=Path)
p.add_argument("--output-prefix", type=Path, required=True)
args = p.parse_args()
assert bool(args.recipe) != bool(args.job), "Provide one recipe or existing job"
prefix = args.output_prefix
prefix.parent.mkdir(parents=True, exist_ok=True)
if args.recipe:
    payload = json.loads(args.recipe.read_text())
    validation = api.request("/api/data-recipe/validate", payload)
    assert validation["valid"], validation
    job = api.request("/api/data-recipe/jobs", payload)
    prefix.with_suffix(".job.json").write_text(json.dumps(job, indent=2) + "\n")
else:
    job = json.loads(args.job.read_text())
job_id = job["job_id"]
print(json.dumps({"job_id": job_id}), flush=True)
deadline = time.monotonic() + 7200
previous = None
while True:
    status = api.request(f"/api/data-recipe/jobs/{job_id}/status")
    prefix.with_suffix(".status.json").write_text(json.dumps(status, indent=2) + "\n")
    progress = status.get("progress") or {}
    state = (status["status"], progress.get("done"))
    if state != previous:
        print(
            json.dumps(
                {
                    "job_id": job_id,
                    "status": state[0],
                    "done": state[1],
                    "total": progress.get("total"),
                    "eta_seconds": progress.get("eta_sec"),
                }
            ),
            flush=True,
        )
        previous = state
    if status["status"] in ["completed", "complete", "done"]:
        break
    if status["status"] in ["failed", "error", "cancelled", "canceled"]:
        raise RuntimeError(status.get("error") or status["status"])
    assert time.monotonic() < deadline, "Data Recipe exceeded bounded wait"
    time.sleep(15)
dataset = api.request(f"/api/data-recipe/jobs/{job_id}/dataset?offset=0&limit=100")
rows = list(dataset["dataset"])
while len(rows) < dataset["total"]:
    page = api.request(
        f"/api/data-recipe/jobs/{job_id}/dataset?offset={len(rows)}&limit=100"
    )
    assert page["dataset"], "Dataset paging stalled"
    rows.extend(page["dataset"])
assert len(rows) == dataset["total"], "Partial dataset received"
dataset["dataset"] = rows
raw = prefix.with_suffix(".dataset.json")
assert not raw.exists(), "Preserve prior generations"
raw.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n")
prefix.with_suffix(".candidates.jsonl").write_text(
    "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
)
print(
    json.dumps(
        {
            "collected": len(rows),
            "candidates": str(prefix.with_suffix(".candidates.jsonl")),
        }
    ),
    flush=True,
)
