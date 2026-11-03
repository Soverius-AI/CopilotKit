"""Loopback OpenAI-compatible teacher for Unsloth Data Recipes, backed by Codex.

Coalesces independent calls into bounded batches. Only synthetic task prompts
are supplied to read-only, ephemeral Codex runs. Preserves actual responses,
usage receipts and failures; never manufactures or patches target programs.
"""

import argparse
import json
import queue
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--output-dir", type=Path, required=True)
p.add_argument("--port", type=int, default=5803)
p.add_argument("--batch-size", type=int, default=8)
p.add_argument("--workers", type=int, default=2)
args = p.parse_args()
root = args.output_dir.resolve()
root.mkdir(parents=True, exist_ok=True)
binary = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
pending = queue.Queue()
lock = threading.Lock()
stats = {
    "batches": 0,
    "completed": 0,
    "failed": 0,
    "input_tokens": 0,
    "output_tokens": 0,
}
version = subprocess.check_output([binary, "--version"], text=True).strip()


def worker():
    while True:
        batch = [pending.get()]
        deadline = time.monotonic() + 0.8
        while len(batch) < args.batch_size and time.monotonic() < deadline:
            try:
                batch.append(
                    pending.get(timeout=max(0.001, deadline - time.monotonic()))
                )
            except queue.Empty:
                break
        directory = root / uuid.uuid4().hex
        directory.mkdir()
        started = time.monotonic()
        try:
            systems = [
                "\n\n".join(
                    str(m["content"])
                    for m in task["body"]["messages"]
                    if m["role"] == "system"
                )
                for task in batch
            ]
            common = systems[0] if len(set(systems)) == 1 else None
            tasks = []
            for i, task in enumerate(batch):
                messages = [
                    m for m in task["body"]["messages"] if m["role"] != "system"
                ]
                tasks.append(
                    {
                        "id": str(i),
                        "messages": messages,
                        **({} if common is not None else {"system": systems[i]}),
                    }
                )
            schema = {
                "type": "object",
                "additionalProperties": False,
                "required": ["completions"],
                "properties": {
                    "completions": {
                        "type": "array",
                        "minItems": len(batch),
                        "maxItems": len(batch),
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["id", "content"],
                            "properties": {
                                "id": {
                                    "type": "string",
                                    "enum": [str(i) for i in range(len(batch))],
                                },
                                "content": {"type": "string"},
                            },
                        },
                    }
                },
            }
            schemafile = directory / "schema.json"
            schemafile.write_text(json.dumps(schema))
            prompt = (
                "You are an offline synthetic-data teacher for Unsloth Studio. Do not call tools, read files, run commands, edit files, commit or push. "
                "Everything needed is supplied below. Answer every independent task using its system instructions. "
                "Return JSON with one completion per id. Each content is only the requested text, with no JSON escaping beyond what the output format itself requires. "
                "When authoring a natural-language request, copy literal initial-state bullets exactly: quote characters in the prose must not be preceded by backslashes. "
                "When generating Express, follow the supplied standard SDK guide exactly and use minimal styling. Preserve all required visible facts, item-price associations, "
                "control types, option order and exact initial values. Initialize and bind every input uniquely. Include a submit=true Button INSIDE the Form and every input path "
                "in the Form Event context. Define root using its actual outer constructor, never an alias. Do not invent inputs or show a review before submission. "
                "Every declared component must be reachable. Generate model output, never claim to have run a compiler.\n\n"
                + (
                    "SHARED SYSTEM INSTRUCTIONS:\n" + common + "\n\n"
                    if common is not None
                    else ""
                )
                + "TASKS:\n"
                + json.dumps(tasks, ensure_ascii=False)
            )
            (directory / "prompt.txt").write_text(prompt)
            with (
                tempfile.TemporaryDirectory(
                    prefix="a2ui-codex-teacher-"
                ) as empty_workspace,
                (directory / "events.jsonl").open("w") as events,
                (directory / "stderr.log").open("w") as errors,
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
                    str(schemafile),
                    "--output-last-message",
                    str(directory / "response.json"),
                    "-",
                ]
                result = subprocess.run(
                    command,
                    input=prompt,
                    text=True,
                    cwd=empty_workspace,
                    stdout=events,
                    stderr=errors,
                    timeout=550,
                )
                if result.returncode:
                    raise RuntimeError(
                        "Codex teacher returned an error; see batch receipt "
                        + directory.name
                    )
            output = json.loads((directory / "response.json").read_text())[
                "completions"
            ]
            mapped = {r["id"]: r["content"] for r in output}
            assert len(mapped) == len(batch) and set(mapped) == {
                str(i) for i in range(len(batch))
            }, "Incomplete Codex batch"
            assert all(
                isinstance(content, str) and content.strip()
                for content in mapped.values()
            ), "Empty Codex completion"
            usage = {}
            for line in (directory / "events.jsonl").read_text().splitlines():
                event = json.loads(line)
                if event.get("type") == "turn.completed":
                    usage = event.get("usage", {})
            receipt = {
                "teacher": "Codex CLI, service default model",
                "cli_version": version,
                "cases": len(batch),
                "elapsed_seconds": time.monotonic() - started,
                "usage": usage,
            }
            (directory / "receipt.json").write_text(
                json.dumps(receipt, indent=2) + "\n"
            )
            for i, task in enumerate(batch):
                task["result"] = {
                    "id": "chatcmpl-" + uuid.uuid4().hex,
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": "codex-teacher",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": mapped[str(i)]},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {
                        "prompt_tokens": usage.get("input_tokens", 0) // len(batch),
                        "completion_tokens": usage.get("output_tokens", 0)
                        // len(batch),
                        "total_tokens": (
                            usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
                        )
                        // len(batch),
                    },
                    "teacher_batch_receipt": directory.name,
                    "usage_note": "Per-call usage apportioned; exact batch usage is preserved in the receipt.",
                }
            with lock:
                stats["batches"] += 1
                stats["completed"] += len(batch)
                stats["input_tokens"] += usage.get("input_tokens", 0)
                stats["output_tokens"] += usage.get("output_tokens", 0)
            print(
                json.dumps(
                    {
                        "batch": directory.name,
                        "cases": len(batch),
                        "seconds": round(receipt["elapsed_seconds"], 2),
                        "completed": stats["completed"],
                    }
                ),
                flush=True,
            )
        except Exception as error:
            (directory / "failure.json").write_text(
                json.dumps(
                    {
                        "error": str(error),
                        "cases": len(batch),
                        "elapsed_seconds": time.monotonic() - started,
                    },
                    indent=2,
                )
                + "\n"
            )
            for task in batch:
                task["error"] = str(error)
            with lock:
                stats["failed"] += len(batch)
            print(
                json.dumps({"failed_batch": directory.name, "error": str(error)}),
                flush=True,
            )
        finally:
            for task in batch:
                task["event"].set()
                pending.task_done()


