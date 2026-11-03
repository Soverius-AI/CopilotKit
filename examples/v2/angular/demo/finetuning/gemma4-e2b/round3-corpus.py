"""Generate a sealed corpus with Studio Data Recipes, then gate actual model output.

No target DSL is authored or patched here. Failed outputs go back to the local
teacher via Studio. Teacher-only scaffolding never enters the student messages.
"""

import argparse
import collections
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
spec = importlib.util.spec_from_file_location("studio_api", HERE / "studio-api.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
api = mod.Studio()


def rows(path):
    data = [json.loads(x) for x in Path(path).read_text().splitlines() if x.strip()]
    for row in data:
        # DataDesigner may stringify mixed scalar types inside nested structures.
        # The immutable JSON oracle is lossless; never infer types from its table view.
        if isinstance(row.get("spec_json"), str):
            row["spec"] = json.loads(row["spec_json"])
    return data


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in data))
    path.chmod(0o600)


def norm(text):
    return re.sub(
        r"\s+",
        " ",
        unicodedata.normalize("NFC", str(text)).translate(
            str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})
        ),
    ).strip()


def request_problems(row):
    request = norm(row.get("request", ""))
    oracle = row["spec"]
    errors = []
    for fact in oracle["required_text"]:
        if norm(fact) not in request:
            errors.append("Request omitted exact visible fact: " + str(fact))
    for field in oracle["required_fields"]:
        if norm(field["label"]) not in request:
            errors.append("Request omitted input label: " + field["label"])
        cursor = 0
        for option in field["options"]:
            position = request.find(norm(option), cursor)
            if position < 0:
                errors.append("Request omitted/reordered options for " + field["label"])
                break
            cursor = position + len(norm(option))
        value = field["value"]
        if (
            field["kind"] not in ["select", "checkbox", "number"]
            and isinstance(value, str)
            and len(value) > 4
            and value != field["initial"]
            and norm(value) in request
        ):
            errors.append("Request leaked a later test entry for " + field["label"])
    for sentence in row["initial_sentences"]:
        if norm(sentence).casefold() not in request.casefold():
            errors.append("Request omitted initial-state requirement: " + sentence)
    if oracle["required_fields"] and norm(oracle["submit_label"]) not in request:
        errors.append("Request omitted submit label")
    return errors


def association_problems(row):
    components = {}
    for operation in row["validation"].get("operations", []):
        body = operation.get("createSurface") or operation.get("updateComponents") or {}
        components.update({x["id"]: x for x in body.get("components", [])})
    resolved = row.get("supplemental_display", {})
    if resolved.get("error"):
        return ["SDK display resolution failed: " + resolved["error"]]
    by_component = resolved.get("byComponent", {})
    texts = {}
    for key, c in components.items():
        if c["component"] not in ["Text", "Title", "Caption", "Badge"]:
            continue
        value = by_component.get(key, c.get("text", c.get("label", "")))
        # Binding objects are not visible text. Resolve them through the actual SDK
        # before applying association checks; otherwise fail closed.
        texts[key] = norm(value) if isinstance(value, str) else ""

    def subtree(key, seen=None):
        seen = set() if seen is None else seen
        if key in seen:
            return ""
        seen.add(key)
        c = components.get(key, {})
        children = c.get("children", [])
        if not isinstance(children, list):
            children = [children]
        return " ".join(
            [
                texts.get(key, ""),
                *[subtree(x, seen) for x in children if isinstance(x, str)],
            ]
        )

    all_items = row["spec"]["line_items"] + row["spec"]["amount_rows"]
    errors = []
    if not row["spec"]["required_fields"] and any(
        c["component"] in ["Button", "Form"] for c in components.values()
    ):
        errors.append("Informational card must have no Form or Button")
    for field in row["spec"]["required_fields"]:
        if field["kind"] == "text":
            for component in components.values():
                if component.get("label") == field["label"] and component.get(
                    "variant"
                ) not in [None, "shortText"]:
                    errors.append(
                        "Plain text input must remain a text control: " + field["label"]
                    )
    for pair in all_items:
        name, price = norm(pair["name"]), norm(pair["price"])
        # A single labelled text, a dedicated row/card, or adjacent text children
        # establishes the association. A root containing every item does not.
        candidates = list(texts.values())
        for key, c in components.items():
            if c["component"] in ["Row", "Column", "Card"]:
                content = subtree(key)
                if not any(
                    norm(other["name"]) in content
                    for other in all_items
                    if other["name"] != pair["name"]
                ):
                    candidates.append(content)
            children = c.get("children", [])
            if isinstance(children, list):
                for left, right in zip(children, children[1:]):
                    if left in texts and right in texts:
                        candidates.append(texts[left] + " " + texts[right])
        matched = False
        for content in candidates:
            if name not in content or price not in content:
                continue
            start = content.find(name)
            end = content.find(price, start + len(name))
            if end >= 0 and not any(
                norm(other["name"]) in content[start + len(name) : end]
                for other in all_items
                if other["name"] != pair["name"]
            ):
                matched = True
                break
        if not matched:
            errors.append(
                "Keep item and its own price together: "
                + pair["name"]
                + " = "
                + pair["price"]
            )
    return errors


