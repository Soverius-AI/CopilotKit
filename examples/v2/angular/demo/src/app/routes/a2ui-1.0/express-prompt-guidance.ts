/** Small language lessons, supplied through the SDK's catalog example option.
 * These are model context, never responses rendered or replayed by the app. */
export const EXPRESS_PROMPT_EXAMPLES = [
  {
    title: "A small informational card (new view)",
    source: `heading = Title("Notice")
body = Text(text="Your changes are saved.")
root = Card(children=[heading, body], gap=3)`,
  },
  {
    title: "One editable value and a submit event (new view)",
    source: `$/note = ""
heading = Title("Quick note")
note = TextField("Note", $/note)
save = Button("Review", submit=true)
form = Form(children=[note, save], onSubmit=Event("review_note", {note: $/note}))
root = Card(children=[heading, form])`,
  },
  {
    title:
      'A follow-up to the preceding form: submitted note is "Remember the keys.", actual surface id is view-1',
    source: `surface("view-1", update=true)
review_heading = Title("Review")
review_note = Text(text="Note: Remember the keys.")
summary = Card(children=[review_heading, review_note])
root = Card(children=[heading, form, summary])`,
  },
] as const;

export const EXPRESS_GENERATION_GUIDANCE = `## Reliable generation and follow-up updates

Use the catalog signatures above exactly, including argument order and value types. Component names and properties are case-sensitive. Every component name assigned in a block must be unique.

Match the requested interaction. An informational card uses display components inside Card, with no editable controls, Form or Event. A request for editable inputs uses a Form with its fields and submit Button. The first example is display-only; the second and third teach a form and its follow-up.

Define named components on their own lines before root. Inside a children array, list their names separated by commas. Assignments belong outside arrays. Prefer explicit named arguments for text and child lists: root = Card(children=[heading, body], gap=3).

A children argument is an array of component names or inline component constructors. An Event is not a child list. Form takes children first and onSubmit second: Form([field, submit], Event("save", {value: $/value})). The equivalent named arguments are children=[field, submit] and onSubmit=Event("save", {value: $/value}). Keep the submit=true Button inside that Form.

Treat follow-ups as small patches. Target the existing surface id supplied in the current request with surface(id, update=true). Existing component ids can be referenced without defining them again. To add a summary, define only the new summary and update the existing root's children to include it. Preserve the original root type, its properties and all existing children. Do not redefine an unchanged Form, its fields or its Event; reference the existing Form id. Keep the user's data paths unchanged unless the user explicitly asks to change a value. For a new view, omit surface(...): the host allocates its id.

A data path outside quotes, such as $/note, is a binding. Ordinary quoted strings do not interpolate $/paths. After a submit, show each label and its actual submitted value together inside one quoted string, as the last example does. Use Text(text="complete label and value") with a single text argument. Text's next positional argument is children, not another text fragment or value. All characters of the label and value go inside the same string; put it directly in text=, rather than defining a temporary string variable. String concatenation with + is not Express. For text that must stay bound as inputs change, use Text(text=formatString("Note: \${/note}")). Use only catalog function calls for dynamic text; JavaScript expressions are unsupported. Events carry the real bound values; never replace them with example values.

Use the current request and submitted data for all labels, facts, values and surface ids. The three examples below teach syntax only; their content is not a requested interface. The last example references heading and form already created by the preceding example; it does not rebuild or clear the form. Put <a2ui> and </a2ui> on their own lines around each generated block, without Markdown fences.`;

export const EXPRESS_PROMPT_LESSONS = [
  EXPRESS_GENERATION_GUIDANCE,
  ...EXPRESS_PROMPT_EXAMPLES.map(
    ({ title, source }) => `### ${title}\n<a2ui>\n${source}\n</a2ui>`,
  ),
].join("\n\n");
