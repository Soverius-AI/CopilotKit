"""Create fresh training briefs and reserve validation families; never author UI targets."""

import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--output-dir", type=Path, required=True)
args = p.parse_args()
root = Path(__file__).parent
benchmark = root / "evaluation"
protected = {
    name: hashlib.sha256((benchmark / name).read_bytes()).hexdigest()
    for name in ["cases.jsonl", "manifest.json"]
}
heldout = [json.loads(x) for x in (benchmark / "cases.jsonl").read_text().splitlines()]
domains = [
    "Camera Lessons",
    "Dance Sessions",
    "Coworking Days",
    "Sports Club",
    "Repair Appointments",
    "Language Course",
    "Art Tours",
    "Makerspace Access",
]
labels = [
    [
        "Learner name",
        "Learner email",
        "Organization",
        "Home city",
        "Camera type",
        "Lesson slot",
        "Tripod rental",
        "Learning goals",
        "Participants",
        "Booking code",
    ],
    [
        "Dancer name",
        "Dancer email",
        "Studio",
        "Home city",
        "Dance style",
        "Class time",
        "Practice shoes",
        "Experience notes",
        "Dancers",
        "Class reference",
    ],
    [
        "Guest name",
        "Guest email",
        "Company",
        "Home city",
        "Desk type",
        "Arrival window",
        "Monitor rental",
        "Workspace notes",
        "Guests",
        "Visit code",
    ],
    [
        "Member name",
        "Member email",
        "Team name",
        "Home city",
        "Activity",
        "Training slot",
        "Equipment loan",
        "Coaching notes",
        "Team members",
        "Member reference",
    ],
    [
        "Customer name",
        "Contact email",
        "Collection address",
        "Collection city",
        "Item type",
        "Appointment slot",
        "Spare parts",
        "Repair notes",
        "Items",
        "Repair reference",
    ],
    [
        "Student name",
        "Student email",
        "Organization",
        "Home city",
        "Language",
        "Lesson time",
        "Printed workbook",
        "Study goals",
        "Students",
        "Course reference",
    ],
    [
        "Visitor name",
        "Visitor email",
        "Meeting point",
        "Visitor city",
        "Tour route",
        "Start time",
        "Printed guide",
        "Access notes",
        "Visitors",
        "Tour reference",
    ],
    [
        "Maker name",
        "Maker email",
        "Organization",
        "Home city",
        "Work area",
        "Access time",
        "Protective goggles",
        "Project notes",
        "Makers",
        "Access reference",
    ],
]
options = [
    (["Mirrorless", "Film"], ["Morning", "Evening"]),
    (["Salsa", "Swing"], ["Tuesday", "Saturday"]),
    (["Quiet desk", "Shared table"], ["08:00", "11:00"]),
    (["Badminton", "Table tennis"], ["Weekday", "Weekend"]),
    (["Lamp", "Toaster"], ["09:00", "15:00"]),
    (["Italian", "Japanese"], ["Afternoon", "Evening"]),
    (["Sculpture", "Street art"], ["10:00", "14:30"]),
    (["Wood", "Textiles"], ["Half day", "Full day"]),
]
rows = []
for variant in range(24):
    for group in ["card", "short_form", "mixed_form", "complex_form"]:
        index = variant % len(domains)
        family = "curriculum_validation" if variant % 8 == 7 else "curriculum_" + group
        title = f"Northstar {domains[index]} — {variant + 31}"
        amount = ["$", "€", "£"][
            variant % 3
        ] + f"{37 + variant * 3}.{(variant * 7) % 100:02d}"
        fields = []
        kinds = [
            "text",
            "email",
            "text",
            "text",
            "select",
            "select",
            "checkbox",
            "textarea",
            "number",
            "text",
        ]
        keys = [
            "name",
            "email",
            "organization",
            "city",
            "category",
            "slot",
            "extra",
            "notes",
            "quantity",
            "reference",
        ]
        values = [
            "Morgan Lee",
            "morgan@example.com",
            "8 Orchard Lane",
            "Linz",
            options[index][0][-1],
            options[index][1][-1],
            "true" if variant % 2 else "false",
            "Use the side door\nKeep “fragile” & reference intact",
            "3",
            f"NS-{variant + 31}",
        ]
        for i, (key, kind, label) in enumerate(zip(keys, kinds, labels[index])):
            fields.append(
                dict(
                    key=key,
                    label=label,
                    kind=kind,
                    value=values[i],
                    options=options[index][i - 4] if i in [4, 5] else [],
                    initial=False
                    if kind == "checkbox"
                    else 1
                    if kind == "number"
                    else "",
                )
            )
        selection = {
            "card": [],
            "short_form": [[0, 4, 6], [0, 1, 5, 7], [0, 8, 6]][variant % 3],
            "mixed_form": [0, 1, 4, 6, 7] if variant % 2 else [0, 1, 5, 6, 7, 8],
            "complex_form": list(range(10)) if variant % 2 else list(range(8)),
        }[group]
        fields = [fields[i] for i in selection]
        facts = [f"Location: Orchard Hall {variant + 1}.", f"Total {amount}."]
        if group == "card":
            facts.insert(0, "Open Monday–Friday, 10:00–18:00.")
            request = (
                f"Create an informational card headed {title}. Show these facts exactly: "
                + " ".join(facts)
                + " Use a clear visual hierarchy. Include no inputs, forms or buttons."
            )
        else:
            controls = "; ".join(
                f"{f['label']} ({f['kind']}"
                + (": " + " or ".join(f["options"]) if f["options"] else "")
                + ")"
                for f in fields
            )
            request = (
                f"Create a {domains[index]} form headed {title}. Display these facts unchanged: "
                + " ".join(facts)
                + f" Include each input exactly once: {controls}. "
                "Start text and selections empty, checkboxes unchecked, and numbers at 1. "
                "Use a Review details button that submits every entered value. "
                "After submission show the actual entered values, keeping the form and total visible. "
                "This is a demo; no real reservation or purchase is made."
            )
        spec = dict(
            title=title,
            domain=domains[index],
            stress_case=group,
            total_literal=amount,
            required_text=[title, *facts],
            required_fields=fields,
            submit_label="Review details" if fields else "",
            review_request="Show every actual entered value; retain the same editable form and total."
            if fields
            else "",
            edit_request="",
        )
        assert all(
            request != case["request"] and title != case.get("spec", {}).get("title")
            for case in heldout
        )
        rows.append(
            dict(
                case_id=f"curriculum-r2-{group}-{variant:02d}",
                scenario_family=family,
                curriculum_group=group,
                variant=variant,
                request=request,
                spec=spec,
                spec_json=json.dumps(spec, ensure_ascii=False),
            )
        )
args.output_dir.mkdir(parents=True, exist_ok=True)
out = args.output_dir / "scenario-specs.jsonl"
assert not out.exists(), "Preserve existing generated briefs"
out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
(args.output_dir / "eval-protection.json").write_text(
    json.dumps(
        dict(
            protected_files=protected,
            acceptance_rows_used_in_training=0,
            curriculum_rows=len(rows),
            training_candidates=sum(
                r["scenario_family"] != "curriculum_validation" for r in rows
            ),
            validation_candidates=sum(
                r["scenario_family"] == "curriculum_validation" for r in rows
            ),
        ),
        indent=2,
    )
    + "\n"
)
print(
    json.dumps({"briefs": len(rows), "output": str(out), "frozen_eval_unchanged": True})
)
