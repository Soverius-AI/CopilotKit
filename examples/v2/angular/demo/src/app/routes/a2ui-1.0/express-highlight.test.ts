import { describe, expect, it } from "vitest";
import { highlightExpress, highlightJson } from "./express-highlight";

describe("Express syntax highlighting", () => {
  it("distinguishes bindings, constructors, strings and typed literals", () => {
    const html = highlightExpress(
      '<a2ui>\n$/email = ""\nroot = Card([TextField("Email", $/email)], gap=4, wrap=false)\n</a2ui>',
    );
    for (const scope of [
      "meta",
      "variable",
      "string",
      "keyword",
      "title function_",
      "number",
      "literal",
    ])
      expect(html).toContain(`class="hljs-${scope}"`);
    expect(html).toContain("$/email");
  });

  it("escapes model-supplied HTML instead of emitting executable elements", () => {
    const html = highlightExpress(
      'root = Text("<img src=x onerror=alert(1)> & <script>alert(1)</script>")',
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("keeps an unfinished streamed string visible", () => {
    const html = highlightExpress('root = Title("Still generating');
    expect(html).toContain("Still generating");
    expect(html).toContain('class="hljs-string"');
  });
});

describe("JSON syntax highlighting", () => {
  it("highlights debugger keys and typed values", () => {
    const html = highlightJson('{"stage":"ready","attempt":1,"valid":true}');
    for (const scope of ["attr", "string", "number", "literal"])
      expect(html).toContain(`class="hljs-${scope}"`);
  });
  it("escapes HTML in agent-state string values", () => {
    const html = highlightJson(
      JSON.stringify({ text: '<img src=x onerror="alert(1)">' }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
