import { basicCatalog as officialCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { basicCatalog } from "./index";
import { Catalog } from "@a2ui/web_core/catalog";
import type { ReactComponentImplementation } from "../../adapter";

/** A2UI 1.0 basic schemas and functions rendered with native React components. */
export const basicCatalogV1 = new Catalog<ReactComponentImplementation>(
  officialCatalog.id,
  "1.0",
  [...officialCatalog.components.values()].map((api) => {
    const implementation = basicCatalog.components.get(api.name);
    if (!implementation?.withSchema) {
      throw new Error(`No React renderer for A2UI 1.0 component ${api.name}`);
    }
    return implementation.withSchema(api.schema);
  }),
  [...officialCatalog.functions.values()],
  officialCatalog,
);
