"""Bound the lifetime of a temporary caffeinate process to this experiment."""

import argparse
import json
import time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--round", type=Path, required=True)
p.add_argument("--hours", type=float, default=24)
args = p.parse_args()
deadline = time.monotonic() + args.hours * 3600
while time.monotonic() < deadline:
    if (args.round / "browser-evaluation-completed.json").exists():
        break
    failed = False
    for name in ["continuation-status.json", "bulk/status.json"]:
        try:
            if json.loads((args.round / name).read_text()).get("phase") == "failed":
                failed = True
        except (FileNotFoundError, json.JSONDecodeError):
            pass
    if failed:
        break
    time.sleep(30)
print(
    "Experiment watcher finished; temporary idle-sleep prevention released.", flush=True
)
