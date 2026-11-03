"""Check tokenizer/template compatibility without loading model weights."""

import argparse
import json
from pathlib import Path
from transformers import AutoTokenizer
from huggingface_hub import hf_hub_download

parser = argparse.ArgumentParser()
parser.add_argument("--browser-template", type=Path, required=True)
parser.add_argument("--browser-tokenizer", type=Path, required=True)
parser.add_argument("--report", type=Path, required=True)
parser.add_argument("--dataset-dir", type=Path)
parser.add_argument("--model", default="unsloth/gemma-4-E2B-it")
parser.add_argument("--revision", default="d36bdd3855c82a6a1a23f7c459b749f5724ae75d")
parser.add_argument("--max-tokens", type=int, default=4096)
args = parser.parse_args()
tokenizer = AutoTokenizer.from_pretrained(
    args.model, revision=args.revision, local_files_only=True, trust_remote_code=False
)
training_template = Path(
    hf_hub_download(
        args.model, "chat_template.jinja", revision=args.revision, local_files_only=True
    )
).read_text()
browser_template = args.browser_template.read_text()
raw = json.loads(args.browser_tokenizer.read_text())
vocab = raw["model"]["vocab"]
if isinstance(vocab, list):
    vocab = {entry[0]: i for i, entry in enumerate(vocab)}
else:
    vocab = dict(vocab)
for token in raw.get("added_tokens", []):
    vocab[token["content"]] = token["id"]
base_vocab = tokenizer.get_vocab()
different = [
    token
    for token in set(vocab) | set(base_vocab)
    if vocab.get(token) != base_vocab.get(token)
]
report = {
    "model": args.model,
    "revision": args.revision,
    "thinking": False,
    "browser_vocabulary_matches": not different,
    "different_token_count": len(different),
    "browser_vocab_size": len(vocab),
    "training_vocab_size": len(base_vocab),
    "template_comparison": [],
    "lengths": [],
    "browserRuntimeVerified": False,
}


def render(messages, template, generation=False):
    return tokenizer.apply_chat_template(
        messages,
        chat_template=template,
        tokenize=False,
        add_generation_prompt=generation,
        enable_thinking=False,
    )


if args.dataset_dir:
    for split in ["train", "eval"]:
        for index, line in enumerate(
            (args.dataset_dir / (split + ".jsonl")).read_text().splitlines()
        ):
            messages = json.loads(line)["messages"]
            train = render(messages, training_template)
            browser = render(messages, browser_template)
            prefix_equal = render(messages[:-1], training_template, True) == render(
                messages[:-1], browser_template, True
            )
            count = len(tokenizer.encode(train, add_special_tokens=False))
            report["template_comparison"].append(
                {
                    "split": split,
                    "row": index,
                    "full_equal": train == browser,
                    "prefix_equal": prefix_equal,
                }
            )
            report["lengths"].append(
                {
                    "split": split,
                    "row": index,
                    "tokens": count,
                    "within_limit": count <= args.max_tokens,
                }
            )
report["passed"] = (
    report["browser_vocabulary_matches"]
    and all(
        row["full_equal"] and row["prefix_equal"]
        for row in report["template_comparison"]
    )
    and all(row["within_limit"] for row in report["lengths"])
)
args.report.write_text(json.dumps(report, indent=2) + "\n")
print(
    json.dumps(
        {
            "passed": report["passed"],
            "vocabulary_matches": not different,
            "different_tokens": len(different),
            "audited_rows": len(report["lengths"]),
            "max_tokens": max((r["tokens"] for r in report["lengths"]), default=None),
            "report": str(args.report),
            "browserRuntimeVerified": False,
        }
    )
)
if not report["passed"]:
    raise SystemExit(1)
