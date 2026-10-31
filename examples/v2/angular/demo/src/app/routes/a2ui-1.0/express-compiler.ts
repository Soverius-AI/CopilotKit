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

/** All model-visible signatures come from the very catalog the host renders. */
export async function createExpressCompiler(schema: Record<string, unknown>) {
  const [{ Catalog }, { ExpressParser, ExpressPromptGenerator }] =
    await Promise.all([
      import("@a2ui/web_core/catalog"),
      import("@a2ui/agent/express"),
    ]);
  const catalog = Catalog.fromJson(schema);
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

### Example: live formatting and validation
<a2ui>
$/budget = 2500
$/email = ""
budget = Slider("Project budget", $/budget, 500, 10000, step=500)
summary = Text(formatCurrency(value=$/budget, currency="USD"))
email = TextField("Work email", $/email, checks=[{condition: email(value=$/email), message: "Use a valid email address."}])
root = Card([Title("Tell us about your project"), budget, summary, email])
</a2ui>

For arithmetic with named variables, use calc inside formatString interpolation; the renderer resolves its variables from paths. The calc constructor itself accepts only its declared expression parameter. In event context, pass data paths rather than function calls. Use Form with a submit=true Button for native browser form validation.`;
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
