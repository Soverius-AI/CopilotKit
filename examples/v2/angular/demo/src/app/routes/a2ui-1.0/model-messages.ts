export type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

/** CopilotKit owns history; each inference receives it exactly once. The
 * local agent composes complete turns; any other keys are run data that
 * joins the last user turn. Consecutive turns of one role are merged, since
 * chat templates such as Gemma's require user and assistant to alternate. */
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
  const turns: Exclude<ModelMessage, { role: "system" }>[] = [];
  for (const turn of conversation)
    if (
      !!turn &&
      typeof turn === "object" &&
      (turn.role === "user" || turn.role === "assistant") &&
      typeof turn.content === "string"
    ) {
      const last = turns.at(-1);
      if (last && last.role === turn.role)
        turns[turns.length - 1] = {
          role: last.role,
          content: `${last.content}\n\n${turn.content}`,
        };
      else turns.push({ role: turn.role, content: turn.content });
    }
  if (!Object.keys(context).length && turns[0]?.role === "user") return turns;
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
