/** Resolve supplemental price checks with SDK state, preserving the frozen grader. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  GenerativeUISurfaceManager,
  tryResolveDynamicValue,
} from "@copilotkit/core/generative-ui";
import {
  createGenerativeUI,
  standardDeclarations,
  withStandardParameterOrder,
} from "@copilotkit/shared/generative-ui";
import { EXPRESS_COMPONENTS } from "../../src/app/routes/a2ui-1.0/express-compiler.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Usage: resolve-display.ts validated.jsonl resolved.jsonl");
const ui = createGenerativeUI({
  id: "copilotkit/demo-shop@1",
  components: Object.fromEntries(
    Object.entries(withStandardParameterOrder(standardDeclarations)).map(
      ([name, definition]) => [name, { ...definition, component: null }],
    ),
  ),
});
const resolverSha256 = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");
const rows = readFileSync(input, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const row = JSON.parse(line);
    if (!row.validation?.accepted) return row;
    const manager = new GenerativeUISurfaceManager(ui, {
      onOperationRejected: ({ reason }) => {
        throw new Error(reason);
      },
    });
    try {
      manager.registerTarget("express-preview", {
        components: EXPRESS_COMPONENTS,
      });
      manager.ingest("supplemental-display", "a2ui-1.0", {
        surfaceId: "view-1",
        target: "express-preview",
        catalogId: ui.id,
        operations: row.validation.operations,
        status: "ready",
        rejected: [],
      });
      const surface = manager.getSurface("supplemental-display", "view-1");
      if (!surface) throw new Error("No surface was created");
      // Match the frozen grader's owned edits before resolving display values.
      const spec =
        typeof row.spec_json === "string"
          ? JSON.parse(row.spec_json)
          : row.spec;
      for (const field of spec.required_fields) {
        const path = row.validation.inputBindings[field.key];
        if (!path) throw new Error(`Missing graded binding for ${field.label}`);
        manager.setOwnedValue(
          surface.key,
          path,
          field.kind === "checkbox"
            ? field.value === "true"
            : field.kind === "number"
              ? Number(field.value)
              : field.value,
        );
      }
      const byComponent: Record<string, string> = {};
      for (const [id, node] of surface.model.componentsModel.componentsMap) {
        if (!["Text", "Title", "Caption", "Badge"].includes(node.type))
          continue;
        const raw =
          node.type === "Badge" ? node.properties.label : node.properties.text;
        const value = tryResolveDynamicValue(raw, {
          data: surface.model.dataModel,
          basePath: undefined,
        });
        if (!value.ok || typeof value.value !== "string")
          throw new Error(`Display ${id} did not resolve to text`);
        byComponent[id] = value.value;
      }
      return { ...row, supplemental_display: { resolverSha256, byComponent } };
    } catch (error) {
      return {
        ...row,
        supplemental_display: {
          resolverSha256,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
writeFileSync(output, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
console.log(
  JSON.stringify({
    rows: rows.length,
    resolved: rows.filter((row) => row.supplemental_display?.byComponent)
      .length,
    output,
  }),
);
