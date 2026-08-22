# DeepSeek Harness Automations

A DeepSeek Harness plugin for durable, configurable cron jobs. Each occurrence starts a fresh persisted Harness Agent in a selected project with an explicit model route, agent preset, and permission preset.

> **Status:** MVP for `@deepseek-ai/dsh` `0.1.1-rc.2`. The current worker is single-host. Cron admission and run history are durable; an already-started run is deliberately **not** retried after a host crash.

## What works

- Standard five-field cron expressions with `UTC` or IANA timezones.
- Per-job project directory, provider/model, reasoning effort, agent preset, permission preset, and timeout.
- Enable/disable, Run now, edit, delete, cancel, and recent run history from the main **Automations** sidebar action or **Settings → Automations**.
- Overlap policies:
  - `skip` — record and skip an occurrence while the job has queued/running work.
  - `queue` — serialize occurrences for the same job.
  - `allow` — permit concurrent occurrences, bounded by the global concurrency limit.
- Misfire policies:
  - `skip` — record an overdue occurrence as skipped.
  - `run-once` — coalesce missed occurrences to the latest due time.
- Atomic owner-private state under `$DSH_HOME/automations/state.json` by default.
- Immutable execution snapshots and occurrence keys for replay-safe admission.
- Extensible executor registry: the MVP ships `agent`; future `workflow` and task-graph executors do not need scheduler changes.

The in-box `@deepseek-ai/dsh-schedule` plugin remains the right tool for reminders attached to one live Session. This plugin owns deployment-level jobs that can start a fresh project Session while no chat is open.

## Install

Requirements: Node.js 22+ and a working `dsh web` profile.

From npm:

```bash
dsh plugin --profile web add @syncended/dsh-automations
```

Or from this checkout:

```bash
pnpm install
pnpm check
pnpm build

dsh plugin --profile web add .
```

The package declares a DSH bundle, so `dsh plugin` appends it to the Web profile automatically. Restart the running Web Harness after the initial install, then refresh the page. Open **Automations** from the main sidebar, or use **Settings → Automations**.

To remove it:

```bash
dsh plugin --profile web remove @syncended/dsh-automations
```

## Configure a job

| Field | Meaning |
|---|---|
| Name | Human-readable job name. |
| Cron | Five fields: `minute hour day-of-month month day-of-week`. Example: `0 9 * * 1-5`. |
| Timezone | `UTC` or an IANA name such as `Europe/Berlin`. DST is handled by `cron-parser`. |
| Project | Existing absolute directory. Its canonical filesystem identity becomes the Session cwd and `workspace-write` root. |
| Prompt | The user message sent to a fresh Harness Agent. |
| Provider / model | Leave both blank to resolve the current Harness default at dispatch time. Set both to pin a route. |
| Reasoning effort | Optional adapter-owned value. |
| Agent preset | Leave blank for the current Harness default, or select a specific composition. |
| Permission preset | Bundles DSH sandbox and approval policies. Default: `workspace-write`. |
| Timeout | Wall-clock run limit. Cancellation is cooperative through the Agent loop. |
| Overlap / misfire | Admission behavior described above. |

A disabled job may still be started with **Run now**.

## Plugin configuration

Defaults are suitable for a local Web profile. Override the bundle row in the profile's `cordis.patch.yml` when needed:

```yaml
- id: automations
  config:
    maxConcurrentRuns: 2
    historyLimit: 1000
    misfireGraceMs: 60000
    maxOutputChars: 65536
    allowedProjectRoots:
      - /home/me/projects
    # Optional; otherwise $DSH_HOME/automations/state.json
    # statePath: /absolute/private/path/state.json
```

`allowedProjectRoots: []` means the plugin accepts any existing directory the Harness host account can resolve. Configure one or more roots when the Web surface is exposed beyond a trusted local machine.

## Durable semantics

1. The scheduler claims an occurrence and advances its durable `nextRunAt` watermark in the **same atomic state mutation**.
2. The admitted run pins the complete job version and gets a unique occurrence key.
3. `queued` runs are dispatched after restart.
4. A run is marked `running` before any Agent work starts.
5. On restart, orphaned `running` records become `interrupted` and are not retried automatically, avoiding silent duplicate file/network effects.
6. Harness Session persistence remains the source of truth for the Agent transcript; the automation state stores orchestration metadata and a bounded final-text summary.

This is not exactly-once execution. Exactly-once external side effects require idempotency in the task itself or in the target system.

## Security

- State files are replaced atomically with mode `0600`; created directories use `0700`.
- Project paths are resolved through `realpath`; optional allowed roots are checked against that canonical identity.
- Background work uses a normal DSH permission preset. `workspace-write` cannot silently widen itself; unattended approval failures remain fail-closed.
- `danger-full-access` is intentionally available only when the job author selects a configured preset that grants it.
- The management API requires JSON plus a custom same-origin mutation header. It inherits the trust boundary of the DSH Web server, which has no standalone authentication layer.
- Prompts, run metadata, final summaries, and Session transcripts are local sensitive data.

See [`docs/security.md`](docs/security.md) for the threat model.

## Development

```bash
pnpm typecheck
pnpm test
pnpm check
```

The Host plugin is TypeScript in `src/`. The browser half is deliberately plain JavaScript in `lib/client.js`, matching the external DSH Client Plugin loader format and avoiding a dependency on monorepo-only frontend build tooling.

## Architecture and roadmap

See [`docs/architecture.md`](docs/architecture.md). In short, cron is only a trigger. Durable runs call an executor selected by `task.kind`; the next implementation stage adds a `workflow` executor over `ctx.workflowEngine`, followed by a persisted task graph with leases, retries, child-agent references, and resumable code steps.

## License

MIT
