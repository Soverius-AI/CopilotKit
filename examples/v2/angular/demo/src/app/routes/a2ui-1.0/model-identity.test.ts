import { describe, expect, it } from "vitest";
import {
  E2B_ADAPTER_SHA256,
  E2B_EXPORT_ID,
  exportBase,
  isLocalExportId,
  localModelId,
  PUBLISHED_ADAPTERS,
  TARGET_ADAPTER_SHA256,
  TARGET_EXPORT_ID,
} from "./model-identity";

describe("local export identity", () => {
  it("publishes the retrained E2B adapter beside the E4B target", () => {
    expect(E2B_EXPORT_ID).toBe("e2b-mlx1s100-eff96be9f058");
    expect(E2B_ADAPTER_SHA256.startsWith("eff96be9f058")).toBe(true);
    expect(PUBLISHED_ADAPTERS).toEqual({
      [TARGET_EXPORT_ID]: TARGET_ADAPTER_SHA256,
      [E2B_EXPORT_ID]: E2B_ADAPTER_SHA256,
    });
    expect(exportBase(E2B_EXPORT_ID)).toMatchObject({
      size: "E2B",
      matrices: 240,
      gigabytes: 3.1,
    });
    expect(PUBLISHED_ADAPTERS["round2-0cf5af05c20f"]).toBeUndefined();
  });

  it("targets an E4B adapter named by its hash prefix", () => {
    expect(TARGET_EXPORT_ID).toBe("e4b-pilot2s40-d53063f5f606");
    expect(TARGET_ADAPTER_SHA256.startsWith("d53063f5f606")).toBe(true);
    expect(isLocalExportId(TARGET_EXPORT_ID)).toBe(true);
    expect(localModelId(TARGET_EXPORT_ID)).toBe(
      "local/gemma-4-e4b-pilot2s40-d53063f5f606",
    );
    expect(exportBase(TARGET_EXPORT_ID).size).toBe("E4B");
  });

  it("names E2B rounds and E4B adapters by their Gemma 4 size", () => {
    expect(isLocalExportId("round2-0cf5af05c20f")).toBe(true);
    expect(isLocalExportId("e4b-pilot1-5cfe14039ee4")).toBe(true);
    expect(isLocalExportId("e4b-pilot1")).toBe(false);
    expect(localModelId("round2-0cf5af05c20f")).toBe(
      "local/gemma-4-e2b-round2-0cf5af05c20f",
    );
    expect(localModelId("e4b-pilot1-5cfe14039ee4")).toBe(
      "local/gemma-4-e4b-pilot1-5cfe14039ee4",
    );
    expect(exportBase("e4b-pilot1-5cfe14039ee4")).toMatchObject({
      size: "E4B",
      model: "unsloth/gemma-4-E4B-it",
      matrices: 300,
    });
    expect(exportBase("round2-0cf5af05c20f")).toMatchObject({
      size: "E2B",
      model: "unsloth/gemma-4-E2B-it",
      matrices: 170,
    });
  });

  it("expects mlx_lm E2B adapters to patch every projection", () => {
    expect(isLocalExportId("e2b-mlx1s100-0123456789ab")).toBe(true);
    expect(localModelId("e2b-mlx1s100-0123456789ab")).toBe(
      "local/gemma-4-e2b-mlx1s100-0123456789ab",
    );
    expect(exportBase("e2b-mlx1s100-0123456789ab")).toMatchObject({
      size: "E2B",
      model: "unsloth/gemma-4-E2B-it",
      matrices: 240,
    });
  });
});
