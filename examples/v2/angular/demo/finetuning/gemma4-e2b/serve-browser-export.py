"""Serve explicit model artifacts on loopback; never expose the workspace."""

import argparse
import functools
import json
import hashlib
import importlib.util
import os
import re
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

p = argparse.ArgumentParser()
p.add_argument("--model", action="append", required=True, help="export-id=directory")
p.add_argument("--port", type=int, default=8899)
p.add_argument("--round", type=Path)
args = p.parse_args()


# The ONNX matrices an export patches, as the worker's exportBase checks:
# Studio adapted 170 E2B matrices; mlx_lm adapts every projection, 240 on
# E2B and 300 on E4B. mlx_lm aliases carry their size.
def patched_matrices(alias, base_model):
    if alias.startswith("e4b-"):
        assert base_model == "unsloth/gemma-4-E4B-it"
        return 300
    assert base_model == "unsloth/gemma-4-E2B-it"
    return 240 if alias.startswith("e2b-") else 170


models = {}
for item in args.model:
    alias, directory = item.split("=", 1)
    root = Path(directory).resolve()
    manifest = json.loads((root / "a2ui-export-manifest.json").read_text())
    assert (
        manifest["patched_onnx_matrices"]
        == patched_matrices(alias, manifest["base_model"])
        and manifest["decoder_graph_unchanged"]
    )
    size = "" if re.match(r"e[24]b-", alias) else "e2b-"
    models["local/gemma-4-" + size + alias] = (
        root,
        set(manifest["files"]) | {"a2ui-export-manifest.json"},
    )
round_dir = args.round.resolve() if args.round else None
HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[5]
ORIGINS = ["http://localhost:4210", "http://127.0.0.1:4210"]


def ready():
    if not round_dir or not (round_dir / "browser-ready.json").exists():
        return None
    frozen = json.loads((round_dir / "browser-ready.json").read_text())
    assert re.fullmatch(r"round[1-9]\d*-[a-f0-9]{12}", frozen["model_id"])
    root = Path(frozen["directory"]).resolve()
    assert root.is_relative_to(round_dir / "browser-models")
    manifest = json.loads((root / "a2ui-export-manifest.json").read_text())
    assert manifest["adapter_sha256"] == frozen["adapter_sha256"]
    assert manifest["files"] == frozen["files"], (
        "Selected artifact changed after freezing"
    )
    models["local/gemma-4-e2b-" + frozen["model_id"]] = (
        root,
        set(manifest["files"]) | {"a2ui-export-manifest.json"},
    )
    return frozen


