import { describe, expect, it } from "vitest";
import { exportA2UICatalog } from "@copilotkit/shared/generative-ui";
import { ExpressCompiler } from "./express-compiler";
import {
  EXPRESS_GENERATION_GUIDANCE,
  EXPRESS_PROMPT_EXAMPLES,
} from "./express-prompt-guidance";
import { testUI } from "./test-catalog";

const block = (source: string) => `<a2ui>\n${source}\n</a2ui>`;

describe("the lessons in the SDK guide", () => {
  it("reach the model through the generator's examples option", () => {
    const { systemPrompt } = new ExpressCompiler(exportA2UICatalog(testUI));
    expect(systemPrompt).toContain(EXPRESS_GENERATION_GUIDANCE);
    for (const { title } of EXPRESS_PROMPT_EXAMPLES)
      expect(systemPrompt).toContain(title);
  });

  it("compile: two new views and the follow-up that adds a summary to the second", () => {
    const compiler = new ExpressCompiler(exportA2UICatalog(testUI));
    const [card, form, followUp] = EXPRESS_PROMPT_EXAMPLES;
    expect(
      compiler.parse(block(card.source), "view-1").operations[0],
    ).toHaveProperty("createSurface.surfaceId", "view-1");
    const created = compiler.parse(block(form.source), "view-1").operations;
    expect(created[0]).toHaveProperty("createSurface.surfaceId", "view-1");
    const updates = compiler.parse(
      block(followUp.source),
      "view-2",
      created,
    ).operations;
    expect(updates).toEqual([
      expect.objectContaining({
        updateComponents: expect.objectContaining({ surfaceId: "view-1" }),
      }),
    ]);
  });
});
