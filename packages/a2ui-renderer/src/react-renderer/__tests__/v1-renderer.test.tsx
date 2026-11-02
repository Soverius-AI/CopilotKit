import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { z } from "zod";
import { A2UIProvider, useA2UIActions } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import type { A2UIActions } from "../core/store";
import { basicCatalogV1 } from "../a2ui-react/catalog/basic/v1";
import { createCatalog } from "../create-catalog";
import { filterCatalog } from "../filter-catalog";
import {
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "../catalog-utils";

afterEach(cleanup);

function setup(catalog?: typeof basicCatalogV1) {
  let actions!: A2UIActions;
  const onAction = vi.fn();
  function Surface() {
    actions = useA2UIActions();
    return <A2UIRenderer surfaceId="checkout" />;
  }
  render(
    <A2UIProvider catalog={catalog} onAction={onAction}>
      <Surface />
    </A2UIProvider>,
  );
  return {
    get actions() {
      return actions;
    },
    onAction,
  };
}

describe("A2UI 1.0 through the existing React renderer", () => {
  it("creates inline UI, binds @path/@call, and sends edited input in actions", async () => {
    // No catalog override: the provider accepts both built-in wire versions.
    const { actions, onAction } = setup();
    act(() =>
      actions.processMessages([
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
      ]),
    );
    expect(await screen.findByText("Hello Ada")).toBeTruthy();
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.placeholder).toBe("Your name");
    expect((screen.getByLabelText("Quantity") as HTMLInputElement).step).toBe(
      "5",
    );
    expect(document.querySelector("video")!.poster).toBe(
      "https://example.test/poster.png",
    );
    fireEvent.change(input, { target: { value: "Grace" } });
    await screen.findByText("Hello Grace");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith(
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
    act(() =>
      actions.processMessages([
        {
          version: "v1.0",
          updateDataModel: {
            surfaceId: "checkout",
            path: "/other",
            value: null,
          },
        },
      ]),
    );
    expect(
      actions.getSurface("checkout").dataModel.get("/other"),
    ).toBeUndefined();
    expect(input.value).toBe("Grace");
    act(() => actions.clearSurfaces());
    expect(actions.getSurface("checkout")).toBeUndefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses 1.0 full replacement semantics instead of merging old props", async () => {
    const { actions } = setup(basicCatalogV1);
    act(() =>
      actions.processMessages([
        {
          version: "v1.0",
          createSurface: {
            surfaceId: "checkout",
            catalogId: basicCatalogV1.id,
            components: [
              {
                id: "root",
                component: "Text",
                text: "Before",
                variant: "caption",
              },
            ],
          },
        },
      ]),
    );
    expect((await screen.findByText("Before")).tagName).toBe("SMALL");
    act(() =>
      actions.processMessages([
        {
          version: "v1.0",
          updateComponents: {
            surfaceId: "checkout",
            components: [{ id: "root", component: "Text", text: "After" }],
          },
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByText("After").tagName).not.toBe("SMALL"),
    );
    expect(
      actions.getSurface("checkout").componentsModel.get("root").properties
        .variant,
    ).toBeUndefined();
  });

  it("creates and filters custom 1.0 catalogs without losing their schema definitions", async () => {
    const custom = createCatalog(
      { Price: { props: z.object({ amount: z.string() }) } },
      {
        Price: ({ props }) => <strong>{props.amount}</strong>,
      },
      { protocolVersion: "1.0", includeBasicCatalog: true },
    );
    const catalog = filterCatalog(custom, (name) => name !== "Video");
    const { actions } = setup(catalog);
    act(() =>
      actions.processMessages([
        {
          version: "v1.0",
          createSurface: {
            surfaceId: "checkout",
            catalogId: catalog.id,
            components: [
              { id: "root", component: "Column", children: ["total", "text"] },
              { id: "total", component: "Price", amount: "$42" },
              { id: "text", component: "Text", text: { "@path": "/title" } },
            ],
            dataModel: { title: "Total" },
          },
        },
      ]),
    );
    expect(await screen.findByText("$42")).toBeTruthy();
    expect(await screen.findByText("Total")).toBeTruthy();
    expect(catalog.components.has("Video")).toBe(false);
    expect(buildCatalogContextValue(catalog)).toContain("A2UI v1.0");
    const schema = extractCatalogComponentSchemas(catalog);
    expect(schema.protocolVersion).toBe("1.0");
    expect(JSON.stringify(schema)).not.toContain("v0_9");
  });
});
