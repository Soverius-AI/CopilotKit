import {
  A2uiCompilationError,
  A2uiGenerator,
  CatalogConfig,
  ComponentPruningTransformer,
  ExpressFormatFactory,
} from "@a2ui/agent";
import type { A2uiRequestProcessor } from "@a2ui/agent";
import { Catalog } from "@a2ui/web_core/catalog";
import type { A2UIOperation } from "@copilotkit/shared";
import { EXPRESS_PROMPT_LESSONS } from "./express-prompt-guidance";

export const EXPRESS_COMPONENTS = [
  "Card",
  "Column",
  "Row",
  "Title",
  "Text",
  "Caption",
  "Badge",
  "Divider",
  "TextField",
  "TextArea",
  "Button",
  "CheckBox",
  "Slider",
  "Select",
  "Form",
  "RadioGroup",
  "DateTimeInput",
] as const;

/** The demo deletes no surface while it generates. */
const ALLOWED_MESSAGES = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
];

/** A line of a response block that the compiler rejected. */
export interface InvalidLine {
  /** The block the line belongs to, as the response wrote it. */
  block: string;
  /** Its index in the block's lines. */
  index: number;
  text: string;
}

/** The operations in the parts the SDK read from a response. */
export function operationsOf(parts: readonly { type: string }[]) {
  return parts.flatMap((part) =>
    "a2ui" in part ? (part.a2ui as A2UIOperation[]) : [],
  );
}

/** The A2UI SDK's Express prompt and parser over the demo's components. */
export class ExpressCompiler {
  readonly systemPrompt: string;
  readonly #catalogId: string;
  readonly #generator: A2uiGenerator;
  /** For what no request's surface changes: the prompt, states and tags. */
  readonly #base: A2uiRequestProcessor;

  constructor(schema: Record<string, unknown>) {
    const catalog = Catalog.fromJson(schema);
    this.#catalogId = catalog.id;
    // The examples carry the lessons the fine-tune needs: without them it
    // writes bare calls and no root.
    this.#generator = new A2uiGenerator(
      [
        new CatalogConfig(catalog, [
          new ComponentPruningTransformer([...EXPRESS_COMPONENTS]),
        ]),
      ],
      { [catalog.id]: EXPRESS_PROMPT_LESSONS },
    );
    this.#base = this.#processor();
    this.systemPrompt = this.#base.promptSnippet;
  }

  /** A complete response, checked against the committed surfaces: its
   * operations and its prose. Throws the SDK's error. */
  parse(
    response: string,
    surfaceId: string,
    committed: readonly A2UIOperation[] = [],
  ) {
    const parts = this.#processor(surfaceId).parseResponse(response, {
      state: this.#state(committed),
    });
    const text = parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();
    return { operations: operationsOf(parts), text };
  }

  /** The SDK's stream for a response as the model writes it; its `feed`
   * throws once a block is rejected. */
  stream(surfaceId: string, committed: readonly A2UIOperation[] = []) {
    return this.#processor(surfaceId).openStream({
      state: this.#state(committed),
    });
  }

  /** The line a compiler error is about, or undefined when no single line
   * is: a syntax error names its line, and a catalog error is the line that
   * fails the same way on its own. */
  invalidLine(error: unknown): InvalidLine | undefined {
    if (!(error instanceof A2uiCompilationError)) return undefined;
    const lines = error.rawContent.split("\n");
    const index =
      error.line !== undefined
        ? error.line - 1
        : lines.findIndex((line) => this.#failsAlike(line, error));
    const text = lines[index];
    if (!text?.trim()) return undefined;
    return { block: error.rawContent, index, text };
  }

  /** The response with the corrected statement in place of the rejected
   * line, or undefined when the response no longer holds its block. */
  hotSwap(response: string, line: InvalidLine, correction: string) {
    if (!response.includes(line.block)) return undefined;
    // The model may wrap its one statement in <a2ui> tags.
    const tagged = this.#base.parser
      .unwrap(correction)
      .find((part) => part.type === "a2ui");
    const statement = tagged?.type === "a2ui" ? tagged.a2uiRaw : correction;
    const lines = line.block.split("\n");
    lines[line.index] = statement.trim();
    return response.replace(line.block, () => lines.join("\n"));
  }

  /** The processor of one request. A block without surface(...) compiles to
   * `surfaceId`, the host's id for a new view. */
  #processor(surfaceId?: string) {
    return this.#generator.createProcessor(
      { "1.0": { supportedCatalogIds: [this.#catalogId] } },
      new ExpressFormatFactory({
        surfaceId,
        allowedMessages: ALLOWED_MESSAGES,
      }),
    );
  }

  /** The surfaces the renderer holds, as the committed operations built
   * them. */
  #state(committed: readonly A2UIOperation[]) {
    const state = this.#base.createState();
    if (committed.length) state.apply(committed);
    return state;
  }

  /** Whether a line, compiled on its own, fails with the same error. */
  #failsAlike(line: string, error: Error) {
    try {
      this.#base.parser.compile(line, false);
      return false;
    } catch (lineError) {
      return lineError instanceof Error && lineError.message === error.message;
    }
  }
}
