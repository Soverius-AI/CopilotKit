"""Render the pinned browser template and explicitly mask everything but assistant targets."""

import argparse
import hashlib
import json
from pathlib import Path
from transformers import AutoTokenizer

parser = argparse.ArgumentParser()
parser.add_argument("--dataset-dir", type=Path, required=True)
parser.add_argument("--browser-template", type=Path, required=True)
parser.add_argument("--output-dir", type=Path, required=True)
parser.add_argument("--max-tokens", type=int, default=32768)
parser.add_argument("--model", default="unsloth/gemma-4-E2B-it")
parser.add_argument("--revision", default="d36bdd3855c82a6a1a23f7c459b749f5724ae75d")
args = parser.parse_args()
tokenizer = AutoTokenizer.from_pretrained(
    args.model, revision=args.revision, local_files_only=True, trust_remote_code=False
)
template = args.browser_template.read_text()
args.output_dir.mkdir(parents=True, exist_ok=True)
report = {
    "model": args.model,
    "revision": args.revision,
    "max_tokens": args.max_tokens,
    "template_sha256": hashlib.sha256(template.encode()).hexdigest(),
    "rows": [],
    "thinking": False,
    "objective": "assistant_completion_only",
    "browserRuntimeVerified": False,
}
for split in ["train", "eval"]:
    output = []
    for index, line in enumerate(
        (args.dataset_dir / (split + ".jsonl")).read_text().splitlines()
    ):
        messages = json.loads(line)["messages"]
        if messages[-1]["role"] != "assistant":
            raise ValueError(
                "A training row must end with its verified assistant target"
            )

        def render(msgs, generation):
            return tokenizer.apply_chat_template(
                msgs,
                chat_template=template,
                tokenize=False,
                add_generation_prompt=generation,
                enable_thinking=False,
            )

        full, prefix = render(messages, False), render(messages[:-1], True)
        if not full.startswith(prefix):
            raise ValueError("Full training text differs from the inference prefix")
        ids = tokenizer.encode(full, add_special_tokens=False)
        prefix_ids = tokenizer.encode(prefix, add_special_tokens=False)
        if ids[: len(prefix_ids)] != prefix_ids:
            raise ValueError("Tokenization changed the inference prefix boundary")
        if len(ids) > args.max_tokens:
            raise ValueError(
                f"{split}:{index} exceeds the limit; never silently truncate"
            )
        labels = [-100] * len(prefix_ids) + ids[len(prefix_ids) :]
        if not any(label != -100 for label in labels):
            raise ValueError("No assistant tokens to train")
        output.append(
            {"input_ids": ids, "attention_mask": [1] * len(ids), "labels": labels}
        )
        report["rows"].append(
            {
                "split": split,
                "row": index,
                "tokens": len(ids),
                "trained_tokens": len(ids) - len(prefix_ids),
                "masked_tokens": len(prefix_ids),
                "system_prompt_sha256": hashlib.sha256(
                    messages[0]["content"].encode()
                ).hexdigest(),
            }
        )
    (args.output_dir / (split + ".jsonl")).write_text(
        "".join(json.dumps(row) + "\n" for row in output)
    )
(args.output_dir / "tokenization-report.json").write_text(
    json.dumps(report, indent=2) + "\n"
)
print(
    json.dumps(
        {
            "rows": len(report["rows"]),
            "max_tokens": max(row["tokens"] for row in report["rows"]),
            "sequence_limit": args.max_tokens,
            "objective": report["objective"],
            "output": str(args.output_dir),
        }
    )
)
