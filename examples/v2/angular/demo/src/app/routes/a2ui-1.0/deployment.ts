import type { HubModelSource } from "./model-files";

/** Local development keeps the separately served experiment weights. */
export const EXPRESS_DEPLOYMENT = {
  standalone: false,
  modelRoot: "http://127.0.0.1:8899/models/",
  hubModels: {} as Readonly<Record<string, HubModelSource>>,
  homeHref: "/generative-ui",
  homeLabel: "Back to generative UI",
} as const;
