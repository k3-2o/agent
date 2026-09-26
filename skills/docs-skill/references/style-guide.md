# Style Reference

## Voice and Tone

| Document Type | Voice | Examples |
|---|---|---|
| Tutorial | Encouraging, patient | "Let's create your first project." |
| How-to Guide | Direct, authoritative | "To reset your password, visit the settings page." |
| Reference | Neutral, precise | "Returns an integer between 0 and 255." |
| Explanation | Reflective, thorough | "The decision to use event sourcing was motivated by..." |
| README | Welcoming, concise | "A fast HTTP client for Python." |
| Changelog | Factual, past tense | "Fixed crash when input is empty. (#142)" |
| ADR | Declarative, present tense | "We choose PostgreSQL for primary storage." |

## Word Choices

### Prefer These

| Instead of | Use |
|---|---|
| utilize, leverage | use |
| in order to | to |
| a number of | several, or the actual count |
| at the present time | now |
| in the event of | if |
| for the purpose of | delete it |
| with regard to | about, for |
| is able to | can |
| has the capability to | can |
| prior to | before |
| subsequent to | after |
| facilitate | help, enable |
| implement | build, create, add (depending on context) |
| aforementioned | this, that, the |

### Avoid These

- **Simply, just, easily**: They invalidate the reader's experience when something is hard.
- **Obviously, clearly, of course**: If it were obvious, the reader wouldn't need docs.
- **Note that, it's worth noting that**: Just state the fact. Don't preface it.
- **Basically, essentially**: They hedge. Be direct.
- **Please**: In commands, it's noise. "Please run the following" → "Run the following".

## Formatting Conventions

### Headings

- Use sentence case for headings: "How to configure the database" (not "How to Configure the Database")
- Keep headings under 60 characters
- Headings should be descriptive: "Authentication" → good; "Details" → bad
- Avoid stacking headings (a heading immediately after a heading with no text between)

### Lists

- Capitalize the first word of each list item
- If items are complete sentences, end with periods
- If items are fragments or code terms, omit periods
- Parallel structure: if one item starts with a verb, all should

### Code Blocks

- Always specify the language for syntax highlighting: ```` ```python ````
- Use ```` ```bash ```` for shell commands, not ```` ```sh ````
- Commands should be copy-paste friendly (no `$` prompt prefix unless documenting the prompt itself)
- Show output separately from the command:
  ````
  ```bash
  echo "hello"
  ```
  ```
  hello
  ```
  ````

### UI Elements

- Bold for buttons, menus, and labels: "Click **Save**."
- Italic for modes, states: "The file is now in *read-only* mode."
- Code backticks for filenames, paths, and commands: "Edit `config.json`."

### Links

- Use descriptive link text: "See the [authentication guide](./auth.md)" not "Click here."
- Never "here" or "this page" or "link" as link text
- Check relative paths work. Prefer relative links within a docs site.

## Cross-Referencing

When linking between documentation types within the same project:

| From | To | Phrasing |
|---|---|---|
| README | Tutorial | "New to the project? Start with the [quickstart tutorial](../tutorials/quickstart.md)." |
| Tutorial | Reference | "For a full list of options, see the [API reference](../reference/api.md)." |
| How-to | Explanation | "To understand why this works, read [How caching works](../explanation/caching.md)." |
| Explanation | How-to | "Ready to implement caching? Follow the [caching guide](../how-to/caching.md)." |
| ADR | Explanation | "See [ADR-003](../adr/ADR-003.md) for the full decision context." |

Remember: **reference direction goes from volatile to stable.** A tutorial (volatile) can link to an architecture doc (stable), but the architecture doc should not link to code that may change.

## Inclusive Language

- Use gender-neutral pronouns: "they/them" or restructure to avoid pronouns
- Use culturally neutral names in examples: `alex@example.com`, not `john@example.com`
- Avoid idioms and metaphors tied to specific cultures ("ballpark figure", "slam dunk", "table this")
- Use "allowlist/blocklist" instead of "whitelist/blacklist"
- Use "primary/replica" instead of "master/slave"
- Use "source/target" or "upstream/downstream" where appropriate
- Avoid ableist language ("crippled", "blind to", "dumb")
- When writing for international audiences, keep sentences short and vocabulary simple

## Writing for Translation

If your documentation will be machine-translated:

- Use short sentences (\<25 words)
- Avoid idioms and humor
- Use consistent terminology (don't use "start" in one place and "begin" in another)
- Write out acronyms on first use
- Use articles ("the", "a") consistently, they help translation engines parse structure
- Avoid phrasal verbs ("set up", "tear down") where a single verb works ("configure", "destroy")

## Structure

- Inverted pyramid: title says what the page is, first paragraph says what the reader gets, body in order of importance
- One idea per paragraph
- Descriptive headings ("How authentication works", never "Overview")
- Numbered lists for sequential steps, bullets for non-sequential items
- Realistic example values (`user@example.com`, not `foo@bar`); example code runs; show output alongside
