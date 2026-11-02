/** Prose requests only. Every click invokes the selected browser model. */
export const DEMO_PROMPTS = [
  {
    caseId: "acceptance-aquarium-card",
    label: "Aquarium card",
    description: "Opening hours, location and admission",
    request:
      "Create a polished informational card headed Blue Tide Aquarium. Include all these facts exactly: Open Wednesday–Sunday, 09:30–17:30. Harbor Gate 7. Adult admission €17.50. Use clear visual hierarchy. Do not add inputs, forms or buttons.",
  },
  {
    caseId: "acceptance-podcast-card",
    label: "Podcast card",
    description: "Episode details, host and schedule",
    request:
      "Create a polished informational card headed Signal & Sound — “The Quiet Hour”. Include all these facts exactly: Episode 42. Duration 38 minutes. Host: Anaïs Chen. New episodes every Friday. Use clear visual hierarchy. Do not add inputs, forms or buttons.",
  },
  {
    caseId: "curated-tailoring-form",
    label: "Fitting form",
    description: "Name, email, service choice and notes",
    request:
      'Create a form for Threadline Fitting. Show the heading Threadline Fitting. Show these facts: Consultation £18.00. Room B, second floor. Total £18.00. Use one form containing all the following inputs, once each: Client name (text); Contact email (email); Service (select with options Hemming, Jacket fitting); Fit notes (textarea). Client name starts at "". Contact email starts at "". Service starts at "Hemming". Fit notes starts at "". Include a submit button labelled Review appointment inside the form. When submitted, send the value of every input in the form submit event. This is a local demonstration.',
  },
  {
    caseId: "curated-book-delivery",
    label: "Book delivery form",
    description: "Eight inputs, delivery choices and order notes",
    request:
      'Create a form for Book Delivery. Show the heading Book Delivery. Show these facts: Atlas $31.75. Notebook $9.20. Shipping $4.05. Total $45.00. Use one form containing all the following inputs, once each: Full name (text); Contact email (email); Street (text); City (text); Postcode (text); Country (select with options Austria, Germany); Delivery (select with options Standard, Express); Order notes (textarea). Full name starts at "". Contact email starts at "". Street starts at "". City starts at "". Postcode starts at "". Country starts at "Austria". Delivery starts at "Standard". Order notes starts at "". Include a submit button labelled Review order inside the form. When submitted, send the value of every input in the form submit event. This is a local demonstration.',
  },
] as const;
