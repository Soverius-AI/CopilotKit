"""Build disjoint requirement oracles; Studio authors requests and all target programs."""

import argparse
import hashlib
import json
import random
import secrets
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--output-dir", type=Path, required=True)
args = p.parse_args()
root = args.output_dir
assert not root.exists(), "Preserve previous corpus versions"
root.mkdir(parents=True)

# Topics and authoring styles are held out by split, not by random row.
topics = {
    "train": [
        "aquatic equipment",
        "ceramics workshop",
        "garden supplies",
        "record shop",
        "camping equipment",
        "cooking class",
        "stationery",
        "music lessons",
        "photography prints",
        "tea subscription",
        "fitness session",
        "community event",
        "furniture delivery",
        "craft supplies",
        "board games",
        "bike accessories",
        "home lighting",
        "language meetup",
        "sailing lesson",
        "reusable packaging",
    ],
    "dev": ["climbing session", "artisan soap", "dance rehearsal", "repair club"],
    "blind": [
        "independent cinema",
        "orchid collection",
        "shelter supplies",
        "regional food box",
        "textile studio",
        "kayak tour",
    ],
}
styles = {
    "train": [
        "friendly chat request",
        "concise project brief",
        "numbered acceptance criteria",
        "paragraph followed by a short checklist",
        "email to a UI designer",
        "content-first request with inputs afterward",
        "inputs-first request with branding afterward",
        "informal message with a final correction",
        "catalog brief with an item list",
        "two-paragraph narrative",
    ],
    "dev": [
        "support ticket",
        "formal handover note",
        "compact specification with semicolons",
    ],
    "blind": [
        "voice-message transcript",
        "meeting notes converted into a request",
        "requirements scattered across a narrative",
        "short conversational question followed by constraints",
        "product-manager review note",
    ],
}
brand_words = [
    "Marigold",
    "Cedar",
    "Mistral",
    "Orbit",
    "Juniper",
    "Bramble",
    "Kestrel",
    "Saffron",
    "Copper",
    "Lagoon",
    "Willow",
    "Indigo",
    "Meadow",
    "Fable",
    "Tern",
    "Mosaic",
    "Pollen",
    "Drift",
    "Lumen",
    "Pebble",
]
products = [
    "Travel mug",
    "Canvas bag",
    "Field notebook",
    "Starter kit",
    "Storage tin",
    "Guide booklet",
    "Gift sleeve",
    "Refill pack",
    "Sampler box",
    "Soft case",
    "Carry strap",
    "Cleaning cloth",
    "Tool roll",
    "Display stand",
]
field_profiles = [
    (
        "name",
        ["Customer name", "Your name", "Contact person", "Participant name"],
        "text",
    ),
    (
        "email",
        ["Email address", "Contact email", "Receipt email", "Participant email"],
        "email",
    ),
    (
        "street",
        ["Street address", "Delivery street", "Collection address", "Address line"],
        "text",
    ),
    ("city", ["City", "Delivery city", "Town", "Locality"], "text"),
    ("postal", ["Postal code", "Postcode", "ZIP code", "Delivery postcode"], "text"),
    ("category", ["Package", "Plan", "Service option", "Membership type"], "select"),
    (
        "time",
        ["Arrival window", "Time preference", "Session", "Dispatch window"],
        "select",
    ),
    (
        "extra",
        [
            "Include a gift note",
            "Add protective packaging",
            "Send a reminder",
            "Include accessories",
        ],
        "checkbox",
    ),
    (
        "notes",
        [
            "Additional notes",
            "Delivery instructions",
            "Personal message",
            "Access notes",
        ],
        "textarea",
    ),
    ("quantity", ["Quantity", "Number of items", "Participants", "Units"], "number"),
    (
        "phone",
        ["Contact phone", "Telephone", "Callback number", "Mobile number"],
        "text",
    ),
    (
        "reference",
        ["Reference", "Project code", "Order reference", "Group reference"],
        "text",
    ),
    ("format", ["Format", "Material", "Finish", "Edition"], "select"),
    (
        "consent",
        ["Email updates", "Reusable packaging", "Collect in person", "Printed receipt"],
        "checkbox",
    ),
]


def money(cents, symbol):
    return f"{symbol}{cents // 100}.{cents % 100:02d}"


def quoted(value):
    return "“" + value + "”" if isinstance(value, str) else json.dumps(value)


