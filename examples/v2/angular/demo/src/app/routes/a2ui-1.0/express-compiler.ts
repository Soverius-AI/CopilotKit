import {
  buildGenerativeUIPrompt,
  getOperationKind,
  getOperationSurfaceId,
  validateOperation,
} from "@copilotkit/shared";
import type { A2UIOperation, GenerativeUIManifest } from "@copilotkit/shared";
import { EXPRESS_PRESETS } from "./express-presets";
export { EXPRESS_PRESETS } from "./express-presets";

export const EXPRESS_COMPONENTS = [
  "Card",
  "Column",
  "Row",
  "Title",
  "Text",
  "Caption",
  "Badge",
  "Divider",
  "TextField",
  "TextArea",
  "Button",
  "CheckBox",
  "Slider",
  "Select",
  "Form",
  "RadioGroup",
  "DateTimeInput",
] as const;

// Nano's context window also has to hold the request and generated form.
// Derive a smaller contract from the real catalog rather than advertising
// every presentation option of every standard component.
const EXPRESS_PROPERTIES = new Set([
  "component",
  "children",
  "child",
  "text",
  "label",
  "value",
  "onClick",
  "onSubmit",
  "placeholder",
  "required",
  "checks",
  "options",
  "rows",
  "min",
  "max",
  "step",
  "unit",
  "submit",
  "block",
  "enableTime",
  "format",
  "clearable",
  "direction",
  "variant",
  "size",
  "color",
  "fontWeight",
  "textAlign",
  "tabularNums",
  "gap",
  "align",
  "justify",
  "wrap",
  "padding",
  "background",
  "radius",
  "weight",
  "minWidth",
]);

function compactCatalogSchema(schema: Record<string, unknown>) {
  const withoutDescriptions = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutDescriptions);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key, child]) =>
              key !== "description" || typeof child !== "string",
          )
          .map(([key, child]) => [
            key,
            ["const", "enum", "default", "examples"].includes(key)
              ? child
              : withoutDescriptions(child),
          ]),
      );
    return value;
  };
  const compact = withoutDescriptions(schema) as Record<string, unknown>;
  const components = compact.components as Record<
    string,
    { properties: Record<string, unknown> }
  >;
  for (const name of EXPRESS_COMPONENTS) {
    const component = components[name];
    if (component)
      component.properties = Object.fromEntries(
        Object.entries(component.properties).filter(([key]) =>
          EXPRESS_PROPERTIES.has(key),
        ),
      );
  }
  return compact;
}

