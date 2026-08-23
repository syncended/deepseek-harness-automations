# Architecture

## Goals

The MVP must solve deployment-level scheduling without coupling future automation semantics to cron. A schedule decides **when to admit a run**; an executor decides **how that run progresses**.

Non-goals for the first release:

- distributed/multi-host workers;
- exactly-once external effects;
- calendar syntax beyond standard five-field cron;
- arbitrary untrusted code execution;
- automatic retry of a run that may already have produced side effects.

## Components

```text
Sidebar / Settings UI / HTTP API
          │
          ▼
 AutomationService ─── ProjectPolicy
          │
          ├── AutomationStateStore (atomic JSON, occurrence index)
          │
          └── AutomationScheduler
                 │
                 └── ExecutorRegistry
                        └── HarnessAgentExecutor (MVP)
```

### Browser surfaces

The same automation page is available through two additive DSH extension points: `settings.section` keeps the configuration page inside Settings, while `sidebar.footer.action` opens a frame-wide `shell.overlay`. A small client-only disclosure store coordinates the sidebar trigger and overlay; neither surface owns scheduler state, and both read the same package HTTP API.

Interactive chrome uses the ambient `@deepseek-ai/dsh-client-ui-primitives` `Button`, `Menu`, and icon components. Package CSS is limited to the automation-specific layout and composes only public DSH semantic tokens, so theme, menu, focus, and button behavior stay aligned with the host UI.

### AutomationService

Cordis service `ctx.automations`. It owns input validation, canonical project authorization, metadata discovery, the Web route, and the public executor-registration seam.

### AutomationStateStore

The store owns one versioned document:

- `jobs`: versioned user definitions plus the durable `nextRunAt` watermark;
- `runs`: orchestration state and immutable execution snapshots;
- `runOrder`: stable history ordering;
- `occurrences`: idempotency key → run id.

Every writer mutation:

1. acquires the DSH cross-process file lock;
2. re-reads and validates the latest complete document;
3. mutates one detached state;
4. atomically renames a private `0600` replacement;
5. publishes the committed state in memory.

The current startup recovery assumes one active scheduler host. The short mutation lock prevents duplicate admission, but a second live host would incorrectly treat the first host's running records as crash orphans. Multi-host support therefore requires leases before it can be advertised.

### AutomationScheduler

The scheduler has four responsibilities only:

1. derive and arm the earliest wall-clock wakeup;
2. atomically claim due cron/manual occurrences;
3. apply misfire and overlap policy;
4. dispatch queued runs through the executor registry under a global concurrency bound.

It never knows how an Agent, workflow, or code task works.

### HarnessAgentExecutor

The `agent` executor:

1. re-authorizes the canonical project;
2. resolves the job's agent and permission presets;
3. resolves the current default model or the pinned provider/model route;
4. creates a fresh Session and Agent through `ctx.agents.create`;
5. composes the preset in the unpublished setup transaction;
6. installs model selection and the permission preset;
7. submits the prompt as a plugin-origin user message;
8. waits for quiescence, flushes Session persistence, and folds the terminal result;
9. disposes the live handle while retaining persisted Session history.

No nested `dsh` process is required, and the normal DSH tool, sandbox, approval, persistence, and model routing layers remain authoritative.

## State machine

```text
                         host crash
                    ┌────────────────► interrupted
                    │
queued ───────────► running ──────────► succeeded
  │                  │  │
  │                  │  ├────────────► failed
  │                  │  ├────────────► timed-out
  │                  │  └────────────► cancelled
  ├──────────────────────────────────► cancelled
  └──────────────────────────────────► skipped
```

Terminal states never transition. `running` is committed before executor work begins. A crash in the narrow interval after that commit but before the first effect may lose work; retrying automatically would create the more dangerous inverse window—duplicating an effect that completed before the crash.

## Admission and idempotency

A cron key is:

```text
<job-id>:cron:<scheduled-for-utc>
```

A manual key uses a random UUID. The occurrence index and the scheduler watermark are written together. Missed cron history is latest-only:

- `skip`: record the overdue occurrence as skipped and advance past `now`;
- `run-once`: select the latest due occurrence, admit one run, and advance past `now`.

There is no backlog explosion after a long shutdown.

## Why runs pin a full job snapshot

A queued run must not change when a user edits or deletes its source job. The snapshot pins:

- job id/version and name;
- schedule/policy values used at admission;
- prompt and execution settings;
- project/model/preset/permission/timeout values.

Deleting a job marks its still-queued runs skipped; already-running work drains against its snapshot.

## Path to durable multi-agent automations

Cron remains one trigger feeding the same `Run` aggregate. The next layers are additive.

### Stage 2: workflow executor

Add `task.kind = "workflow"` and an executor backed by `ctx.workflowEngine`:

- code/meta/args are pinned in the run snapshot;
- workflow progress is mirrored into durable run events;
- child Session ids are retained as run artifacts;
- host cancellation terminates the workflow worker and children.

The existing Harness workflow worker is execution isolation from the event loop, **not** a security sandbox.

### Stage 3: durable task graph

Introduce a graph below one run:

```text
Run
 ├── Task A (code/action)
 ├── Task B (agent) dependsOn A
 ├── Task C (agent) dependsOn A
 └── Task D (reduce) dependsOn B,C
```

Each task needs:

- stable `taskId` and definition version;
- dependency edges;
- `pending | ready | leased | running | retry-wait | terminal` state;
- attempt number and idempotency key;
- lease owner, expiry, and heartbeat;
- retry policy with deterministic next-at time;
- input/output references, not unbounded inline blobs;
- child Session/workflow references;
- append-only transition events.

A projector derives runnable tasks. Workers atomically acquire leases. Expired leases become recoverable according to each task's declared effect semantics:

- `pure` / idempotent tasks may retry automatically;
- `effectful` tasks require an external idempotency key or operator decision;
- Agent tasks default to effectful because tools may change files or remote systems.

### Stage 4: multi-host storage

Replace the JSON document with SQLite (single machine) or a transactional database (multi-host), while keeping the service and executor contracts:

- unique occurrence constraint;
- compare-and-swap job versions;
- transactional task lease acquisition;
- append-only run/task events plus projections;
- artifact storage and retention;
- metrics, dead-letter/operator recovery, and audit export.

## Extension contract

`ctx.automations.registerExecutor(executor)` is intentionally small:

```ts
interface AutomationExecutor {
  readonly kind: string
  execute(context: {
    run: AutomationRun
    signal: AbortSignal
    attachSession(sessionId: string): Promise<void>
  }): Promise<{ sessionId?: string; output?: string }>
}
```

Future executor-specific config should become a discriminated `task` schema. Cron admission, overlap/misfire behavior, run ordering, and the Web run-history surface remain shared.
