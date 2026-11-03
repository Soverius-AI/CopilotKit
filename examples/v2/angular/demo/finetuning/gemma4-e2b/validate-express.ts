/** Offline training-data gate. This does not establish browser rendering. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createGenerativeUI,
  exportA2UICatalog,
  standardDeclarations,
  withStandardParameterOrder,
} from "@copilotkit/shared/generative-ui";
import {
  GenerativeUISurfaceManager,
  tryResolveDynamicValue,
} from "@copilotkit/core/generative-ui";
import { getOperationSurfaceId } from "@copilotkit/shared";
import {
  ExpressCompiler,
  EXPRESS_COMPONENTS,
} from "../../src/app/routes/a2ui-1.0/express-compiler.ts";
import { creationTurn } from "../../src/app/routes/a2ui-1.0/model-request.ts";

const ui = createGenerativeUI({
  id: "copilotkit/demo-shop@1",
  components: Object.fromEntries(
    Object.entries(withStandardParameterOrder(standardDeclarations)).map(
      ([name, definition]) => [name, { ...definition, component: null }],
    ),
  ),
});
const compiler = new ExpressCompiler(exportA2UICatalog(ui));
const validatorSha256 = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");
const args = process.argv.slice(2);
const prepare = args[0] === "--prepare";
if (prepare) args.shift();
const [input, output] = args;
if (!input || !output)
  throw new Error(
    "Usage: validate-express.ts [--prepare] input.jsonl output.jsonl",
  );
if (prepare) {
  const rows = readFileSync(input, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line);
      return {
        ...row,
        system_prompt: compiler.systemPrompt,
        model_request: creationTurn({
          request: row.request,
          earlier: [],
          context: [],
          views: [],
          newSurfaceId: "view-1",
        }),
      };
    });
  writeFileSync(
    output,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  console.log(JSON.stringify({ prepared: rows.length, output }));
  process.exit(0);
}
const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
const pathOf = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const path = record.path ?? record["@path"];
  return typeof path === "string" ? path : undefined;
};
const results = readFileSync(input, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    const row = JSON.parse(line);
    const id = row.case_id ?? row.id ?? String(index);
    try {
      const spec =
        typeof row.spec_json === "string"
          ? JSON.parse(row.spec_json)
          : row.spec;
      if (!spec) throw new Error("Missing expected test specification");
      const source = row.source ?? row.dsl;
      if (typeof source !== "string")
        throw new Error("Missing model-generated Express source");
      if (
        !/^<a2ui>[\s\S]*<\/a2ui>$/.test(source.trim()) ||
        source.match(/<a2ui>/g)?.length !== 1
      )
        throw new Error(
          "Training target must be one complete a2ui block with no surrounding prose",
        );
      const { operations } = compiler.parse(source, "view-1");
      if (operations.some((op) => getOperationSurfaceId(op) !== "view-1"))
        throw new Error("Creation must target only view-1");
      const manager = new GenerativeUISurfaceManager(ui, {
        onOperationRejected: ({ reason }) => {
          throw new Error(reason);
        },
      });
      manager.registerTarget("express-preview", {
        components: EXPRESS_COMPONENTS,
      });
      manager.ingest("training-validation", "a2ui-1.0", {
        surfaceId: "view-1",
        target: "express-preview",
        catalogId: ui.id,
        operations,
        status: "ready",
        rejected: [],
      });
      const surface = manager.getSurface("training-validation", "view-1");
      if (!surface) throw new Error("No surface was created");
      const nodes = surface.model.componentsModel.componentsMap;
      const slots = (type: string) =>
        Object.keys(ui.components.get(type)?.slots ?? {});
      const occurrences = new Map<string, number>();
      const reachable: string[] = [];
      let visits = 0;
      const visit = (componentId: string, ancestors = new Set<string>()) => {
        if (++visits > 10_000)
          throw new Error("Component graph exceeds the evaluation limit");
        if (ancestors.has(componentId))
          throw new Error(`Component cycle at ${componentId}`);
        const node = nodes.get(componentId);
        if (!node) throw new Error(`Missing component ${componentId}`);
        occurrences.set(componentId, (occurrences.get(componentId) ?? 0) + 1);
        if (!reachable.includes(componentId)) reachable.push(componentId);
        const next = new Set([...ancestors, componentId]);
        for (const slot of slots(node.type)) {
          const value = node.properties[slot];
          for (const child of Array.isArray(value) ? value : [value]) {
            if (typeof child === "string") visit(child, next);
            else if (child !== undefined && child !== null)
              throw new Error(
                "Template slots require a separate evaluation case",
              );
          }
        }
      };
      visit("root");
      const orphaned = [...nodes.keys()].filter((id) => !occurrences.has(id));
      if (orphaned.length)
        throw new Error(
          `Components are defined but unreachable from root: ${orphaned.slice(0, 12).join(", ")}`,
        );
      const kinds: Record<string, string> = {
        text: "TextField",
        email: "TextField",
        number: "TextField",
        select: "Select",
        checkbox: "CheckBox",
        textarea: "TextArea",
      };
      const editable = reachable.filter((id) =>
        [
          "TextField",
          "TextArea",
          "Select",
          "CheckBox",
          "Slider",
          "RadioGroup",
          "DateTimeInput",
        ].includes(nodes.get(id)!.type),
      );
      if (editable.length !== spec.required_fields.length)
        throw new Error(
          `Expected ${spec.required_fields.length} inputs, received ${editable.length}`,
        );
      const bindings: Record<string, string> = {};
      for (const field of spec.required_fields) {
        const matches = editable.filter(
          (id) =>
            normalize(nodes.get(id)!.properties.label) ===
            normalize(field.label),
        );
        if (matches.length !== 1)
          throw new Error(`Expected exactly one input labelled ${field.label}`);
        const fieldId = matches[0]!;
        const node = nodes.get(fieldId)!;
        if (occurrences.get(fieldId) !== 1)
          throw new Error(`Input ${field.label} renders more than once`);
        if (node.type !== kinds[field.kind])
          throw new Error(`Wrong control type for ${field.label}`);
        if (field.kind === "email" && node.properties.variant !== "email")
          throw new Error(`Email variant missing for ${field.label}`);
        if (field.kind === "number" && node.properties.variant !== "number")
          throw new Error(`Number variant missing for ${field.label}`);
        const path = pathOf(node.properties.value);
        if (!path)
          throw new Error(`Input ${field.label} has no two-way path binding`);
        if (surface.model.dataModel.get(path) === undefined)
          throw new Error(`Input ${field.label} has no initial data value`);
        if (
          Object.hasOwn(field, "initial") &&
          JSON.stringify(surface.model.dataModel.get(path)) !==
            JSON.stringify(field.initial)
        )
          throw new Error(`Wrong initial value for ${field.label}`);
        if (Object.values(bindings).includes(path))
          throw new Error(`Two inputs share ${path}`);
        bindings[field.key] = path;
        if (field.kind === "select") {
          const options = node.properties.options;
          if (!Array.isArray(options))
            throw new Error(`Missing options for ${field.label}`);
          const labels = options.map((option) =>
            typeof option === "string"
              ? option
              : (option as { label?: string }).label,
          );
          if (JSON.stringify(labels) !== JSON.stringify(field.options))
            throw new Error(`Wrong select options for ${field.label}`);
        }
        const value =
          field.kind === "checkbox"
            ? field.value === "true"
            : field.kind === "number"
              ? Number(field.value)
              : field.value;
        manager.setOwnedValue(surface.key, path, value);
      }
      const display = reachable.flatMap((id) => {
        const node = nodes.get(id)!;
        const raw =
          node.type === "Badge"
            ? node.properties.label
            : ["Title", "Text", "Caption"].includes(node.type)
              ? node.properties.text
              : undefined;
        if (raw === undefined) return [];
        const resolved = tryResolveDynamicValue(raw, {
          data: surface.model.dataModel,
          basePath: undefined,
        });
        return resolved.ok && resolved.value !== undefined
          ? [normalize(resolved.value)]
          : [];
      });
      if (
        spec.required_fields.length &&
        display.some(
          (text) =>
            /^(review\b|order summary\b)/i.test(text) &&
            !spec.required_text.some(
              (required: string) => normalize(required) === text,
            ),
        )
      )
        throw new Error(
          "Creation shows a review before the submit action; configure the Form Event and generate the review only in the action reply",
        );
      for (const text of spec.required_text)
        if (!display.some((value) => value.includes(normalize(text))))
          throw new Error(`Requested text is not reachable: ${text}`);
      if (spec.required_fields.length) {
        const forms = reachable.filter((id) => nodes.get(id)!.type === "Form");
        if (forms.length !== 1)
          throw new Error(
            `Expected one reachable Form, received ${forms.length}`,
          );
        const submit = reachable.filter((id) => {
          const n = nodes.get(id)!;
          return (
            n.type === "Button" &&
            n.properties.submit === true &&
            normalize(n.properties.label) === normalize(spec.submit_label)
          );
        });
        if (submit.length !== 1)
          throw new Error("Missing or duplicated requested submit button");
        const event = (
          nodes.get(forms[0]!)!.properties.onSubmit as {
            event?: { name?: string; context?: unknown };
          }
        )?.event;
        if (!event?.name) throw new Error("Form has no named submit Event");
        const paths = new Set<string>();
        const collectPaths = (value: unknown) => {
          const path = pathOf(value);
          if (path) paths.add(path);
          else if (value && typeof value === "object")
            Object.values(value).forEach(collectPaths);
        };
        collectPaths(event.context);
        for (const path of Object.values(bindings))
          if (!paths.has(path) && !paths.has("/") && !paths.has(""))
            throw new Error(`Submit Event omits ${path}`);
      }
      return {
        ...row,
        validation: {
          accepted: true,
          level: "compiler_graph_and_owned_state",
          validatorSha256,
          browserVerified: false,
          inputBindings: bindings,
          display,
          operations,
        },
      };
    } catch (error) {
      return {
        ...row,
        validation: {
          accepted: false,
          level: "compiler_graph_and_owned_state",
          validatorSha256,
          browserVerified: false,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
writeFileSync(
  output,
  results.map((row) => JSON.stringify(row)).join("\n") + "\n",
);
const accepted = results.filter((row) => row.validation.accepted).length;
console.log(
  JSON.stringify({
    rows: results.length,
    accepted,
    rejected: results.length - accepted,
    output,
  }),
);
