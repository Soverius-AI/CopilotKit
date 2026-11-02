import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { basicCatalogV1 } from "../basic/v1";
import { CopilotA2UISurface } from "../surface";
import { createAngularCatalog } from "../create-catalog";
import { normalizeA2UIOperations } from "../operations";
import { getRenderedA2UIOperations } from "../../../lib/components/a2ui/a2ui-tool-operations";
import {
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "../../../lib/components/a2ui/a2ui-catalog-context";

afterEach(() => TestBed.resetTestingModule());

function setup(catalog = basicCatalogV1) {
  const fixture = TestBed.createComponent(CopilotA2UISurface);
  fixture.componentRef.setInput("catalog", catalog);
  const action = vi.fn();
  const error = vi.fn();
  fixture.componentInstance.action.subscribe(action);
  fixture.componentInstance.error.subscribe(error);
  return { fixture, host: fixture.nativeElement as HTMLElement, action, error };
}

describe("A2UI 1.0 through the existing Angular renderer", () => {
  it("converts tool snapshots using the configured catalog's protocol", () => {
    const operations = getRenderedA2UIOperations(
      {
        status: "complete",
        args: {},
        result: JSON.stringify({
          snapshot: {
            surfaceId: "s",
            data: { name: "Ada" },
            components: [{ id: "root", component: "Text", text: "Ready" }],
          },
        }),
      },
      "1.0",
    );
    expect(operations.map((operation) => operation.version)).toEqual([
      "v1.0",
      "v1.0",
      "v1.0",
    ]);
    expect(operations[0]).toEqual({
      version: "v1.0",
      createSurface: { surfaceId: "s", catalogId: basicCatalogV1.id },
    });
  });
  it("renders inline creation and sends the current @path-bound input in an action", async () => {
    const { fixture, host, action, error } = setup();
    const operations = [
      {
        version: "v1.0",
        createSurface: {
          surfaceId: "checkout",
          catalogId: basicCatalogV1.id,
          dataModel: { name: "Ada", other: "keep" },
          components: [
            {
              id: "root",
              component: "Column",
              children: ["name", "greeting", "save", "slider", "video"],
            },
            {
              id: "name",
              component: "TextField",
              label: "Name",
              value: { "@path": "/name" },
              placeholder: "Your name",
            },
            {
              id: "greeting",
              component: "Text",
              text: {
                "@call": "formatString",
                args: { value: "Hello ${/name}" },
              },
            },
            {
              id: "save",
              component: "Button",
              child: "label",
              action: {
                event: {
                  name: "save",
                  userMessage: "Save checkout",
                  context: { name: { "@path": "/name" } },
                },
              },
            },
            { id: "label", component: "Text", text: "Save" },
            {
              id: "slider",
              component: "Slider",
              label: "Quantity",
              value: 25,
              min: 0,
              max: 100,
              steps: 20,
            },
            {
              id: "video",
              component: "Video",
              url: "https://example.test/video.mp4",
              posterUrl: "https://example.test/poster.png",
            },
          ],
        },
      },
    ];
    fixture.componentRef.setInput("operations", operations);
    await fixture.whenStable();
    expect(error).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Hello Ada");
    const input = host.querySelector("input")!;
    expect(input.placeholder).toBe("Your name");
    expect(
      host.querySelector<HTMLInputElement>('input[type="range"]')!.step,
    ).toBe("5");
    expect(host.querySelector("video")!.poster).toBe(
      "https://example.test/poster.png",
    );
    input.value = "Grace";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(host.textContent).toContain("Hello Grace"));
    host.querySelector("button")!.click();
    await vi.waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({
          userAction: expect.objectContaining({
            name: "save",
            userMessage: "Save checkout",
            surfaceId: "checkout",
            context: { name: "Grace" },
          }),
        }),
      ),
    );
    fixture.componentRef.setInput("operations", [
      ...operations,
      {
        version: "v1.0",
        updateDataModel: { surfaceId: "checkout", path: "/other", value: null },
      },
    ]);
    await fixture.whenStable();
    expect(host.querySelector("input")!.value).toBe("Grace");
    fixture.componentRef.setInput("operations", [
      ...operations,
      { version: "v1.0", deleteSurface: { surfaceId: "checkout" } },
    ]);
    await fixture.whenStable();
    expect(host.querySelector("input")).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it("fully replaces properties and infers 1.0 only for unversioned operations", async () => {
    const catalog = createAngularCatalog(
      {},
      {},
      { protocolVersion: "1.0", includeBasicCatalog: true },
    );
    const { fixture, host, error } = setup(catalog);
    const operations = [
      {
        createSurface: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "TextField",
              label: "Before",
              value: "Ada",
              placeholder: "Old placeholder",
            },
          ],
        },
      },
    ];
    fixture.componentRef.setInput("operations", operations);
    await fixture.whenStable();
    expect(error).not.toHaveBeenCalled();
    expect(host.querySelector("input")!.placeholder).toBe("Old placeholder");
    fixture.componentRef.setInput("operations", [
      ...operations,
      {
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "TextField",
              label: "After",
              value: "Grace",
            },
          ],
        },
      },
    ]);
    await fixture.whenStable();
    expect(host.textContent).toContain("After");
    expect(host.querySelector("input")!.placeholder).toBe("");
    expect(host.querySelector("input")!.value).toBe("Grace");
    expect(error).not.toHaveBeenCalled();
    const [explicit] = normalizeA2UIOperations(
      [{ version: "v0.9", deleteSurface: { surfaceId: "s" } }],
      catalog.id,
      "1.0",
    );
    expect(explicit!.version).toBe("v0.9");
    expect(buildCatalogContextValue(catalog)).toContain("A2UI v1.0");
    const schema = extractCatalogComponentSchemas(catalog);
    expect(schema.protocolVersion).toBe("1.0");
    expect(JSON.stringify(schema)).not.toContain("v0_9");
  });
});
