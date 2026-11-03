"""Freeze unseen requests and observable expectations, never target Express programs."""

import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--artifact-dir", type=Path, required=True)
parser.add_argument(
    "--output-dir", type=Path, default=Path(__file__).parent / "evaluation"
)
args = parser.parse_args()


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def field(key, label, kind="text", value="Zoë D’Arcy", options=None, initial=None):
    return dict(
        key=key,
        label=label,
        kind=kind,
        value=value,
        options=options or [],
        initial=(False if kind == "checkbox" else 1 if kind == "number" else "")
        if initial is None
        else initial,
    )


name = lambda label="Full name": field("name", label)
email = lambda label="Email": field("email", label, "email", "zoe@example.com")
notes = lambda label="Notes": field(
    "notes", label, "textarea", "Line one\nKeep the blue ribbon & “hello”"
)
quantity = lambda label="Quantity": field("quantity", label, "number", "3")
choice = lambda key, label, options: field(key, label, "select", options[-1], options)
check = lambda key, label: field(key, label, "checkbox", "true")
cases = []


def add(case_id, category, title, text, fields=(), submit="Review details"):
    fields = list(fields)
    details = " ".join(text)
    if fields:
        controls = "; ".join(
            f"{f['label']} ({f['kind']}"
            + (": " + " or ".join(f["options"]) if f["options"] else "")
            + ")"
            for f in fields
        )
        task = (
            f"Create a {title} form. Show exactly this heading: {title}. Display these facts unchanged: "
            f"{details} Include each of these inputs exactly once: {controls}. "
            "Start every text and selection value empty, every checkbox unchecked, and every number at 1. "
            f"Use a {submit} button to submit all entered values. "
            "Only after submission, show every actual entered value while keeping the editable form and original facts visible. "
            "This is a local demo, not a real purchase or reservation."
        )
    else:
        task = (
            f"Create a polished informational card headed {title}. Include all these facts exactly: "
            f"{details} Use clear visual hierarchy. Do not add inputs, forms or buttons."
        )
    spec = dict(
        title=title,
        domain=title,
        stress_case=category,
        required_fields=fields,
        required_text=[title, *text],
        submit_label=submit if fields else "",
        review_request="Show all actual entered values; retain the editable form, prices and same surface."
        if fields
        else "",
        total_literal=text[-1],
        edit_request="",
    )
    cases.append(
        dict(
            case_id=case_id,
            scenario_family="acceptance_" + category,
            evaluation_split="acceptance",
            request=task,
            spec=spec,
            spec_json=json.dumps(spec, ensure_ascii=False),
        )
    )


add(
    "acceptance-aquarium-card",
    "card",
    "Blue Tide Aquarium",
    [
        "Open Wednesday–Sunday, 09:30–17:30.",
        "Harbor Gate 7.",
        "Adult admission €17.50.",
    ],
)
add(
    "acceptance-podcast-card",
    "card",
    "Signal & Sound — “The Quiet Hour”",
    [
        "Episode 42.",
        "Duration 38 minutes.",
        "Host: Anaïs Chen.",
        "New episodes every Friday.",
    ],
)
add(
    "acceptance-energy-card",
    "card",
    "BrightRoof Solar",
    ["6 panels.", "Estimated annual generation 2,400 kWh.", "Installation £2,850.00."],
)
add(
    "acceptance-software-card",
    "card",
    "Studio Team Plan",
    ["5 collaborators.", "100 GB storage.", "Cancel any time.", "$24.95 per month."],
)
add(
    "acceptance-bakery-form",
    "short_form",
    "Crumb & Crust Pickup",
    ["Sourdough €6.40.", "Collection at Old Mill Counter.", "Total €6.40."],
    [
        name("Customer name"),
        choice("slot", "Pickup window", ["08:00–09:00", "16:00–17:00"]),
        check("sliced", "Slice the loaf"),
    ],
    "Review pickup",
)
add(
    "acceptance-tailoring-form",
    "short_form",
    "Threadline Fitting",
    ["Consultation £18.00.", "Room B, second floor.", "Total £18.00."],
    [
        name("Client name"),
        email("Contact email"),
        choice("service", "Service", ["Hemming", "Jacket fitting"]),
        notes("Fit notes"),
    ],
    "Review appointment",
)
add(
    "acceptance-grooming-form",
    "mixed_form",
    "Paws & Polish",
    ["Bath and trim $46.00.", "Pickup before 18:00.", "Total $46.00."],
    [
        name("Owner name"),
        field("pet", "Pet name", value="Mochi"),
        email(),
        choice("size", "Pet size", ["Small", "Large"]),
        check("sensitive", "Sensitive skin"),
        notes("Care notes"),
    ],
    "Review visit",
)
add(
    "acceptance-donation-form",
    "mixed_form",
    "River Cleanup Pledge",
    [
        "Weekend cleanup at East Bank.",
        "Suggested pledge €12.00.",
        "No payment is collected.",
    ],
    [
        name("Volunteer name"),
        email("Volunteer email"),
        quantity("Volunteers"),
        choice("shift", "Shift", ["Morning", "Afternoon"]),
        check("equipment", "Bring spare gloves"),
        notes("Access needs"),
    ],
    "Review pledge",
)
add(
    "acceptance-coffee-form",
    "numeric_form",
    "Roast Route Subscription",
    ["250 g per bag.", "Coffee $14.25.", "Delivery $3.00.", "Total $17.25."],
    [
        name("Subscriber name"),
        email(),
        quantity("Bags"),
        choice("grind", "Grind", ["Whole bean", "Filter"]),
        choice("frequency", "Frequency", ["Weekly", "Monthly"]),
        check("decaf", "Decaffeinated"),
        notes("Roast preferences"),
    ],
    "Review subscription",
)
add(
    "acceptance-flower-form",
    "address_form",
    "Petal Post",
    ["Seasonal bouquet 42.00 CHF.", "Delivery 8.00 CHF.", "Total 50.00 CHF."],
    [
        name("Recipient name"),
        email("Sender email"),
        field("street", "Street", value="9 Rue des Fleurs"),
        field("city", "Town", value="Genève"),
        field("postal", "Postcode", value="1201"),
        choice("window", "Delivery window", ["Morning", "Evening"]),
        check("vase", "Include vase"),
        notes("Gift message"),
    ],
    "Review delivery",
)
add(
    "acceptance-bookstore-checkout",
    "complex_checkout",
    "Chapter & Compass Checkout",
    ["Atlas $31.75.", "Notebook $9.20.", "Shipping $4.05.", "Total $45.00."],
    [
        name(),
        email(),
        field("street", "Street address", value="22 Maple Avenue"),
        field("city", "City", value="Graz"),
        field("postal", "Postal code", value="8010"),
        choice("country", "Country", ["Austria", "Slovenia"]),
        choice("delivery", "Delivery", ["Economy", "Priority"]),
        quantity("Book quantity"),
        check("gift", "Gift wrapping"),
        notes("Delivery notes"),
    ],
    "Review order",
)
add(
    "acceptance-lunch-checkout",
    "complex_checkout",
    "Lunchbox Collective Checkout",
    ["Lunch box €13.80.", "Fruit €2.10.", "Delivery €3.60.", "Total €19.50."],
    [
        name("Contact name"),
        email("Contact email"),
        field("company", "Company", value="Northwind Studio"),
        field("street", "Delivery street", value="14 Lindenstraße"),
        field("city", "Delivery city", value="Salzburg"),
        choice("menu", "Menu", ["Vegetarian", "Vegan"]),
        choice("window", "Time window", ["11:30–12:00", "12:00–12:30"]),
        quantity("Lunch boxes"),
        check("cutlery", "Reusable cutlery"),
        notes("Allergy notes"),
    ],
    "Review lunch",
)

