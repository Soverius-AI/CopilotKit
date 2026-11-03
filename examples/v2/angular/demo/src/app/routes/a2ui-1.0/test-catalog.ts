import {
  createGenerativeUI,
  standardDeclarations,
  withStandardParameterOrder,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUIManifest } from "@copilotkit/shared";

export const testUI = createGenerativeUI({
  id: "express-test@1",
  components: Object.fromEntries(
    Object.entries(withStandardParameterOrder(standardDeclarations)).map(
      ([name, definition]) => [name, { ...definition, component: null }],
    ),
  ),
});
export const testManifest: GenerativeUIManifest = {
  catalogId: testUI.id,
  components: testUI.manifestComponents,
  functions: {},
  targets: [{ id: "express-preview", kind: "inline" }],
  surfaces: {},
};
