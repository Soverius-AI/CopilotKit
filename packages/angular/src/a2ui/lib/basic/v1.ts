import { basicCatalog as officialCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { CopilotA2UICatalog } from "../catalog";
import { basicComponents } from "./catalog";

/** Official A2UI 1.0 schemas with native Angular component implementations. */
export const basicComponentsV1 = [...officialCatalog.components.values()].map(
  (api) => {
    const implementation = basicComponents.find(
      (entry) => entry.name === api.name,
    );
    if (!implementation) {
      throw new Error(`No Angular renderer for A2UI 1.0 component ${api.name}`);
    }
    return { ...implementation, schema: api.schema };
  },
);

export const basicCatalogV1 = new CopilotA2UICatalog(
  officialCatalog.id,
  basicComponentsV1,
  [...officialCatalog.functions.values()],
  officialCatalog,
  undefined,
  "1.0",
);
