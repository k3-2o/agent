---
name: composio
description: "Use the composio Python SDK directly from the repl workspace to reach 1000+ app integrations (Gmail, Slack, GitHub, Google Drive, Notion, etc.). Search the tool catalog, fetch full schemas, execute app actions, upload files via the S3 presign dance, and authorize new apps via OAuth. Use when a task needs a real app action (send email, post to Slack, create a doc, query GitHub, push to Drive)"
compatibility: "Requires the composio SDK in the repl venv (~/.pi/agent/pi-repl/venv) and apiKey+userId in ~/.config/pi-composio/config.json."
---

# Composio

One SDK, 1000+ app integrations. 4 stages, fixed order; only query/slug/args vary.

## Decoder

Always read [references/field-map.md](references/field-map.md) FIRST, before any stage: it is the
measured spec this skill runs on. Response shapes, raw vs core sizes, the fields worth
keeping. Responses run lean by default; the shapes above keep them that way.

## Rails

    1. Bootstrap -> session `s`
    2. Search    -> slug + connection
    3. Schema    -> real arg names (when input_schema None)
    4. Execute   -> run, trim

## 1. Bootstrap

```python
import json, os
from composio import Composio

cfg = json.load(open(os.path.expanduser("~/.config/pi-composio/config.json")))
c = Composio(api_key=cfg["apiKey"])              # client: auth only, NO actions
s = c.sessions.create(user_id=cfg["userId"])     # NEW session each time: cheap handle;
                                                 # connections live on the user, never lost
```

Never print `apiKey`. Wrong `userId` = sessions that see zero connections.

## 2. Search

```python
res = s.search(query="upload file to google drive")   # query is the blank
d = res.tool_schemas        # {slug: ToolSchemas model}; models, never .get()
for slug, obj in d.items():
    print(slug, "| full:", obj.has_full_schema, "|", (obj.description or "")[:70])
print({t.toolkit.upper(): t.has_active_connection for t in res.toolkit_connection_statuses})
```

`input_schema` often None: search returns summaries, not a bug. Not connected -> `s.authorize`.

## 3. Schema

```python
if obj.input_schema is None:
    meta = s.execute("COMPOSIO_GET_TOOL_SCHEMAS",
                     arguments={"tool_slugs": ["GOOGLEDRIVE_CREATE_FOLDER"]})
    schema = meta.model_dump()["data"]["tool_schemas"]["GOOGLEDRIVE_CREATE_FOLDER"]["input_schema"]
```

Any slug, any toolkit; Drive is the worked example. Never guess args; schema first.

## 4. Execute

```python
resp = s.execute("SLUG_HERE", arguments={...from schema...})
data = resp.data        # assign first; payload fields are per app, slice before print
print(keep_only_the_useful_fields)
```

Inspect one item's keys, keep the small useful ones. Gmail: drop `messageText`/`payload`
(HTML, 26/40KB), keep `preview`.

## Uploads: presign dance

No local paths; file args take `{name, mimetype, s3key}`. Blanks: `tool_slug` +
`toolkit_slug`, file arg name, destination arg (the schema has them).

```python
import hashlib, pathlib, httpx
from composio_client import Composio as RawClient

raw = RawClient(api_key=cfg["apiKey"])
data = pathlib.Path("/local/file.md").read_bytes()
pu = raw.files.create_presigned_url(
        filename="file.md", md5=hashlib.md5(data).hexdigest(), mimetype="text/markdown",
        tool_slug="GOOGLEDRIVE_UPLOAD_FILE", toolkit_slug="googledrive")
httpx.put(pu.new_presigned_url, content=data, timeout=60).raise_for_status()
resp = s.execute("GOOGLEDRIVE_UPLOAD_FILE", arguments={
        "file_to_upload": {"name": "file.md", "mimetype": "text/markdown", "s3key": pu.key},
        "folder_to_upload_to": FOLDER_ID})
print(resp.data)
```

## Authorize

`"No active connection found for toolkit(s) 'X'"` = not connected, not a failure.

```python
req = s.authorize("slack")
print(req.redirect_url)     # user opens, confirms, retry
```

## Errors

| Error | Fix |
|---|---|
| `'ToolSchemas' object has no attribute 'get'` | pydantic models: attribute access, `.model_dump()` |
| `'ToolSchemasSchemaRef' object has no attribute 'get'` | `.schema_ref.args` |
| `input_schema` None | stage 3 meta tool |
| `No active connection found for 'X'` | `s.authorize("x")` |
| sessions see no connections | wrong `userId` in config |
| upload wants `s3key` | presign dance |
| 401 / dead session | recheck `config.json`, redacted |

Report real errors; never fake success, never blind retry.

## Clients

`composio.Composio`: sessions/search/execute/authorize, no `.files`.
`composio_client.Composio`: raw REST, `.files.create_presigned_url` (presign only).
No wrapper class. Venv: `~/.pi/agent/pi-repl/venv`.
