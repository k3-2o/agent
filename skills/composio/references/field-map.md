# Composio response map (measured against composio 0.19.0)

Everything comes back as a **pydantic model** (`.field` access or `.model_dump()`), NOT raw JSON.
Read fields off the object directly; use `model_dump()` only when you need a plain dict.

## search(query) -> SessionSearchResponse  (~21KB raw)

Top-level fields:

| field | what | keep? |
|---|---|---|
| `tool_schemas` | dict `{slug: ToolSchemas}` — the tools found | keep slug + toolkit + description; drop schema bodies here |
| `results` | list of `Result` | keep `primary_tool_slugs` only; drop the rest |
| `toolkit_connection_statuses` | list `{toolkit, has_active_connection, status_message, accounts}` | flatten to `{toolkit: needs_connection_bool}` |
| `success` | bool | keep (already lean) |
| `error` | str / None | keep (it's null on success) |
| `next_steps_guidance` | list[str] | drop |
| `time_info` | TimeInfo | drop |
| `session` | Session | drop (has `instructions` noise) |

Each `tool_schemas[slug]` (`ToolSchemas` model): `tool_slug`, `toolkit`, `description`,
`input_schema`, `output_schema`, `schema_ref`. Schema bodies (`input_schema`) belong to
stage 3 only — never print them here.

`toolkit_connection_statuses[*]`:
- `toolkit`: slug string (lowercase, e.g. "slack")
- `has_active_connection`: bool  <-- THE field that matters
- `status_message`: human text
- `connection_details.connected_account_id`, `current_user_info.emailAddress`
- `account_selection`: "required" when multi-account needs explicit pick

## schema: tool arguments — the 4.7KB -> 1.5KB trim

`schema` for a tool lives in `tool_schemas[slug].input_schema` = `{type, properties}` where
`properties[name]` is a dict with keys `[type, items, default, examples, description]`.

Per property, drop `examples` (multi-hundred-char arrays = the bulk):
- FULL per-property spec (with examples): ~4.7KB
- MINIMAL `{name, type, description[:120]}`: ~1.5KB  (~3x smaller)

Keep the top-level `required` list = mandatory arguments. A send-email tool runs ~10 props.

## execute -> SessionExecuteResponse: `{data, error, log_id}`

- `data`: dict, the real payload. Can be large (a list payload ran ~17KB) — **slice before reporting** (`.data[:5]` / `str(...)[:200]`).
- `error`: `None` on success, else a message string.
- `log_id`: audit receipt string. Drop unless debugging.

## session / persistence

- `session_id` attribute on a created session (`trs_...`), populated immediately.
- `sessions.use(session_id)` re-opens an existing session in a later process
  (api key + userId are baked in at create time; don't re-feed them).

## Multi-account (only if needed)

A user can hold multiple accounts on one app inside a session created
with `multi_account={"enable": True, "require_explicit_selection": bool}`.
- each account in `toolkit_connection_statuses[].accounts[]`: `{id: "ca_", is_default, alias}`
- `execute(..., account="alias_or_ca_id")` picks the account.
- Requires the `account` param when `require_explicit_selection=true`.
Default mode (no multi_account): one account per app per user, auto-picked. Skip this entirely unless you need it.

