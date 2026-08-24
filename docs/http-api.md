# HTTP API

The browser plugin uses a small package-owned API under `/api/automations`. Responses are JSON with `Cache-Control: no-store`.

Mutations require:

```http
Content-Type: application/json
X-DSH-Automation-Client: 1
```

## Read

- `GET /api/automations?limit=100` — jobs and newest-first run history.
- `GET /api/automations/sessions?revision=N` — durable automation-created session ids used by history badges; unchanged revisions return no repeated id list.
- `GET /api/automations/meta` — current model directory, permission presets, and agent presets.

## Jobs

- `POST /api/automations/jobs` — `{ "id"?: string, "spec": JobSpec }`.
- `PUT /api/automations/jobs/:id` — `{ "expectedVersion"?: number, "spec": JobSpec }`.
- `DELETE /api/automations/jobs/:id` — `{}`.
- `POST /api/automations/jobs/:id/run` — `{}`.
- `POST /api/automations/jobs/:id/enabled` — `{ "enabled": boolean, "expectedVersion"?: number }`.

## Runs

- `POST /api/automations/runs/:id/cancel` — `{ "reason"?: string }`.

Updates use optimistic job versions. A stale `expectedVersion` returns HTTP 409 with error code `VERSION_CONFLICT`.

Error shape:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "..."
  }
}
```
