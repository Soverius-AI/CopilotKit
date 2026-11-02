import { describe, expect, it } from "vitest";
import { isExpressRoutePath } from "./route-path";

describe("browser-inference route detection", () => {
  it.each([
    ["/a2ui-1.0", "http://localhost:4200/"],
    ["/a2ui-1.0/", "http://localhost:4200/"],
    ["/a2ui-1.0/evaluation", "http://localhost:4200/"],
    ["/demos/a2ui-1.0/evaluation/", "https://example.com/demos/"],
    ["/demos/a2ui-1.0", "https://example.com/demos/"],
    ["/demos/a2ui-1.0/", "https://example.com/demos"],
  ])("matches %s under base %s", (pathname, base) => {
    expect(isExpressRoutePath(pathname, base)).toBe(true);
  });

  it.each([
    ["/", "http://localhost:4200/"],
    ["/a2ui-demo", "http://localhost:4200/"],
    ["/generative-ui", "http://localhost:4200/"],
    ["/a2ui-1.0x", "http://localhost:4200/"],
    ["/a2ui-1.0/extra", "http://localhost:4200/"],
    ["/other/a2ui-1.0", "http://localhost:4200/"],
    ["/a2ui-1.0", "https://example.com/demos/"],
  ])("keeps the runtime for %s under base %s", (pathname, base) => {
    expect(isExpressRoutePath(pathname, base)).toBe(false);
  });
});
