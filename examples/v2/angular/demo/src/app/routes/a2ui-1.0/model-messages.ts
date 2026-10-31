export type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

/** CopilotKit owns history; each inference receives it exactly once. */
export function modelMessages(
  input: string,
): Exclude<ModelMessage, { role: "system" }>[] {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(input);
  } catch {
    return [{ role: "user", content: input }];
  }
  if (!data || !Array.isArray(data.conversation))
    return [{ role: "user", content: input }];
  const { conversation, ...context } = data;
  const turns = conversation.filter(
    (turn): turn is Exclude<ModelMessage, { role: "system" }> =>
      !!turn &&
      typeof turn === "object" &&
      (turn.role === "user" || turn.role === "assistant") &&
      typeof turn.content === "string",
  );
  const preamble = `Current application context and UI data:\n${JSON.stringify(context)}`;
  const last = turns.at(-1);
  if (last?.role === "user") {
    return [
      ...turns.slice(0, -1),
      {
        role: "user",
        content: `${preamble}\n\nCurrent user request:\n${last.content}`,
      },
    ];
  }
  return [
    ...turns,
    {
      role: "user",
      content: `${preamble}\n\nRespond to the current application action using its actual input values.`,
    },
  ];
}
