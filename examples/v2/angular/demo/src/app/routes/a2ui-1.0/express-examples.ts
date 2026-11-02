/** Test fixtures: a card, a form and the answer to its action. None of
 * them reaches a model. */
export const EXPRESS_EXAMPLES = {
  card: `heading = Title("Weather in Vienna", size="xl", color="#173b32")
summary = Text("18°C and clear skies")
badge = Badge("Sunny", color="success")
root = Card([heading, summary, badge], variant="outline", gap=4)`,
  /** A complete 8-field form. Created as view-1. */
  form: `$/name = ""
$/email = ""
$/company = ""
$/ticket = "Standard"
$/workshop = "Morning"
$/diet = "None"
$/updates = false
$/notes = ""
heading = Title("Register for Design Day")
price = Text("Standard ticket: €120")
name = TextField("Full name", $/name, required=true)
email = TextField("Email", $/email, variant="email", required=true)
company = TextField("Company", $/company)
ticket = Select("Ticket", ["Standard", "VIP"], $/ticket)
workshop = RadioGroup("Workshop", ["Morning", "Afternoon"], $/workshop)
diet = Select("Diet", ["None", "Vegetarian", "Vegan"], $/diet)
updates = CheckBox("Send me updates", $/updates)
notes = TextArea("Notes", $/notes, rows=3)
submit = Button("Register", submit=true, variant="primary")
form = Form([name, email, company, ticket, workshop, diet, updates, notes, submit], Event("register", {name: $/name, email: $/email, company: $/company, ticket: $/ticket, workshop: $/workshop, diet: $/diet, updates: $/updates, notes: $/notes}))
root = Card([heading, price, form], gap=3)`,
  /** The answer to that form's register action, in view-1, written from the
   * values the user submitted in the historical example. */
  review: `surface("view-1", update=true)
result = Card([Title("Check your registration"), Text("Full name: Ada Lovelace"), Text("Email: ada@example.com"), Text("Company: Analytical Engines"), Text("Ticket: VIP"), Text("Workshop: Afternoon"), Text("Diet: Vegetarian"), Text("Send me updates: Yes"), Text("Notes: Arriving at 10")], variant="soft", gap=4)
root = Card([heading, price, form, result], gap=3)`,
};

/** What the user submitted in the review example. */
export const EXAMPLE_REGISTRATION = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  ticket: "VIP",
  workshop: "Afternoon",
  diet: "Vegetarian",
  updates: true,
  notes: "Arriving at 10",
};
