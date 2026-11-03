import { describe, expect, it } from "vitest";
import type { A2UIOperation } from "@copilotkit/shared";
import {
  actionTurn,
  creationTurn,
  lineRepairTurn,
  repairTurn,
  rootChildren,
  rootLineWith,
} from "./model-request";

const view = {
  id: "view-1",
  source: '$/note = ""\nnote = TextField("Note", $/note)\nroot = Card([note])',
  values: { "/note": "Collect after 5pm.", "/gift": true },
};

describe("the turn that creates or changes a view", () => {
  it("ends a new view's request as the fine-tune was trained", () => {
    const turn = creationTurn({
      request: "Create a checkout form",
      earlier: [],
      context: [],
      views: [],
      newSurfaceId: "view-1",
    });
    expect(turn.startsWith("Request: Create a checkout form\n\n")).toBe(true);
    expect(turn).toContain(
      "end with the actual outer constructor assigned to root.",
    );
    expect(
      turn.endsWith(
        "No view exists yet. Write no surface(...) line: the page creates this view as view-1.",
      ),
    ).toBe(true);
  });

  it("supplies each view's Express and current values, and how to target it", () => {
    const turn = creationTurn({
      request: "Show a summary of what I entered",
      earlier: [{ role: "user", content: "Create a note form" }],
      context: [{ description: "Shop", value: "Leaf & Light" }],
      views: [view],
      newSurfaceId: "view-2",
    });
    expect(turn).toContain("User: Create a note form");
    expect(turn).toContain("- Shop: Leaf & Light");
    expect(turn).toContain(`view-1, built from this Express:\n${view.source}`);
    expect(turn).toContain('- note: "Collect after 5pm."\n- gift: true');
    expect(turn).toContain('surface("<id>", update=true)');
    expect(turn.endsWith("Request: Show a summary of what I entered")).toBe(
      true,
    );
  });
});

describe("the turn that answers an action", () => {
  const turn = (rootLine?: string) =>
    actionTurn({
      name: "review_order",
      surfaceId: "view-1",
      values: { name: "Alex Morgan", gift: true },
      guidance: [{ description: "Checkout", value: "Show an order review." }],
      context: [],
      existingTypes: { heading: "Title", form: "Form" },
      keep: ["heading", "form"],
      rootLine,
      resultName: "result",
    });

  it("gives the submitted values as data, the ids in use and the exact first and last line", () => {
    const text = turn("root = Card(children=[heading, form, result])");
    expect(text).toContain(
      'ACTION: the user submitted "review_order" from view-1.',
    );
    expect(text).toContain('- name: "Alex Morgan"\n- gift: true');
    expect(text).toContain(
      'What the app wants for "review_order": Show an order review.',
    );
    expect(text).toContain("- heading: Title\n- form: Form");
    expect(text).toContain(
      'The first line after <a2ui> is exactly: surface("view-1", update=true)',
    );
    expect(text).toContain("must start with result_");
    expect(text).toContain(
      "Keep heading and form as they are: assign none of them again.",
    );
    expect(text).toContain(
      "End with exactly this line, which keeps everything view-1 shows and adds result:\nroot = Card(children=[heading, form, result])",
    );
  });

  it("describes the last line when the root cannot be written back", () => {
    expect(turn()).toContain(
      "End by writing root again as view-1's outer component, with all its current children and result at the end of its list.",
    );
  });
});

describe("the root line an action answer ends with", () => {
  const create = (root: Record<string, unknown>): A2UIOperation[] => [
    {
      version: "v1.0",
      createSurface: {
        surfaceId: "view-1",
        catalogId: "test",
        components: [
          { id: "heading", component: "Title", text: "Hi" },
          { id: "root", component: "Card", ...root },
        ],
      },
    },
  ];

  it("writes the real root back with its literal props and the result added", () => {
    const operations = create({ children: ["heading", "form"], gap: 12 });
    expect(rootChildren(operations)).toEqual(["heading", "form"]);
    expect(rootLineWith(operations, "result")).toBe(
      "root = Card(children=[heading, form, result], gap=12)",
    );
  });

  it("gives up when the root has no children list or a bound prop", () => {
    expect(
      rootLineWith(create({ child: "heading" }), "result"),
    ).toBeUndefined();
    expect(
      rootLineWith(
        create({ children: ["heading"], background: { "@path": "/bg" } }),
        "result",
      ),
    ).toBeUndefined();
  });
});

describe("repair turns", () => {
  it("asks for the whole block again when no single line is to blame", () => {
    expect(repairTurn("Dangling reference 'total'")).toBe(
      "The compiler rejected that block: Dangling reference 'total'\n\nWrite the whole block again with that problem fixed.",
    );
  });

  it("asks only for the rejected line, with its error", () => {
    const turn = lineRepairTurn({
      line: 'total = Text("Total: " + "$53")',
      diagnostic: "token recognition error at: '+ '",
    });
    expect(turn).toBe(`The compiler rejected this line of A2UI Express:
total = Text("Total: " + "$53")

Error: token recognition error at: '+ '

Reply with only the corrected statement.`);
  });
});
