/** Complete, editable programs compiled by the same SDK as model output. */
// Keep variadic arithmetic in the renderer's formatString interpolation: the
// pinned Express SDK accepts only explicitly declared constructor arguments.
const totalExpression =
  '(89 * bags + 24 * bottles) * (promo == "SAVE10" ? 0.9 : 1) + (delivery == "express" ? 9 : 0) + (gift ? 5 : 0)';
const totalTemplate = `\${formatCurrency(value: calc(expression: '${totalExpression}', bags: /items/backpacks, bottles: /items/bottles, promo: /promo, delivery: /delivery, gift: /gift), currency: 'USD')}`;
const orderTotal = `formatString(value=${JSON.stringify(totalTemplate)})`;

export const EXPRESS_PRESETS = {
  card: `eyebrow = Row([Caption("COPILOTKIT / BROWSER LAB", size="sm"), Badge("A2UI 1.0", variant="outline")], justify="spaceBetween", align="center")
heading = Title("From intent to interface.", size="2xl", color="#173b32")
intro = Text("A small language for a real interface. Express turns compact UI descriptions into native, reactive components.", color="secondary")
describe = Column([Title("01 · Describe", size="sm"), Caption("Teach the UI language with a catalog and examples.")], gap=1)
compile = Column([Title("02 · Compile", size="sm"), Caption("Turn Express into validated A2UI v1.0 operations.")], gap=1)
render = Column([Title("03 · Render", size="sm"), Caption("Watch native Angular components bring it to life.")], gap=1)
summary = Column([Caption("ONE CONTINUOUS FLOW", size="sm"), Text("Express → A2UI v1.0 → Native UI", fontWeight="semibold", color="#173b32")], background="#eef5ef", padding=4, radius="lg", gap=1)
root = Card([eyebrow, heading, intro, Divider(), describe, compile, render, summary, Badge("Compiled locally", color="success")], variant="outline", size="lg", gap=4)`,
  form: `$/name = ""
$/status = "Ready to submit"
heading = Title("Plan your next adventure")
name = TextField("Your name", $/name, placeholder="Alex")
status = Text($/status)
submit = Button("Create my itinerary", Event("plan_trip", {name: $/name}))
root = Card([heading, name, status, submit])`,
  shopping: `$/customer = {firstName: "", lastName: "", email: ""}
$/address = {street: "", city: "", postalCode: "", country: "AT"}
$/items = {backpacks: 1, bottles: 1}
$/delivery = "standard"
$/gift = false
$/promo = ""
$/notes = ""
$/consent = false
$/status = "Your order preview will appear here."
firstName = TextField("First name", $/customer/firstName, placeholder="Alex", required=true, checks=[{condition: required(value=$/customer/firstName), message: "Enter your first name."}])
lastName = TextField("Last name", $/customer/lastName, placeholder="Morgan", required=true)
names = Row([Column([firstName], weight=1, minWidth="160px"), Column([lastName], weight=1, minWidth="160px")], wrap="wrap")
email = TextField("Email address", $/customer/email, variant="email", placeholder="alex@example.com", required=true, checks=[{condition: email(value=$/customer/email), message: "Use a valid email address."}])
street = TextField("Street address", $/address/street, placeholder="12 Garden Street", required=true)
city = TextField("City", $/address/city, placeholder="Vienna", required=true)
postal = TextField("Postal code", $/address/postalCode, placeholder="1010", required=true)
locality = Row([Column([city], weight=2, minWidth="160px"), Column([postal], weight=1, minWidth="120px")], wrap="wrap")
country = Select("Country", [{value: "AT", label: "Austria"}, {value: "DE", label: "Germany"}, {value: "NL", label: "Netherlands"}], $/address/country, required=true)
notes = TextArea("Delivery instructions", $/notes, placeholder="Door code, safe place, or anything we should know…", rows=3)
consent = CheckBox("I have checked my delivery details", $/consent, required=true)
details = Column([Title("01 · Contact", size="lg"), names, email, Divider(), Title("02 · Delivery address", size="lg"), street, locality, country, notes, consent], weight=2, minWidth="260px", gap=4)
backpack = Column([Row([Text("Weekend backpack", fontWeight="semibold"), Text("$89 / item")], justify="spaceBetween"), Caption("Forest green · 20 L"), Slider("Backpack quantity", $/items/backpacks, 1, 5, step=1)], gap=2)
bottle = Column([Row([Text("Steel water bottle", fontWeight="semibold"), Text("$24 / item")], justify="spaceBetween"), Caption("Warm sand · 750 ml"), Slider("Bottle quantity", $/items/bottles, 0, 5, step=1)], gap=2)
delivery = RadioGroup("Delivery method", [{value: "standard", label: "Standard · free", description: "3–5 business days"}, {value: "express", label: "Express · $9", description: "1–2 business days"}], $/delivery, variant="cards")
gift = CheckBox("Add gift wrapping · $5", $/gift)
promo = TextField("Promo code", $/promo, placeholder="Try SAVE10")
total = Row([Text("Total", fontWeight="semibold"), Title(${orderTotal}, size="xl")], justify="spaceBetween", align="center")
submit = Button("Preview my order →", submit=true, variant="primary", block=true, checks=[{condition: required(value=$/customer/firstName), message: "First name is required."}, {condition: email(value=$/customer/email), message: "A valid email is required."}, {condition: required(value=$/address/street), message: "Street address is required."}, {condition: required(value=$/address/city), message: "City is required."}, {condition: required(value=$/address/postalCode), message: "Postal code is required."}, {condition: $/consent, message: "Check your delivery details."}])
order = Column([Title("03 · Your order", size="lg"), backpack, bottle, Divider(), delivery, gift, promo, Divider(), total, Caption("SAVE10 takes 10% off products. Delivery and gift wrap are added afterwards.", size="sm"), submit, Caption("Demo checkout · preview only", size="sm", textAlign="center")], weight=1, minWidth="260px", padding=4, background="#eef5ef", radius="lg", gap=4)
checkout = Form([Row([details, order], wrap="wrap", align="start", gap=6)], Event("demo_checkout", {customer: $/customer, address: $/address, items: $/items, delivery: $/delivery, gift: $/gift, promo: $/promo, notes: $/notes}), label="Shopping checkout")
root = Card([Row([Caption("FIELDNOTES / THE WEEKEND EDIT"), Badge("Interactive checkout")], justify="spaceBetween", wrap="wrap"), Title("Make room for your next adventure.", size="2xl", color="#173b32"), Caption("Change quantities, delivery, or gift options. Your total updates immediately."), Divider(), checkout, Divider(), Text($/status, color="#173b32", fontWeight="semibold")], variant="outline", size="lg", gap=4)`,
  project: `$/person = {name: "", email: "", company: "", role: "designer"}
$/project = {startDate: "", budget: 2500, contact: "email", notes: ""}
$/newsletter = false
$/consent = false
$/status = "Your saved brief will appear here."
name = TextField("Full name", $/person/name, placeholder="Alex Morgan", required=true, checks=[{condition: required(value=$/person/name), message: "Tell us your name."}])
email = TextField("Work email", $/person/email, variant="email", placeholder="alex@studio.com", required=true, checks=[{condition: email(value=$/person/email), message: "Use a valid email address."}])
company = TextField("Company or team", $/person/company, placeholder="Northstar Studio")
role = Select("Your role", [{value: "designer", label: "Designer"}, {value: "engineer", label: "Engineer"}, {value: "founder", label: "Founder"}, {value: "product", label: "Product manager"}], $/person/role)
identity = Column([Title("01 · About you", size="lg"), name, email, company, role], weight=1, minWidth="250px", gap=4)
date = DateTimeInput("Ideal start date", $/project/startDate, required=true)
budget = Slider("Project budget", $/project/budget, 500, 10000, step=500, unit="USD")
budgetLabel = Row([Caption("Current budget"), Text(formatCurrency(value=$/project/budget, currency="USD"), fontWeight="semibold")], justify="spaceBetween")
contact = RadioGroup("Preferred contact", [{value: "email", label: "Email"}, {value: "call", label: "Schedule a call"}], $/project/contact, variant="pills", direction="row")
notes = TextArea("What would you like to build?", $/project/notes, placeholder="Goals, audience, and the problem you want to solve…", rows=4, required=true)
scope = Column([Title("02 · The project", size="lg"), date, budget, budgetLabel, contact, notes], weight=1, minWidth="250px", gap=4)
newsletter = CheckBox("Send me occasional product updates", $/newsletter)
consent = CheckBox("I agree to be contacted about this brief", $/consent, required=true)
submit = Button("Save my project brief →", submit=true, variant="primary", block=true, checks=[{condition: required(value=$/person/name), message: "Name is required."}, {condition: email(value=$/person/email), message: "A valid email is required."}, {condition: required(value=$/project/startDate), message: "Choose a start date."}, {condition: required(value=$/project/notes), message: "Describe your project."}, {condition: $/consent, message: "Please agree to be contacted."}])
form = Form([Row([identity, scope], wrap="wrap", align="start", gap=6), Divider(), newsletter, consent, submit], Event("demo_project", {person: $/person, project: $/project, newsletter: $/newsletter}), label="Project brief")
root = Card([Row([Caption("NORTHSTAR / LET'S BUILD SOMETHING"), Badge("Project brief")], justify="spaceBetween", wrap="wrap"), Title("Your next idea starts here.", size="2xl", color="#173b32"), Caption("A complete form with validation, a date picker, live budget, choices, and notes."), Divider(), form, Text($/status, fontWeight="semibold", color="#173b32"), Caption("Demo submission · saved in this browser session only", size="sm")], variant="outline", size="lg", gap=4)`,
};
