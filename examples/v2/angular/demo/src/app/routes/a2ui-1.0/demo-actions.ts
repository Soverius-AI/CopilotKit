import type { A2UIActionMessage } from "@copilotkit/shared";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const money = (value: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    typeof value === "number" && Number.isFinite(value) ? value : 0,
  );

/** Deterministic acknowledgements for the explicitly manual demo forms. */
export function demoActionSource(
  message: A2UIActionMessage,
): string | undefined {
  const { name, surfaceId, context } = message.action;
  let status: string;
  if (name === "demo_checkout") {
    const customer = record(context.customer);
    const address = record(context.address);
    const items = record(context.items);
    const subtotal =
      89 * Number(items.backpacks ?? 0) + 24 * Number(items.bottles ?? 0);
    const total =
      subtotal * (context.promo === "SAVE10" ? 0.9 : 1) +
      (context.delivery === "express" ? 9 : 0) +
      (context.gift === true ? 5 : 0);
    status = `Order preview ready for ${String(customer.firstName ?? "you")}. ${String(items.backpacks ?? 0)} backpack(s), ${String(items.bottles ?? 0)} bottle(s) · ${money(total)} · ${context.delivery === "express" ? "Express" : "Standard"} delivery to ${String(address.city ?? "your address")}. This is a preview; no order was placed.`;
  } else if (name === "demo_project") {
    const person = record(context.person);
    const project = record(context.project);
    status = `Brief saved for ${String(person.name ?? "you")} · ${money(project.budget)} budget · starting ${String(project.startDate ?? "soon").split("T")[0]} · ${project.contact === "call" ? "Schedule a call" : "Email"} preferred. Your entered values are preserved in this session.`;
  } else {
    return undefined;
  }
  return `surface(${JSON.stringify(surfaceId)}, update=true)\n$/status = ${JSON.stringify(status)}`;
}
