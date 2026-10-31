/// <reference types="@types/dom-chromium-ai" />

const OPTIONS: LanguageModelCreateCoreOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

/** CopilotKit's run data becomes real Prompt API turns, with context as data. */
function nativePrompt(input: string): LanguageModelPrompt {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(input);
  } catch {
    return input;
  }
  if (!data || !Array.isArray(data.conversation)) return input;
  const { conversation, ...context } = data;
  const turns = conversation.filter(
    (turn): turn is { role: "user" | "assistant"; content: string } =>
      !!turn &&
      typeof turn === "object" &&
      (turn.role === "user" || turn.role === "assistant") &&
      typeof turn.content === "string",
  );
  return [
    {
      role: "user",
      content: `Current application context and UI data:\n${JSON.stringify(context)}`,
    },
    ...turns,
  ];
}

/** The browser owns the model; CopilotKit owns the conversation history. */
export class ChromeModel {
  #base?: LanguageModel;
  #systemPrompt?: string;

  async availability(): Promise<Availability | "unsupported"> {
    if (typeof LanguageModel === "undefined") return "unsupported";
    return LanguageModel.availability(OPTIONS);
  }

  async enable(
    systemPrompt: string,
    signal: AbortSignal,
    progress: (value: number) => void,
  ) {
    this.destroy();
    if (typeof LanguageModel === "undefined")
      throw new Error(
        "Chrome's Prompt API is not available. Open this demo in an eligible desktop Chrome browser on localhost or HTTPS.",
      );
    const session = await LanguageModel.create({
      ...OPTIONS,
      initialPrompts: [{ role: "system", content: systemPrompt }],
      signal,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) =>
          progress(event.loaded),
        );
      },
    });
    if (signal.aborted) {
      session.destroy();
      signal.throwIfAborted();
    }
    this.#base = session;
    this.#systemPrompt = systemPrompt;
  }

  async *generate(input: string, systemPrompt: string, signal: AbortSignal) {
    if (!this.#base || this.#systemPrompt !== systemPrompt) {
      throw new Error(
        "Enable the local model for the current catalog before generating.",
      );
    }
    const session = await this.#base.clone({ signal });
    try {
      // A clone starts with just the system contract. History is supplied once
      // by the local agent, not accumulated again in a long-lived model session.
      const reader = session
        .promptStreaming(nativePrompt(input), { signal })
        .getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      session.destroy();
    }
  }

  destroy() {
    this.#base?.destroy();
    this.#base = undefined;
    this.#systemPrompt = undefined;
  }
}