def validate(path, output):
    env = dict(os.environ)
    env["PATH"] = "/Users/wolfmanfx/.nvm/versions/node/v24.15.0/bin:" + env.get(
        "PATH", ""
    )
    env["NX_DAEMON"] = "false"
    result = subprocess.run(
        [
            str(ROOT / "node_modules/.bin/nx"),
            "run",
            "@copilotkit/angular-demo:validate-training-data",
            "--excludeTaskDependencies",
            "--",
            str(path.resolve()),
            str(output.resolve()),
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    output.with_suffix(".nx.log").write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(
            "Nx validation failed; see " + str(output.with_suffix(".nx.log"))
        )
    result = rows(output)
    for row in result:
        errors = request_problems(row)
        if row["validation"]["accepted"]:
            errors += association_problems(row)
        if errors:
            row["validation"]["accepted"] = False
            row["validation"]["error"] = "; ".join(errors)
        row["quality_gate"] = {
            "request_fidelity": not request_problems(row),
            "item_price_associations": row["validation"]["accepted"],
        }
        row["model_request"] = (
            row["creation_prefix"] + row["request"] + row["creation_suffix"]
        )
        row["initial_model_request"] = row["model_request"]
        row.setdefault("teacher", "local Gemma 4 26B-A4B")
        if Path(path).name.startswith("codex-"):
            row["teacher"] = "Codex CLI (existing ChatGPT login)"
        row["collection"] = (
            "studio_round3_codex"
            if row["teacher"].startswith("Codex")
            else "studio_round3_local"
        )
    save(output, result)
    return result


def recipe_job(seed, recipe_template, prefix, mode, blind=False):
    if prefix.with_suffix(".candidates.jsonl").exists():
        return rows(prefix.with_suffix(".candidates.jsonl"))
    seed = [dict(x) for x in seed]
    for row in seed:
        row["teacher"] = (
            "Codex CLI (existing ChatGPT login)"
            if recipe_template["recipe"]["model_configs"][0]["model"] == "codex-teacher"
            else "local Gemma 4 26B-A4B"
        )
        # Literal prose bullets avoid teaching the request author to copy JSON's
        # backslash escapes into a natural-language initial-value requirement.
        oracle = row["spec"]
        author_spec = {k: v for k, v in oracle.items() if k != "required_fields"}
        author_spec["required_fields"] = [
            {k: v for k, v in field.items() if k not in ["initial", "value"]}
            for field in oracle["required_fields"]
        ]
        row["authoring_prompt"] = (
            row["authoring_prompt"].split("Requirement oracle ")[0]
            + "Requirement oracle (control kinds, labels, options and visible facts): "
            + json.dumps(author_spec, ensure_ascii=False)
            + "\nCopy the following literal initial-state bullets. They are prose, not JSON; do not add backslashes:\n"
            + "\n".join("- " + sentence for sentence in row["initial_sentences"])
        )
        pilot = prefix.parent / "pilot-audited.jsonl"
        if pilot.exists():
            references = [
                r
                for r in rows(pilot)
                if r["validation"]["accepted"]
                and bool(r["spec"]["required_fields"])
                == bool(oracle["required_fields"])
            ]
            if references:
                row["reference"] = min(
                    references,
                    key=lambda r: abs(
                        len(r["spec"]["required_fields"])
                        - len(oracle["required_fields"])
                    ),
                )["source"]
        for key in [
            "validation",
            "quality_gate",
            "model_request",
            "initial_model_request",
            "collection",
        ]:
            row.pop(key, None)
        if mode == "both":
            row.pop("request", None)
        row.pop("source", None)
    seedfile = prefix.with_suffix(".seed.jsonl")
    save(seedfile, seed)
    import base64

    upload = api.request(
        "/api/data-recipe/seed/inspect-upload",
        {
            "filename": seedfile.name,
            "content_base64": base64.b64encode(seedfile.read_bytes()).decode(),
            "preview_size": 1,
        },
    )
    payload = json.loads(json.dumps(recipe_template))
    payload["recipe"]["seed_config"]["source"]["path"] = upload["resolved_path"]
    payload["run"]["rows"] = len(seed)
    columns = payload["recipe"]["columns"]
    if blind:
        payload["recipe"]["columns"] = columns[:1]
    elif mode == "source":
        payload["recipe"]["columns"] = columns[1:]
    recipefile = prefix.with_suffix(".recipe.json")
    recipefile.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    log = prefix.with_suffix(".log")
    with log.open("w") as stream:
        jobfile = prefix.with_suffix(".job.json")
        selector = (
            ["--job", str(jobfile)]
            if jobfile.exists()
            else ["--recipe", str(recipefile)]
        )
        subprocess.run(
            [
                sys.executable,
                str(HERE / "studio-datagen.py"),
                *selector,
                "--output-prefix",
                str(prefix),
            ],
            cwd=ROOT,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=True,
        )
    return rows(prefix.with_suffix(".candidates.jsonl"))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, required=True)
    p.add_argument("--corpus", type=Path, required=True)
    p.add_argument("--recipe", type=Path, required=True)
    p.add_argument("--pilot", type=Path)
    p.add_argument("--batch-size", type=int, default=50)
    p.add_argument("--max-attempts", type=int, default=6)
    p.add_argument("--accepted", type=Path, action="append", default=[])
    p.add_argument("--run-tag", default="")
    p.add_argument("--teacher", default="local Gemma 4 26B-A4B")
    p.add_argument("--train-count", type=int, default=1000)
    args = p.parse_args()
    args.root = args.root.resolve()
    args.corpus = args.corpus.resolve()
    args.root.mkdir(parents=True, exist_ok=True)
    assert 1 <= args.train_count <= 1000
    selected_train = rows(args.corpus / "train/oracles.jsonl")[: args.train_count]
    selected_ids = {
        r["case_id"]
        for r in selected_train
        + rows(args.corpus / "dev/oracles.jsonl")
        + rows(args.corpus / "blind/oracles.jsonl")
    }
    template = json.loads(args.recipe.read_text())
    template["recipe"]["model_configs"][0]["inference_parameters"]["timeout"] = 600
    if template["recipe"]["model_configs"][0]["model"] == "codex-teacher":
        template["recipe"]["model_configs"][0]["inference_parameters"][
            "max_parallel_requests"
        ] = 16
    template["recipe"]["columns"][0]["system_prompt"] += (
        " Return natural prose, not JSON: do not backslash-escape quotes in the requested initial-state sentences. Copy those sentences literally."
    )
    canonical = rows(args.root.parent / "prototype-canonical.jsonl")[0]
    system = canonical["system_prompt"]
    prefix, suffix = canonical["model_request"].split("__GENERATED_BRIEF__")
    reference = rows(args.root.parent / "pilot-v3-inputs.jsonl")[0]["reference"]
    # Teacher scaffolding is explicitly discarded by dataset construction below.
    template["recipe"]["columns"][1]["prompt"] += (
        "\nCompiler/type rules: numeric weight only, never strings such as bold or medium for weight. Do not add a gap property to Divider. Omit Divider entirely unless used. Every declared component must be reachable. If a previous output is supplied below, regenerate the entire program to fix its diagnostics; do not return a patch.\n{{ repair_context }}"
    )
    accepted = {}
    failures = {}
    if args.pilot:
        validated = validate(args.pilot, args.root / "pilot-audited.jsonl")
        accepted.update(
            {r["case_id"]: r for r in validated if r["validation"]["accepted"]}
        )
        failures.update(
            {r["case_id"]: r for r in validated if not r["validation"]["accepted"]}
        )
    for index, path in enumerate(args.accepted):
        vetted = validate(path, args.root / f"preserved-{args.run_tag}-{index}.jsonl")
        accepted.update(
            {r["case_id"]: r for r in vetted if r["validation"]["accepted"]}
        )
        failures.update(
            {r["case_id"]: r for r in vetted if not r["validation"]["accepted"]}
        )
    accepted = {key: row for key, row in accepted.items() if key in selected_ids}
    (args.root / "selection.json").write_text(
        json.dumps(
            {
                "train_count": args.train_count,
                "train_case_ids": [r["case_id"] for r in selected_train],
                "train_distribution": dict(
                    collections.Counter(r["group"] for r in selected_train)
                ),
                "reserve": "Other generated training rows are preserved but excluded from this experiment.",
            },
            indent=2,
        )
        + "\n"
    )

    def update(phase):
        counts = collections.Counter(r["split"] for r in accepted.values())
        state = {
            "phase": phase,
            "teacher": args.teacher,
            "accepted": dict(counts),
            "target": {"train": args.train_count, "dev": 100, "blind": 300},
            "training_started": False,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        (args.root / "status.json").write_text(json.dumps(state, indent=2) + "\n")
        print(json.dumps(state), flush=True)

    update("starting_or_resuming")
    for split in ["train", "dev", "blind"]:
        oracle = rows(args.corpus / split / "oracles.jsonl")
        if split == "train":
            oracle = oracle[: args.train_count]
        for row in oracle:
            row["system_prompt"] = system
            row["creation_prefix"] = prefix
            row["creation_suffix"] = suffix
            row["reference"] = reference
            row["repair_context"] = ""
            content = {
                k: row["spec"][k]
                for k in ["required_text", "line_items", "amount_rows", "submit_label"]
            }
            content["required_fields"] = [
                {k: v for k, v in f.items() if k != "value"}
                for f in row["spec"]["required_fields"]
            ]
            row["required_content_json"] = json.dumps(content, ensure_ascii=False)
        for start in range(0, len(oracle), args.batch_size):
            batch = oracle[start : start + args.batch_size]
            for row in batch:
                failures.setdefault(row["case_id"], row)
            pending = [r for r in batch if r["case_id"] not in accepted]
            for attempt in range(args.max_attempts):
                if not pending:
                    break
                phase = f"{args.run_tag + '-' if args.run_tag else ''}{split}-{start:04d}-attempt-{attempt}"
                output = args.root / phase
                if output.with_suffix(".validated.jsonl").exists():
                    checked = rows(output.with_suffix(".validated.jsonl"))
                else:
                    # Regenerate requests only when they failed the oracle audit. Otherwise
                    # retain the original request and ask Studio to fix the actual compiler diagnostic.
                    mode = (
                        "both"
                        if split == "blind"
                        or attempt == 0
                        or any(request_problems(r) for r in pending)
                        else "source"
                    )
                    for row in pending:
                        error = row.get("validation", {}).get("error", "")
                        if row.get("source") and not request_problems(row):
                            row["repair_context"] = (
                                "Previous model output:\n"
                                + row["source"]
                                + "\nActual validation diagnostic: "
                                + error
                            )
                    candidates = recipe_job(
                        pending, template, output, mode, blind=split == "blind"
                    )
                    if split == "blind":
                        checked = []
                        for row in candidates:
                            errors = request_problems(row)
                            row["validation"] = {
                                "accepted": not errors,
                                "error": "; ".join(errors),
                                "level": "request_oracle_only_no_model_evaluation",
                            }
                            row["model_request"] = prefix + row["request"] + suffix
                            checked.append(row)
                        save(output.with_suffix(".validated.jsonl"), checked)
                    else:
                        checked = validate(
                            output.with_suffix(".candidates.jsonl"),
                            output.with_suffix(".validated.jsonl"),
                        )
                for row in checked:
                    if row["validation"]["accepted"]:
                        accepted[row["case_id"]] = row
                    else:
                        failures[row["case_id"]] = row
                pending = [
                    failures[r["case_id"]]
                    for r in batch
                    if r["case_id"] not in accepted
                ]
                update(phase)
            if pending:
                raise RuntimeError(
                    f"{len(pending)} rows still invalid after bounded repairs: {split}:{start}; see preserved artifacts"
                )
            save(
                args.root / (split + ".accepted.jsonl"),
                [accepted[r["case_id"]] for r in oracle if r["case_id"] in accepted],
            )
        update(split + "-complete")
    # Freeze blind requests independently. Nothing in train/dev includes blind
    # examples, generated targets, output diagnostics, or request text.
    blind = [accepted[r["case_id"]] for r in rows(args.corpus / "blind/oracles.jsonl")]
    blind_public = [
        {
            k: r[k]
            for k in [
                "case_id",
                "request",
                "model_request",
                "system_prompt",
                "spec",
                "scenario_family",
                "group",
                "state_mode",
            ]
        }
        for r in blind
    ]
    save(args.root / "blind/cases.jsonl", blind_public)
    manifest = {
        "count": 300,
        "cases_sha256": hashlib.sha256(
            (args.root / "blind/cases.jsonl").read_bytes()
        ).hexdigest(),
        "sealed": True,
        "evaluated": False,
        "checkpoint_selection": "development set only",
    }
    (args.root / "blind/manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    protected = rows(HERE / "evaluation/cases.jsonl")
    forbidden = [r["request"] for r in blind_public + protected]
    train_requests = set()
    dev_requests = set()
    source_sets = {}
    for split, expected in [("train", args.train_count), ("dev", 100)]:
        data = rows(args.root / (split + ".accepted.jsonl"))
        assert len(data) == expected
        records = []
        meta = []
        for row in data:
            assert (
                row["validation"]["accepted"]
                and row["quality_gate"]["request_fidelity"]
            )
            request = row["initial_model_request"]
            assert not any(x in request for x in forbidden)
            assert (
                hashlib.sha256(row["system_prompt"].encode()).hexdigest()
                == "2b0b389c765d474bff8f93c7e3187e03b21d1693b0f53e83d1a6ea0bf2828dd2"
            )
            records.append(
                {
                    "messages": [
                        {"role": "system", "content": row["system_prompt"]},
                        {"role": "user", "content": request},
                        {"role": "assistant", "content": row["source"]},
                    ]
                }
            )
            meta.append(
                {
                    "case_id": row["case_id"],
                    "scenario_family": row["scenario_family"],
                    "teacher": row.get("teacher", "local Gemma 4 26B-A4B"),
                    "source_sha256": hashlib.sha256(row["source"].encode()).hexdigest(),
                    "validatorSha256": row["validation"]["validatorSha256"],
                    "browserVerified": False,
                }
            )
        save(
            args.root / "dataset" / ("eval.jsonl" if split == "dev" else "train.jsonl"),
            records,
        )
        save(args.root / "dataset" / (split + ".manifest.jsonl"), meta)
        source_sets[split] = {x["source_sha256"] for x in meta}
        if split == "train":
            train_requests = {r["request"] for r in data}
        else:
            dev_requests = {r["request"] for r in data}
    assert (
        not train_requests & dev_requests
        and not source_sets["train"] & source_sets["dev"]
    )
    dataset_manifest = {
        "counts": {"train": args.train_count, "eval": 100, "blind": 300},
        "student_prompt": "SDK ExpressPromptGenerator.generate() unchanged",
        "teacher": args.teacher + " via Unsloth Studio Data Recipes",
        "teacher_counts": dict(
            collections.Counter(
                row.get("teacher", "local Gemma 4 26B-A4B")
                for row in accepted.values()
                if row["split"] != "blind"
            )
        ),
        "blind_manifest_sha256": hashlib.sha256(
            (args.root / "blind/manifest.json").read_bytes()
        ).hexdigest(),
        "separation_checks_passed": True,
        "browserVerified": False,
    }
    (args.root / "dataset/manifest.json").write_text(
        json.dumps(dataset_manifest, indent=2) + "\n"
    )
    update("corpus-complete")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        if "--root" in sys.argv:
            directory = Path(sys.argv[sys.argv.index("--root") + 1])
            path = directory / "status.json"
            previous = json.loads(path.read_text()) if path.exists() else {}
            path.write_text(
                json.dumps(
                    {**previous, "phase": "failed", "error": str(error)}, indent=2
                )
                + "\n"
            )
        raise