def blind_cases(frozen):
    path = round_dir / "bulk/blind/cases.jsonl"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == frozen["blind_cases_sha256"]
    data = [json.loads(line) for line in path.read_text().splitlines()]
    assert len(data) == frozen.get("case_count", 300)
    return data


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, data, status=200):
        content = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_OPTIONS(self):
        if self.headers.get("Origin") not in ORIGINS:
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if urlsplit(self.path).path == "/experiment/control-fixture":
            if not round_dir:
                self.send_error(404)
                return
            path = round_dir / "codex-teacher-pilot/validated.jsonl"
            fixtures = [json.loads(line) for line in path.read_text().splitlines()]
            for row in fixtures:
                row["spec"] = json.loads(row["spec_json"])
            fixtures = [
                row
                for row in fixtures
                if row["validation"]["accepted"] and row["split"] == "train"
            ]
            self.send_json(
                max(fixtures, key=lambda row: len(row["spec"]["required_fields"]))
            )
            return
        if urlsplit(self.path).path == "/experiment/status":
            frozen = ready()
            state = {}
            bulk = {}
            if round_dir:
                if (round_dir / "continuation-status.json").exists():
                    state = json.loads(
                        (round_dir / "continuation-status.json").read_text()
                    )
                if (round_dir / "bulk/status.json").exists():
                    bulk = json.loads((round_dir / "bulk/status.json").read_text())
            self.send_json(
                {
                    **state,
                    "phase": state.get("phase", "not_started"),
                    "accepted": bulk.get("accepted", {}),
                    "target": bulk.get("target", {}),
                    "ready": None
                    if frozen is None
                    else {
                        **{
                            k: frozen[k]
                            for k in [
                                "model_id",
                                "adapter_sha256",
                                "blind_cases_sha256",
                            ]
                        },
                        "case_count": frozen.get("case_count", 300),
                        "evaluation_kind": frozen.get("evaluation_kind", "held_out"),
                    },
                }
            )
            return
        if urlsplit(self.path).path == "/experiment/cases":
            frozen = ready()
            if (
                not frozen
                or self.path != "/experiment/cases?model=" + frozen["model_id"]
            ):
                self.send_error(409, "Blind cases remain sealed")
                return
            self.send_json(blind_cases(frozen))
            return
        if self.headers.get("Range") == "bytes=0-0":
            file = Path(self.translate_path(self.path))
            if not file.is_file():
                self.send_error(404)
                return
            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(str(file)))
            self.send_header("Content-Length", "1")
            self.send_header("Content-Range", f"bytes 0-0/{file.stat().st_size}")
            self.end_headers()
            with file.open("rb") as stream:
                self.wfile.write(stream.read(1))
            return
        super().do_GET()

    def translate_path(self, path):
        ready()
        path = unquote(urlsplit(path).path)
        if not path.startswith("/models/"):
            return "/nonexistent-a2ui-model"
        for model, (root, files) in models.items():
            prefix = "/models/" + model + "/"
            if path.startswith(prefix):
                relative = path[len(prefix) :]
                if relative in files:
                    return str(root / relative)
        return "/nonexistent-a2ui-model"

    def end_headers(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header(
                "Access-Control-Expose-Headers", "Content-Length, Content-Range"
            )
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_POST(self):
        if self.headers.get("Origin") not in ORIGINS or not round_dir:
            self.send_error(403)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 2_000_000:
            self.send_error(413)
            return
        try:
            body = json.loads(self.rfile.read(length))
            frozen = ready()
            assert frozen, "No selected model"
            run_id = body["run_id"]
            assert re.fullmatch(r"[a-f0-9-]{36}", run_id)
            directory = round_dir / "browser-evaluation" / run_id
            directory.mkdir(parents=True, exist_ok=True)
            cases = blind_cases(frozen)
            expected = {row["case_id"]: row for row in cases}
            if self.path == "/evaluation/result":
                identity = body["case_id"]
                assert identity in expected
                assert (
                    body["model"]["artifactSha256"] == frozen["adapter_sha256"]
                    and body["model"]["device"] == "webgpu"
                )
                assert (
                    body["first_attempt_only"]
                    and body["automatic_repairs"] == 0
                    and len(body["source"]) <= 60_000
                )
                assert (
                    body["model_request"] == expected[identity]["model_request"]
                    and body["system_prompt"] == expected[identity]["system_prompt"]
                )
                result = {**body, **expected[identity]}
                with (directory / (identity + ".json")).open("x") as stream:
                    json.dump(result, stream, ensure_ascii=False, indent=2)
                self.send_json({"saved": identity})
                return
            if self.path == "/evaluation/complete":
                generated = [
                    json.loads((directory / (row["case_id"] + ".json")).read_text())
                    for row in cases
                ]
                candidate = directory / "candidates.jsonl"
                candidate.write_text(
                    "".join(
                        json.dumps(row, ensure_ascii=False) + "\n" for row in generated
                    )
                )
                env = dict(os.environ)
                env["PATH"] = (
                    "/Users/wolfmanfx/.nvm/versions/node/v24.15.0/bin:"
                    + env.get("PATH", "")
                )
                env["NX_DAEMON"] = "false"
                validated = directory / "validated.jsonl"
                with (directory / "nx.log").open("w") as stream:
                    subprocess.run(
                        [
                            str(WORKSPACE / "node_modules/.bin/nx"),
                            "run",
                            "@copilotkit/angular-demo:validate-training-data",
                            "--excludeTaskDependencies",
                            "--",
                            str(candidate),
                            str(validated),
                        ],
                        cwd=WORKSPACE,
                        env=env,
                        stdout=stream,
                        stderr=subprocess.STDOUT,
                        check=True,
                    )
                resolved = directory / "resolved-display.jsonl"
                with (directory / "resolve-display.nx.log").open("w") as stream:
                    subprocess.run(
                        [
                            str(WORKSPACE / "node_modules/.bin/nx"),
                            "run",
                            "@copilotkit/angular-demo:resolve-evaluation-display",
                            "--excludeTaskDependencies",
                            "--",
                            str(validated),
                            str(resolved),
                        ],
                        cwd=WORKSPACE,
                        env=env,
                        stdout=stream,
                        stderr=subprocess.STDOUT,
                        check=True,
                    )
                module_spec = importlib.util.spec_from_file_location(
                    "corpus", HERE / "round3-corpus.py"
                )
                module = importlib.util.module_from_spec(module_spec)
                module_spec.loader.exec_module(module)
                checked = [
                    json.loads(line) for line in resolved.read_text().splitlines()
                ]
                for row in checked:
                    if row["validation"]["accepted"] and "line_items" in row["spec"]:
                        errors = module.association_problems(row)
                        if errors:
                            row["validation"].update(
                                accepted=False, error="; ".join(errors)
                            )
                validated.write_text(
                    "".join(
                        json.dumps(row, ensure_ascii=False) + "\n" for row in checked
                    )
                )
                passed = sum(
                    bool(row["validation"]["accepted"] and row["native"]["accepted"])
                    for row in checked
                )
                report = {
                    "count": len(cases),
                    "passed": passed,
                    "percent": 100 * passed / len(cases),
                    "first_attempt_only": True,
                    "automatic_repairs": 0,
                    "model": frozen["model_id"],
                    "adapter_sha256": frozen["adapter_sha256"],
                    "blind_cases_sha256": frozen["blind_cases_sha256"],
                    "blind_is_fresh": frozen.get("blind_is_fresh", True),
                    "evaluation_kind": frozen.get("evaluation_kind", "held_out"),
                    "native_passed": sum(
                        bool(row["native"]["accepted"]) for row in checked
                    ),
                    "coverage": "creation, owned edits, native controls and submit event; no model-generated action reply",
                    "browserVerified": True,
                }
                (directory / "report.json").write_text(
                    json.dumps(report, indent=2) + "\n"
                )
                (round_dir / "browser-evaluation-completed.json").write_text(
                    json.dumps(
                        {**report, "run_id": run_id, "directory": str(directory)},
                        indent=2,
                    )
                    + "\n"
                )
                self.send_json(report)
                return
            self.send_error(404)
        except Exception as error:
            self.log_error("Evaluation failure: %s", error)
            self.send_json({"error": str(error)}, 500)


print(
    json.dumps({"listening": "127.0.0.1:" + str(args.port), "models": list(models)}),
    flush=True,
)
ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
