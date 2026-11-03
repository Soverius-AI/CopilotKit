import type { ActionGuidance } from "./chrome-express-agent";

/** What the shop wants when a checkout form is submitted. The model names the
 * event (review_order, submit_order, ...) and still generates the UI. A bare
 * "review", "submit" or "confirm" counts only on a view built for a checkout,
 * so review_article or a review of a trip form does not match. */
export const CHECKOUT_GUIDANCE: ActionGuidance = {
  description: "Leaf & Light checkout actions",
  matches: (actionName, origin = "") =>
    /order|checkout/i.test(actionName) ||
    (/^(review|submit|confirm)$/i.test(actionName) &&
      /checkout|\bcart\b/i.test(origin)),
  value:
    "The shopper submitted the checkout form to check the order before paying. Answer in the same surface: keep the title, the total, the form and its values, and add a Card titled Review your order with one Text per submitted field showing its actual value as text, plus the order total. The review is only a summary: add no Button or other action, because the shop defines no action after review.",
};