/** All model-visible signatures come from the very catalog the host renders. */
export async function createExpressCompiler(schema: Record<string, unknown>) {
  const [{ Catalog }, { ExpressParser, ExpressPromptGenerator }] =
    await Promise.all([
      import("@a2ui/web_core/catalog"),
      import("@a2ui/agent/express"),
    ]);
  const catalog = Catalog.fromJson(compactCatalogSchema(schema));
  const selected = catalog.withEntries(
    [...catalog.components.values()].filter((entry) =>
      (EXPRESS_COMPONENTS as readonly string[]).includes(entry.name),
    ),
    [...catalog.functions.values()].filter((entry) =>
      [
        "formatString",
        "formatCurrency",
        "required",
        "email",
        "numeric",
        "calc",
      ].includes(entry.name),
    ),
  );
  const examples = `### Example: an informational card\n<a2ui>\n${EXPRESS_PRESETS.card}\n</a2ui>\n\n### Example: a bound input and an action\n<a2ui>\n${EXPRESS_PRESETS.form}\n</a2ui>

### Example: a complete form with dropdowns, checkbox, and submission
<a2ui>
$/name = ""
$/email = ""
$/country = "Austria"
$/delivery = "Standard"
$/gift = false
$/notes = ""
name = TextField("Full name", $/name, required=true)
email = TextField("Email", $/email, variant="email", required=true)
country = Select("Country", ["Austria", "Germany", "Netherlands"], $/country)
delivery = Select("Delivery", ["Standard", "Express"], $/delivery)
gift = CheckBox("Gift wrap", $/gift)
notes = TextArea("Delivery notes", $/notes, rows=3)
submit = Button("Review order", submit=true, variant="primary")
form = Form([name, email, country, delivery, gift, notes, submit], Event("review_order", {name: $/name, email: $/email, country: $/country, delivery: $/delivery, gift: $/gift, notes: $/notes}), label="Checkout")
root = Card([Title("Your order"), Text("Order total: $53"), form])
</a2ui>

For arithmetic with named variables, use calc inside formatString interpolation; the renderer resolves its variables from paths. The calc constructor itself accepts only its declared expression parameter. In event context, pass data paths rather than function calls. Every Form in this demo MUST have an onSubmit Event as its second argument, with all the input data paths in its context. A submit=true Button submits that Form; it does not replace the Form's Event.

Express syntax reminders: constructor arguments use name=value. An array of children contains only component expressions or component variable names, never JSON property entries such as "span": 2 and never assignments such as name=TextField(...). Declare each form field on its own line, then pass the variable names to Form. The second Select argument is the options list and the third is the bound value. Do not repeat a positional argument as a named argument. Use only declared parameters. Badge color is one of secondary, success, danger, warning, info, discovery; omit it for a neutral badge. A custom hex color can be used on Title or Text.`;
  const guide = new ExpressPromptGenerator([selected], {
    [selected.id]: examples,
  }).generate();
  return {
    systemPrompt(manifest: GenerativeUIManifest) {
      return buildGenerativeUIPrompt(manifest, {
        format: "express",
        instructions: guide,
      });
    },
    compile(source: string, surfaceId: string, manifest: GenerativeUIManifest) {
      if (source.length > 60_000)
        throw new Error(
          "Express output exceeds the 60,000 character demo limit.",
        );
      const parser = new ExpressParser(selected, surfaceId, "v1.0");
      const parts = source.includes("<a2ui>")
        ? parser.unwrap(source)
        : [{ type: "a2ui" as const, a2uiRaw: source, isFinal: true }];
      const blocks = parts.filter((part) => part.type === "a2ui");
      if (!blocks.length || blocks.some((part) => !part.isFinal)) {
        throw new Error(
          "Finish the Express block with </a2ui> before compiling.",
        );
      }
      const operations = blocks.flatMap((part) =>
        part.type === "a2ui" ? parser.compile(part.a2uiRaw) : [],
      );
      if (!operations.length)
        throw new Error("The response contains no A2UI operations.");
      const known = new Set(
        Object.entries(manifest.surfaces)
          .filter(([, s]) => s.status !== "deleted" && s.status !== "failed")
          .map(([id]) => id),
      );
      const created = new Set(Object.keys(manifest.surfaces));
      for (const operation of operations) {
        const result = validateOperation(operation, {
          manifest,
          knownSurfaces: known,
          createdSurfaces: created,
          functions: manifest.functions,
          allowedComponents: {
            target: "express-preview",
            names: new Set(EXPRESS_COMPONENTS),
          },
        });
        if (!result.ok) throw new Error(result.reason);
        const typed = operation as A2UIOperation;
        const nodes =
          "createSurface" in typed
            ? typed.createSurface.components
            : "updateComponents" in typed
              ? typed.updateComponents.components
              : [];
        for (const node of nodes ?? []) {
          if (node.component === "Form" && node.onSubmit === undefined) {
            throw new Error(
              `Form "${node.id}" needs an onSubmit Event as its second argument: Form([field, submit], Event("submit_form", {field: $/field})). Use the event name requested by the user and include every input value. The submit button alone cannot dispatch the action.`,
            );
          }
        }
        const id = getOperationSurfaceId(operation)!;
        const kind = getOperationKind(operation);
        if (kind === "createSurface") {
          known.add(id);
          created.add(id);
        }
        if (kind === "deleteSurface") known.delete(id);
      }
      return operations as A2UIOperation[];
    },
  };
}

export type ExpressCompiler = Awaited<ReturnType<typeof createExpressCompiler>>;