# Preserve the actual failing browser request as a regression; it is not a blind acceptance case.
regression = json.loads(
    (args.artifact_dir / "complex-model-inputs.jsonl").read_text().splitlines()[0]
)
regression = {
    k: v
    for k, v in regression.items()
    if k
    not in [
        "source",
        "draft",
        "browser_failure",
        "source_browser",
        "model_request",
        "system_prompt",
    ]
}
regression["evaluation_split"] = "browser_regression"
cases.append(regression)

training = [
    json.loads(x)
    for x in (args.artifact_dir / "bootstrap-pilot-dataset/train.jsonl")
    .read_text()
    .splitlines()
]
train_requests = [x["messages"][1]["content"] for x in training]
assert all(
    not any(case["request"] in text for text in train_requests) for case in cases
), "Evaluation request leaked into training"
assert len({x["case_id"] for x in cases}) == len(cases)
assert all("source" not in x and "dsl" not in x for x in cases)
assert len({digest(x["request"]) for x in cases}) == len(cases)
args.output_dir.mkdir(parents=True, exist_ok=True)
content = "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in cases)
out = args.output_dir / "cases.jsonl"
if out.exists() and out.read_text() != content:
    raise ValueError(
        "Frozen benchmark changed; create a new version instead of overwriting it"
    )
out.write_text(content)
manifest = dict(
    version=1,
    counts={"acceptance": 12, "browser_regression": 1},
    cases_sha256=digest(content),
    contains_target_dsl=False,
    training_allowed=False,
    exact_request_overlap_with_training=0,
    training_validation_rows=3,
    training_validation_is_not_acceptance=True,
    system_prompt_sha256=digest((args.artifact_dir / "system-prompt.txt").read_text()),
    training_dataset_sha256=digest(
        (args.artifact_dir / "bootstrap-pilot-dataset/train.jsonl").read_text()
    ),
    generation={
        "max_new_tokens": 3072,
        "temperature": 0,
        "top_k": 1,
        "top_p": 1,
        "enable_thinking": False,
    },
    checks=[
        "one complete Express block",
        "compiler and native graph acceptance",
        "exact requested inputs, labels and control types",
        "unique initialized bindings",
        "exact initial values and selection options",
        "reachable title, facts, prices and currency",
        "reachable submit button and named Form Event carrying every input path",
    ],
    browser_checks_pending=[
        "actual controls and submit dispatch",
        "action reply preserves entered values and prices",
        "widgets visible before generation completes",
        "ONNX q4f16 loading and latency",
    ],
    promotion_gate={
        "acceptance_first_pass_minimum": 0.9,
        "browser_functional_pass_required": True,
    },
    cases=[
        {
            "case_id": x["case_id"],
            "split": x["evaluation_split"],
            "request_sha256": digest(x["request"]),
        }
        for x in cases
    ],
)
manifest_path = args.output_dir / "manifest.json"
manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
if manifest_path.exists() and manifest_path.read_text() != manifest_text:
    raise ValueError("Frozen benchmark settings changed; create a new version")
manifest_path.write_text(manifest_text)
print(
    json.dumps(
        {"cases": len(cases), "path": str(out), "sha256": manifest["cases_sha256"]}
    )
)
