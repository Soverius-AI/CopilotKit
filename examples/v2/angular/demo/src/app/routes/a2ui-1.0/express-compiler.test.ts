import { describe, expect, it } from "vitest";
import { exportA2UICatalog } from "@copilotkit/shared/generative-ui";
import {
  EXPRESS_COMPONENTS,
  ExpressCompiler,
  operationsOf,
} from "./express-compiler";
import { EXPRESS_EXAMPLES } from "./express-examples";
import { testUI } from "./test-catalog";

const compilerFor = () => new ExpressCompiler(exportA2UICatalog(testUI));
const block = (source: string) => `<a2ui>\n${source}\n</a2ui>`;

describe("the A2UI SDK's Express compiler with a CopilotKit catalog", () => {
  it("guides the model with the SDK prompt for the demo's components only", () => {
    const { systemPrompt } = compilerFor();
    for (const name of EXPRESS_COMPONENTS)
      expect(systemPrompt).toContain(`• ${name}(`);
    const other = [...testUI.components.keys()].find(
      (name) => !(EXPRESS_COMPONENTS as readonly string[]).includes(name),
    )!;
    expect(systemPrompt).not.toContain(`• ${other}(`);
  });

  it("compiles a new view into A2UI 1.0 operations", () => {
    const compiler = compilerFor();
    const { operations, text } = compiler.parse(
      block(EXPRESS_EXAMPLES.form),
      "view-1",
    );
    expect(text).toBe("");
    expect(operations).toHaveLength(1);
    const [create] = operations;
    expect(create).toMatchObject({
      version: "1.0",
      createSurface: {
        surfaceId: "view-1",
        catalogId: testUI.id,
        dataModel: { name: "", ticket: "Standard", updates: false },
      },
    });
    expect(
      "createSurface" in create! &&
        create.createSurface.components?.find(({ id }) => id === "form"),
    ).toMatchObject({
      component: "Form",
      onSubmit: { event: { name: "register" } },
    });
  });

  it("checks an update against the committed surfaces and writes each data path on its own", () => {
    const compiler = compilerFor();
    const committed = compiler.parse(
      block(EXPRESS_EXAMPLES.form),
      "view-1",
    ).operations;
    const update = block(
      `surface("view-1", update=true)\n$/notes = "Seen"\nseen = Text($/notes)\nroot = Card([heading, price, form, seen], gap=12)`,
    );
    expect(compiler.parse(update, "view-2", committed).operations).toEqual([
      expect.objectContaining({ updateComponents: expect.anything() }),
      {
        version: "1.0",
        updateDataModel: { surfaceId: "view-1", path: "/notes", value: "Seen" },
      },
    ]);
    // Without the committed view there is nothing to update.
    expect(() => compiler.parse(update, "view-2")).toThrow();
  });

  it("reads a reply without a block as prose", () => {
    const compiler = compilerFor();
    expect(compiler.parse("Hi! Ask me for a form.", "view-1")).toEqual({
      operations: [],
      text: "Hi! Ask me for a form.",
    });
  });

  it("streams the operations of an update while the model writes it", () => {
    const compiler = compilerFor();
    const committed = compiler.parse(
      block(EXPRESS_EXAMPLES.form),
      "view-1",
    ).operations;
    const stream = compiler.stream("view-2", committed);
    const ready = [
      '<a2ui>\nsurface("view-1", update=true)\n',
      'seen = Text("Thanks")\n',
      "root = Card([heading, price, form, seen])\n</a2ui>",
    ].map((chunk) => operationsOf(stream.feed(chunk)));
    expect(ready[1]!.length + ready[0]!.length).toBeGreaterThan(0);
    expect(ready.flat().at(-1)).toMatchObject({
      updateComponents: { surfaceId: "view-1" },
    });
  });
});

describe("isolating the line the compiler rejects", () => {
  const draft = (line: string) =>
    block(
      `heading = Title("Checkout")\n${line}\nroot = Card([heading, total])`,
    );

  const rejection = (
    compiler: ReturnType<typeof compilerFor>,
    source: string,
  ) => {
    try {
      compiler.parse(source, "view-1");
    } catch (error) {
      return error;
    }
    throw new Error("The draft compiled.");
  };

  it("takes a syntax error's line from the compiler", () => {
    const compiler = compilerFor();
    const line = 'total = Text("Total: " + "$53")';
    expect(
      compiler.invalidLine(rejection(compiler, draft(line))),
    ).toMatchObject({ index: 1, text: line });
  });

  it("finds a catalog error's line by compiling each line on its own", () => {
    const compiler = compilerFor();
    for (const line of [
      'total = Text("Total: $53", bogus=1)',
      'total = Spacer("Total: $53")',
      'total = Text("Total: $53", fontWeight="heavy")',
    ])
      expect(
        compiler.invalidLine(rejection(compiler, draft(line))),
      ).toMatchObject({ index: 1, text: line });
  });

  it("blames no single line for errors the renderer state finds", () => {
    const compiler = compilerFor();
    for (const source of [
      // A wrong value type, a missing component, a component nothing shows.
      draft('total = Text("Total: $53", weight="semibold")'),
      block('heading = Title("Checkout")\nroot = Card([heading, total])'),
      draft('total = Text("Total: $53")\nstray = Text("Unused")'),
    ])
      expect(compiler.invalidLine(rejection(compiler, source))).toBeUndefined();
  });

  it("hot-swaps the corrected statement into its block", () => {
    const compiler = compilerFor();
    const source = draft('total = Text("Total: " + "$53")');
    const line = compiler.invalidLine(rejection(compiler, source))!;
    for (const correction of [
      'total = Text("Total: $53")',
      '<a2ui>\ntotal = Text("Total: $53")\n</a2ui>',
    ]) {
      const swapped = compiler.hotSwap(source, line, correction)!;
      expect(swapped).toBe(draft('total = Text("Total: $53")'));
      expect(compiler.parse(swapped, "view-1").operations).toHaveLength(1);
    }
    expect(compiler.hotSwap("<a2ui>\n</a2ui>", line, "x")).toBeUndefined();
  });
});
