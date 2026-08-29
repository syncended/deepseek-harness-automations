# Security model

## Trust boundary

This plugin is intended for the same trusted operator boundary as a local DeepSeek Harness Web deployment. It does not add authentication to `dsh-host-webserver`. If the Harness binds to `0.0.0.0`, anyone who can reach that surface may also be able to manage automations; place the deployment behind an appropriate authenticated boundary before exposing it.

## Management API

Mutation requests must:

- use `application/json`;
- send `X-DSH-Automation-Client: 1`;
- originate from the same browser origin when Fetch Metadata / Origin headers are present.

The custom header forces a cross-origin browser request through CORS preflight, which the route does not grant. This is a CSRF fence, not user authentication.

## Filesystem authority

A job's workspace path is canonicalized with `realpath` before storage. `workspace-write` uses that Session cwd as its DSH sandbox root. `allowedProjectRoots`, when configured, are canonicalized and checked with path-segment containment rather than string prefixes.

The executor repeats authorization at dispatch, catching deleted paths and symlink retargeting after configuration.

## Permission presets

The job selects an existing DSH permission preset rather than independently inventing sandbox and approval values. The standard presets are:

- `read-only`: no file mutation; approval remains fail-closed;
- `workspace-write`: writes only under the Session workspace; widening requires approval;
- `danger-full-access`: unrestricted file effects and no approval prompts.

Scheduled Agents are not attached to an interactive browser ownership chain. A policy that needs a human prompt should therefore be expected to reject the operation or leave it unavailable when nobody can answer. Jobs should be designed for deterministic unattended behavior and should normally use `read-only` or `workspace-write`.

## Secrets and persisted data

`state.json` contains job prompts, workspace paths, model/preset selections, run metadata, and bounded final assistant text. It is atomically replaced with mode `0600`; parent directories created by the plugin use `0700`. Session transcripts are persisted by the configured Harness Session backend and may contain substantially more data.

Do not put API keys directly in prompts. Use normal Harness credential providers and environment policy.

## Crash semantics

The store guarantees complete-file replacement, not fsync durability. After a host restart:

- `queued` runs are eligible to dispatch;
- `running` runs become `interrupted`;
- interrupted runs are not retried automatically.

This avoids silently repeating side effects but does not provide exactly-once execution. Occurrence keys are internal orchestration metadata and are not injected into the agent prompt. Tasks that call external systems should define and carry their own stable idempotency key whenever the target supports one.

## Code and future workflows

The MVP accepts prompt text, not arbitrary executable automation code. A future workflow executor may use the Harness workflow worker, whose worker thread protects host event-loop liveness but is explicitly not a security sandbox. Hostile code requires a separate process/container/VM boundary with a narrow capability protocol.
