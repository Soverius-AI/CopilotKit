"""Build deterministic test specifications, never UI implementations."""

import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument(
    "--output", type=Path, default=Path(__file__).parent / "scenario-seeds.jsonl"
)
args = parser.parse_args()

families = [
    "component_arguments",
    "duplicate_names",
    "missing_requested_fields",
    "unreachable_components",
    "unusable_submit",
    "boolean_display",
    "same_surface_update",
    "owned_values_preserved",
    "currency_preserved",
    "quoted_strings",
    "ordinary_card",
    "layout_wrappers",
]
domains = [
    "bike rental",
    "museum tickets",
    "workshop booking",
    "plant shop",
    "event catering",
    "equipment hire",
    "library membership",
    "travel packing",
]


def field(key, label, kind="text", options=None, value=""):
    return {
        "key": key,
        "label": label,
        "kind": kind,
        "options": options or [],
        "value": value,
    }


rows = []
for variant in range(16):
    for index, family in enumerate(families):
        domain = domains[(index + variant) % len(domains)]
        symbol = ["$", "€", "£"][(index + variant) % 3]
        amount = f"{symbol}{72 + index * 9 + variant * 13}.{(index * 7 + variant * 11) % 100:02d}"
        fields = [
            field("name", "Full Name", value="Renée O'Connor"),
            field("email", "Email Address", "email", value="renee@example.com"),
            field("street", "Street Address", value="24 Willow Lane"),
            field("city", "City", value="Vienna"),
            field("country", "Country", "select", ["Austria", "Germany"], "Germany"),
            field(
                "delivery",
                "Delivery Method",
                "select",
                ["Standard", "Express"],
                "Express",
            ),
            field(
                "gift",
                "Gift Wrapping",
                "checkbox",
                value="true" if variant % 2 else "false",
            ),
            field("notes", "Delivery Notes", "textarea", value="Ring apartment 4"),
            field("phone", "Phone Number", value="+1 202 555 0146"),
            field(
                "reference", "Reference Code", value=f"REF-{index:02d}-{variant:02d}"
            ),
        ]
        profiles = {
            "bike rental": (
                [
                    "Rider Name",
                    "Rider Email",
                    "Pickup Location",
                    "Pickup City",
                    "Bicycle Type",
                    "Rental Duration",
                    "Helmet Needed",
                    "Pickup Notes",
                    "Contact Phone",
                    "Reservation Reference",
                ],
                ["City Bike", "Cargo Bike"],
                ["Half Day", "Full Day"],
            ),
            "museum tickets": (
                [
                    "Visitor Name",
                    "Visitor Email",
                    "Group Name",
                    "Visitor City",
                    "Ticket Type",
                    "Entry Time",
                    "Audio Guide",
                    "Accessibility Notes",
                    "Contact Phone",
                    "Visit Reference",
                ],
                ["Adult", "Student"],
                ["10:00", "14:00"],
            ),
            "workshop booking": (
                [
                    "Participant Name",
                    "Participant Email",
                    "Organization",
                    "Participant City",
                    "Experience Level",
                    "Session",
                    "Materials Kit",
                    "Learning Goals",
                    "Contact Phone",
                    "Workshop Reference",
                ],
                ["Beginner", "Advanced"],
                ["Morning", "Afternoon"],
            ),
            "plant shop": (
                [
                    "Customer Name",
                    "Customer Email",
                    "Street Address",
                    "City",
                    "Plant Type",
                    "Delivery Window",
                    "Gift Wrapping",
                    "Delivery Notes",
                    "Contact Phone",
                    "Order Reference",
                ],
                ["Fern", "Succulent"],
                ["Morning", "Evening"],
            ),
            "event catering": (
                [
                    "Host Name",
                    "Host Email",
                    "Event Venue",
                    "Event City",
                    "Menu Type",
                    "Service Time",
                    "Vegetarian Option",
                    "Dietary Notes",
                    "Contact Phone",
                    "Event Reference",
                ],
                ["Buffet", "Plated"],
                ["Lunch", "Dinner"],
            ),
            "equipment hire": (
                [
                    "Renter Name",
                    "Renter Email",
                    "Collection Point",
                    "Collection City",
                    "Equipment Type",
                    "Hire Period",
                    "Protective Gloves",
                    "Handling Notes",
                    "Contact Phone",
                    "Hire Reference",
                ],
                ["Drill", "Sander"],
                ["One Day", "Weekend"],
            ),
            "library membership": (
                [
                    "Member Name",
                    "Member Email",
                    "Street Address",
                    "City",
                    "Membership Type",
                    "Preferred Branch",
                    "Email Reminders",
                    "Reading Interests",
                    "Contact Phone",
                    "Member Reference",
                ],
                ["Individual", "Family"],
                ["Central", "Riverside"],
            ),
            "travel packing": (
                [
                    "Traveler Name",
                    "Traveler Email",
                    "Accommodation",
                    "Destination City",
                    "Trip Type",
                    "Trip Length",
                    "Rain Protection",
                    "Packing Notes",
                    "Contact Phone",
                    "Trip Reference",
                ],
                ["City Break", "Hiking"],
                ["Weekend", "One Week"],
            ),
        }
        labels, first_options, second_options = profiles[domain]
        for item, label in zip(fields, labels):
            item["label"] = label
        for slot, options in [(4, first_options), (5, second_options)]:
            fields[slot]["options"] = options
            fields[slot]["value"] = options[variant % 2]
        count = [3, 5, 8, 10][(index + variant) % 4]
        selection = {
            3: [0, 5, 6],
            5: [0, 1, 4, 6, 7],
            8: list(range(8)),
            10: list(range(10)),
        }[count]
        fields = [fields[i] for i in selection]
        if family == "duplicate_names":
            fields[0] = field(
                "primary_name", "Primary Contact Name", value="Alex Morgan"
            )
            fields[1] = field(
                "secondary_name", "Secondary Contact Name", value="Sam Taylor"
            )
        card = family == "ordinary_card"
        if card:
            fields = []
        title = f"{domain.title()} — {index + 1:02d}{variant + 1:02d}"
        if family == "quoted_strings":
            title += ' — "Night Shift"'
        spec = {
            "title": title,
            "domain": domain,
            "stress_case": family,
            "total_literal": amount,
            "required_fields": fields,
            "submit_label": "" if card else "Review details",
            "required_text": [title, amount],
            "review_request": ""
            if card
            else "Show every entered value and the unchanged total beside the original editable form, on the same surface. Keep the inputs and their values.",
            "edit_request": "Change the heading color to dark green; keep all input values."
            if family == "owned_values_preserved"
            else "",
            "card_text": "Open Tuesday to Sunday, 10:00–18:00. Location: Riverside Hall."
            if card
            else "",
        }
        if family == "unreachable_components":
            spec["required_text"].append("Bring your reference code to reception.")
        if card:
            spec["required_text"].append(spec["card_text"])
        rows.append(
            {
                "case_id": f"{family}-{variant:02d}",
                "scenario_family": family,
                "domain": domain,
                "variant": variant,
                "spec_json": json.dumps(spec, ensure_ascii=False),
            }
        )
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(
    "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
)
print(
    json.dumps(
        {"rows": len(rows), "families": len(families), "output": str(args.output)}
    )
)