def sentence(label, kind, value, rng):
    if kind == "select":
        patterns = (
            [
                f"Leave {label} unselected.",
                f"{label} must initially have no selected option.",
                f"Start {label} with an empty selection.",
            ]
            if value == ""
            else [
                f"Initially select {quoted(value)} for {label}.",
                f"The initial {label} selection must be {quoted(value)}.",
            ]
        )
    elif kind == "checkbox":
        patterns = [
            f"Start {label} " + ("checked." if value else "unchecked."),
            f"The {label} checkbox initially has value "
            + ("true." if value else "false."),
        ]
    elif value == "":
        patterns = [f"Leave {label} empty initially.", f"{label} must start blank."]
    else:
        patterns = [
            f"The initial value of {label} is {quoted(value)}.",
            f"Start {label} at {quoted(value)}.",
        ]
    return rng.choice(patterns)


def make(split, count, seed):
    rng = random.Random(seed)
    rows = []
    for i in range(count):
        slot = i % 20
        group = (
            "card"
            if slot < 4
            else "short_form"
            if slot < 9
            else "mixed_form"
            if slot < 15
            else "complex_form"
        )
        topic = topics[split][(i + i // 20) % len(topics[split])]
        style = styles[split][(i // len(topics[split])) % len(styles[split])]
        family = f"{split}:{topic}:{style}"
        brand = f"{rng.choice(brand_words)} & {rng.choice(brand_words)} {rng.randrange(100, 999)}"
        title = (
            rng.choice(
                [
                    "Your next visit",
                    "Make it yours",
                    "Reserve your place",
                    "Build your bundle",
                    "A little something special",
                    "Plan the details",
                ]
            )
            + " — "
            + "".join(rng.choices("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k=6))
        )
        symbol = rng.choice(["$", "€", "£"])
        nitems = rng.randint(1, 3) if group == "card" else rng.randint(2, 7)
        item_cents = [rng.randint(150, 7900) for _ in range(nitems)]
        item_pool = (
            products
            if split != "blind"
            else [
                "Screening pass",
                "Orchid pot",
                "Woven cushion",
                "Pantry selection",
                "Kayak seat",
                "Textile sample",
                "Animal blanket",
                "Seasonal hamper",
                "Pattern booklet",
                "Tour voucher",
                "Plant support",
                "Fabric bundle",
                "Meal portion",
                "Equipment rental",
            ]
        )
        names = rng.sample(item_pool, nitems)
        item_text = [
            f"{name}: {money(price, symbol)}" for name, price in zip(names, item_cents)
        ]
        shipping = rng.randint(0, 1250)
        discount = rng.randint(0, min(sum(item_cents) // 4, 2000))
        total = sum(item_cents) + shipping - discount
        facts = [
            brand,
            title,
            *names,
            *[money(p, symbol) for p in item_cents],
            "Shipping",
            money(shipping, symbol),
            "Discount",
            money(discount, symbol),
            "Total",
            money(total, symbol),
        ]
        if group == "card":
            facts += ["Available online and at the studio."]
        nfields = (
            0
            if group == "card"
            else rng.randint(1, 4)
            if group == "short_form"
            else rng.randint(5, 8)
            if group == "mixed_form"
            else rng.randint(9, 14)
        )
        profiles = rng.sample(field_profiles, nfields)
        fields = []
        initial_sentences = []
        state_mode = ["empty", "explicit_defaults", "mixed"][i % 3]
        for j, (key, labels, kind) in enumerate(profiles):
            label = rng.choice(labels)
            pool = (
                ["Classic", "Flex", "Plus", "Premium", "Essential"]
                if key == "category"
                else ["Morning", "Afternoon", "Evening", "Weekend", "09:00", "15:00"]
                if key == "time"
                else ["Matte", "Gloss", "Natural", "Recycled", "Printed", "Digital"]
            )
            opts = rng.sample(pool, rng.randint(2, 5)) if kind == "select" else []
            choose_default = state_mode == "explicit_defaults" or (
                state_mode == "mixed" and j % 2 == 0
            )
            if kind == "select":
                initial = rng.choice(opts) if choose_default else ""
                value = (
                    next(o for o in reversed(opts) if o != initial)
                    if len(opts) > 1
                    else opts[0]
                )
            elif kind == "checkbox":
                initial = bool(choose_default and rng.randrange(2))
                value = "false" if initial else "true"
            elif kind == "number":
                initial = rng.choice([0, 1, 2, 5, 12]) if choose_default else 1
                value = str(initial + 3)
            elif kind == "email":
                initial = "alex@example.org" if choose_default else ""
                value = "sam@example.org"
            else:
                initial = (
                    (
                        "Zoë D’Arcy"
                        if key == "name"
                        else 'Studio "Seven" & Co.'
                        if key == "reference"
                        else "Riverside"
                    )
                    if choose_default
                    else ""
                )
                value = (
                    "Line one\nHandle “gently” & keep this value"
                    if kind == "textarea"
                    else "Morgan O’Reilly"
                    if key == "name"
                    else "1050"
                    if key == "postal"
                    else "Test value 7"
                )
            fields.append(
                dict(
                    key=key,
                    label=label,
                    kind=kind,
                    options=opts,
                    initial=initial,
                    value=value,
                )
            )
            initial_sentences.append(sentence(label, kind, initial, rng))
        submit = (
            rng.choice(
                [
                    "Review details",
                    "Preview request",
                    "Review my choices",
                    "Check the summary",
                ]
            )
            if fields
            else ""
        )
        spec = dict(
            title=title,
            brand=brand,
            domain=topic,
            stress_case=group,
            required_text=facts,
            required_fields=fields,
            line_items=[
                {"name": name, "price": money(price, symbol)}
                for name, price in zip(names, item_cents)
            ],
            amount_rows=[
                {"name": "Shipping", "price": money(shipping, symbol)},
                {"name": "Discount", "price": money(discount, symbol)},
                {"name": "Total", "price": money(total, symbol)},
            ],
            total_literal=money(total, symbol),
            submit_label=submit,
            review_request="Show every submitted value while retaining the same editable form, all facts and prices."
            if fields
            else "",
            edit_request="",
        )
        author_spec = {k: v for k, v in spec.items() if k != "required_fields"}
        author_spec["required_fields"] = [
            {k: v for k, v in f.items() if k != "value"} for f in fields
        ]
        authoring = (
            "Write one natural-language UI request in this style: "
            + style
            + ". Vary how the request begins and the ordering of facts, inputs and initial-state instructions. "
            "The topic is "
            + topic
            + ". Include every required_text literal exactly as supplied, even when branding is mentioned casually rather than explicitly as a heading. "
            "Include each input label exactly, its control kind, and all selection options in their given order. "
            "Include each supplied initial-state sentence verbatim as a separate bullet. These sentences are required and must not be rewritten. "
            "Do not contradict any supplied initial state. For a card, explicitly request no inputs, forms or buttons. "
            "For a form, request the exact submit-label button, all entered values in its submit event, and a review only after submission that keeps the editable form and facts visible. "
            "This is a local demo, with no real payment or reservation. Return only the UI request, no DSL or explanatory preface. "
            "Keep each item name associated with its own stated price, and label shipping, discount and total. "
            "Requirement oracle (only initial states, never future test entries): "
            + json.dumps(author_spec, ensure_ascii=False)
            + "\nInitial-state sentences: "
            + json.dumps(initial_sentences, ensure_ascii=False)
        )
        rows.append(
            dict(
                case_id=f"r3-{split}-{i:04d}",
                split=split,
                scenario_family=family,
                group=group,
                state_mode=state_mode,
                spec=spec,
                spec_json=json.dumps(spec, ensure_ascii=False),
                initial_sentences=initial_sentences,
                authoring_prompt=authoring,
                request="__GENERATED_BRIEF__",
            )
        )
    return rows


seeds = {"train": 3407, "dev": 9407, "blind": secrets.randbits(64)}
counts = {"train": 1000, "dev": 100, "blind": 300}
manifest = {
    "version": 4,
    "counts": counts,
    "target_kind": "CREATE, with bound inputs and submit events for all form cases",
    "training_target_count": 1000,
    "development_target_count": 100,
    "blind_case_count": 300,
    "source": "Studio authors natural-language requests and target DSL",
    "files": {},
    "family_split_disjoint": True,
}
for split, count in counts.items():
    rows = make(split, count, seeds[split])
    directory = root / split
    directory.mkdir()
    text = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    path = directory / "oracles.jsonl"
    path.write_text(text)
    path.chmod(0o600)
    manifest["files"][split] = {
        "path": str(path),
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
        "count": len(rows),
    }
(root / "generation-seeds.json").write_text(json.dumps(seeds, indent=2) + "\n")
(root / "generation-seeds.json").chmod(0o600)
(root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(
    json.dumps(
        {
            "counts": counts,
            "training_target_count": 1000,
            "development_target_count": 100,
            "blind_case_count": 300,
            "blind_preview": "sealed",
        }
    )
)