class Handler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ["/health", "/v1/models"]:
            self.send_json(
                {
                    "object": "list",
                    "data": [
                        {
                            "id": "codex-teacher",
                            "object": "model",
                            "owned_by": "local-codex-bridge",
                        }
                    ],
                    **({"stats": stats} if self.path == "/health" else {}),
                }
            )
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        if self.headers.get("Origin") or not self.headers.get(
            "Content-Type", ""
        ).startswith("application/json"):
            self.send_error(403)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length < 300_000:
            self.send_error(413)
            return
        body = json.loads(self.rfile.read(length))
        if body.get("stream") or not body.get("messages"):
            self.send_json(
                {
                    "error": {
                        "message": "Only non-streaming synthetic teacher chats are supported."
                    }
                },
                400,
            )
            return
        task = {"body": body, "event": threading.Event()}
        pending.put(task)
        if not task["event"].wait(590):
            self.send_json({"error": {"message": "Teacher batch timed out"}}, 503)
            return
        if task.get("error"):
            self.send_json({"error": {"message": task["error"]}}, 503)
        else:
            self.send_json(task["result"])


for _ in range(args.workers):
    threading.Thread(target=worker, daemon=True).start()
print(
    json.dumps(
        {
            "listening": "127.0.0.1:" + str(args.port),
            "teacher": "Codex CLI via existing login",
            "batch_size": args.batch_size,
            "workers": args.workers,
            "cli_version": version,
        }
    ),
    flush=True,
)
ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
