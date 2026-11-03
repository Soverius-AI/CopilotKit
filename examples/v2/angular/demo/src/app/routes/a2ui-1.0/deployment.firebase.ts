import type { HubModelSource } from "./model-files";
import { E2B_EXPORT_ID, TARGET_EXPORT_ID } from "./model-identity";

/** Firebase hosts the app; Hugging Face hosts both pinned Express fine-tunes. */
export const EXPRESS_DEPLOYMENT = {
  standalone: true,
  modelRoot: new URL("/models/", location.origin).href,
  hubModels: {
    [TARGET_EXPORT_ID]: {
      repoId: "wolfmanfx/gemma-4-E4B-it-A2UI-Express-ONNX",
      revision: "c8b774d2610221080cac3e9bf3c915ccf76f8ecb",
    },
    [E2B_EXPORT_ID]: {
      repoId: "wolfmanfx/gemma-4-E2B-it-A2UI-Express-ONNX",
      revision: "b1e17443f869c5e22993d6492a157e58c586a117",
    },
  } as Readonly<Record<string, HubModelSource>>,
  homeHref: "/",
  homeLabel: "A2UI Express home",
} as const;
