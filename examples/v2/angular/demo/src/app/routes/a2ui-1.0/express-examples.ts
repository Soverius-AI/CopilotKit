/** Few-shot teaching context only; never executed as a demo response. */
export const EXPRESS_EXAMPLES = {
  card: `heading = Title("Weather in Vienna", size="xl", color="#173b32")
root = Card([heading, Text("18°C and clear skies"), Badge("Sunny", color="success")], variant="outline", gap=4)`,
  form: `$/name = ""
$/status = "Ready to submit"
heading = Title("Plan your next adventure")
name = TextField("Your name", $/name, placeholder="Alex")
status = Text($/status)
submit = Button("Create my itinerary", Event("plan_trip", {name: $/name}))
root = Card([heading, name, status, submit])`,
};
