window.__ModuleLoader__.load({
  id: "@syncended/dsh-automations",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // The full settings UI is registered by this browser entry. It is kept as
    // plain Client Plugin JavaScript so external package installs need no DSH
    // monorepo build tooling. The page talks to the automations service over
    // the same-origin HTTP API at /api/automations; every mutation carries the
    // x-dsh-automation-client fence header plus an application/json body.
    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;
    const inject = ["slots"];

    const API_PREFIX = "/api/automations";
    const POLL_MS = 5000;
    const HISTORY_SHOWN = 25;
    const DEFAULT_CRON = "0 9 * * 1-5";
    const DEFAULT_TIMEOUT_MS = 3600000;
    const MIN_TIMEOUT_MS = 1000;
    const MAX_TIMEOUT_MS = 86400000;
    const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

    const BROWSER_TIMEZONE = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        return "UTC";
      }
    })();

    const TIMEZONES = Array.from(
      new Set([
        BROWSER_TIMEZONE,
        "UTC",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "Europe/London",
        "Europe/Paris",
        "Europe/Berlin",
        "Asia/Shanghai",
        "Asia/Tokyo",
        "Asia/Singapore",
        "Asia/Kolkata",
        "Australia/Sydney",
      ]),
    );

    const REASONING_EFFORTS = ["low", "medium", "high"];
    const OVERLAP_OPTIONS = [
      { value: "skip", label: "skip", hint: "Skip the run if a previous run is still active." },
      { value: "queue", label: "queue", hint: "Defer the run until the previous run finishes." },
      { value: "allow", label: "allow", hint: "Run concurrently with any active run." },
    ];
    const MISFIRE_OPTIONS = [
      { value: "skip", label: "skip", hint: "Drop occurrences that were missed while the scheduler was down." },
      { value: "run-once", label: "run-once", hint: "Run once after downtime for the latest missed occurrence." },
    ];

    function errMessage(error) {
      return error instanceof Error ? error.message : String(error);
    }

    function browserTimezone() {
      return BROWSER_TIMEZONE;
    }

    // Mirrors the server-side slugifyJobId (validation.ts) so a freshly typed
    // name yields the same stable id the service would allocate itself.
    function slugifyJobId(name) {
      const slug = name
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
      return slug === "" ? "automation" : slug;
    }

    function formatDate(value) {
      if (!value) return "—";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      try {
        return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      } catch {
        return date.toLocaleString();
      }
    }

    function formatDuration(run) {
      const start = run.startedAt ? Date.parse(run.startedAt) : NaN;
      if (Number.isNaN(start)) return "";
      const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
      const seconds = Math.max(0, Math.round((end - start) / 1000));
      if (seconds < 60) return seconds + "s";
      const minutes = Math.floor(seconds / 60);
      const rest = seconds % 60;
      if (minutes < 60) return rest > 0 ? minutes + "m " + rest + "s" : minutes + "m";
      const hours = Math.floor(minutes / 60);
      return minutes % 60 > 0 ? hours + "h " + (minutes % 60) + "m" : hours + "h";
    }

    function formatTimeout(ms) {
      if (!Number.isFinite(ms)) return "";
      if (ms % 3600000 === 0) return ms / 3600000 + "h";
      if (ms % 60000 === 0) return ms / 60000 + "m";
      return Math.round(ms / 1000) + "s";
    }

    async function apiFetch(path, options = {}) {
      const headers = Object.assign(
        { "content-type": "application/json", "x-dsh-automation-client": "1" },
        options.headers,
      );
      let response;
      try {
        response = await fetch(API_PREFIX + path, Object.assign({}, options, { headers }));
      } catch (error) {
        throw new Error("Network error: " + errMessage(error));
      }
      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      if (!response.ok) {
        const message =
          body && body.error && typeof body.error.message === "string"
            ? body.error.message
            : "Request failed (" + response.status + ").";
        const error = new Error(message);
        error.status = response.status;
        error.code = body && body.error ? body.error.code : undefined;
        throw error;
      }
      return body;
    }

    function emptyDraft(meta) {
      const presets = meta && Array.isArray(meta.permissionPresets) ? meta.permissionPresets : [];
      const permissionPreset = presets.indexOf("workspace-write") !== -1
        ? "workspace-write"
        : presets.length > 0
          ? presets[0]
          : "workspace-write";
      return {
        id: "",
        name: "",
        enabled: true,
        cron: DEFAULT_CRON,
        timezone: browserTimezone(),
        prompt: "",
        cwd: "",
        provider: "",
        model: "",
        reasoningEffort: "",
        agentPreset: "",
        permissionPreset,
        timeoutMs: String(DEFAULT_TIMEOUT_MS),
        overlap: "skip",
        misfire: "run-once",
      };
    }

    function draftFromJob(job) {
      return {
        id: job.id,
        name: job.name,
        enabled: job.enabled,
        cron: job.schedule.cron,
        timezone: job.schedule.timezone,
        prompt: job.task.prompt,
        cwd: job.execution.cwd,
        provider: job.execution.provider || "",
        model: job.execution.model || "",
        reasoningEffort: job.execution.reasoningEffort || "",
        agentPreset: job.execution.agentPreset || "",
        permissionPreset: job.execution.permissionPreset,
        timeoutMs: String(job.execution.timeoutMs),
        overlap: job.policies.overlap,
        misfire: job.policies.misfire,
      };
    }

    function buildSpec(draft) {
      const execution = {
        cwd: draft.cwd.trim(),
        permissionPreset: draft.permissionPreset,
        timeoutMs: Number(draft.timeoutMs),
      };
      const provider = draft.provider.trim();
      if (provider !== "") {
        execution.provider = provider;
        execution.model = draft.model.trim();
      }
      const reasoningEffort = draft.reasoningEffort.trim();
      if (reasoningEffort !== "") execution.reasoningEffort = reasoningEffort;
      const agentPreset = draft.agentPreset.trim();
      if (agentPreset !== "") execution.agentPreset = agentPreset;
      return {
        name: draft.name.trim(),
        enabled: draft.enabled,
        schedule: { cron: draft.cron.trim(), timezone: draft.timezone.trim() },
        task: { kind: "agent", prompt: draft.prompt },
        execution,
        policies: { overlap: draft.overlap, misfire: draft.misfire },
      };
    }

    function Field(props) {
      const { label, htmlFor, required, hint, full, children } = props;
      return h(
        "div",
        { className: "dsh-auto-field" + (full ? " dsh-auto-field-full" : "") },
        h(
          "label",
          { className: "dsh-auto-label", htmlFor },
          label,
          required ? h("span", { className: "dsh-auto-required", "aria-hidden": "true" }, " *") : null,
        ),
        children,
        hint ? h("p", { className: "dsh-auto-hint" }, hint) : null,
      );
    }

    function StatusPill(props) {
      return h("span", { className: "dsh-auto-status dsh-auto-status-" + props.status }, props.status);
    }

    function JobForm(props) {
      const { meta, draft, editing, saving, error, onChange, onIdTouched, onSubmit, onCancel } = props;
      const providers = meta && Array.isArray(meta.providers) ? meta.providers : [];
      const providerModels = providers.find((provider) => provider.id === draft.provider);
      const models = providerModels ? providerModels.models : [];
      const permissionPresets =
        meta && Array.isArray(meta.permissionPresets) && meta.permissionPresets.length > 0
          ? meta.permissionPresets
          : ["workspace-write"];
      const agentPresets = meta && Array.isArray(meta.agentPresets) ? meta.agentPresets : [];
      const creating = editing === null;

      return h(
        "form",
        {
          className: "dsh-auto-form",
          onSubmit,
          noValidate: true,
          "aria-label": creating ? "New automation" : "Edit automation",
        },
        h("h3", null, creating ? "New automation" : "Edit \u201c" + editing.name + "\u201d"),
        h(
          "div",
          { className: "dsh-auto-formgrid" },
          h(
            Field,
            { label: "Name", htmlFor: "dsh-auto-f-name", required: true },
            h("input", {
              id: "dsh-auto-f-name",
              className: "dsh-auto-input",
              type: "text",
              value: draft.name,
              autoFocus: true,
              placeholder: "e.g. Morning standup notes",
              onChange: (event) => onChange("name", event.target.value),
            }),
          ),
          creating
            ? h(
                Field,
                { label: "Job id", htmlFor: "dsh-auto-f-id", hint: "Lowercase letters, digits and hyphens; auto-derived from the name. Leave blank to let the server generate one." },
                h("input", {
                  id: "dsh-auto-f-id",
                  className: "dsh-auto-input",
                  type: "text",
                  value: draft.id,
                  spellCheck: false,
                  placeholder: "auto",
                  onChange: (event) => {
                    onIdTouched();
                    onChange("id", event.target.value);
                  },
                }),
              )
            : h(
                Field,
                { label: "Job id", htmlFor: "dsh-auto-f-id", hint: "Fixed after creation." },
                h("input", {
                  id: "dsh-auto-f-id",
                  className: "dsh-auto-input",
                  type: "text",
                  value: draft.id,
                  disabled: true,
                  spellCheck: false,
                }),
              ),
          h(
            Field,
            { label: "Cron", htmlFor: "dsh-auto-f-cron", required: true, hint: "Five-field cron (minute hour day-of-month month day-of-week)." },
            h("input", {
              id: "dsh-auto-f-cron",
              className: "dsh-auto-input",
              type: "text",
              value: draft.cron,
              spellCheck: false,
              onChange: (event) => onChange("cron", event.target.value),
            }),
          ),
          h(
            Field,
            { label: "Timezone", htmlFor: "dsh-auto-f-timezone", required: true },
            h("input", {
              id: "dsh-auto-f-timezone",
              className: "dsh-auto-input",
              type: "text",
              list: "dsh-auto-tz-list",
              value: draft.timezone,
              spellCheck: false,
              onChange: (event) => onChange("timezone", event.target.value),
            }),
            h(
              "datalist",
              { id: "dsh-auto-tz-list" },
              TIMEZONES.map((zone) => h("option", { key: zone, value: zone })),
            ),
          ),
          h(
            Field,
            { label: "Enabled", htmlFor: "dsh-auto-f-enabled" },
            h(
              "label",
              { className: "dsh-auto-check" },
              h("input", {
                id: "dsh-auto-f-enabled",
                type: "checkbox",
                checked: draft.enabled,
                onChange: (event) => onChange("enabled", event.target.checked),
              }),
              h("span", null, "Schedule is active"),
            ),
          ),
          h(
            Field,
            { label: "Timeout (ms)", htmlFor: "dsh-auto-f-timeout", required: true, hint: "Wall-clock limit for each run (1s to 24h)." },
            h("input", {
              id: "dsh-auto-f-timeout",
              className: "dsh-auto-input",
              type: "number",
              min: MIN_TIMEOUT_MS,
              max: MAX_TIMEOUT_MS,
              step: 1000,
              value: draft.timeoutMs,
              onChange: (event) => onChange("timeoutMs", event.target.value),
            }),
          ),
          h(
            Field,
            { label: "Provider", htmlFor: "dsh-auto-f-provider", hint: "Blank uses the current Harness default. You may type an unlisted provider route." },
            h("input", {
              id: "dsh-auto-f-provider",
              className: "dsh-auto-input",
              type: "text",
              list: "dsh-auto-provider-list",
              value: draft.provider,
              spellCheck: false,
              placeholder: "Harness default",
              onChange: (event) => onChange("provider", event.target.value),
            }),
            h(
              "datalist",
              { id: "dsh-auto-provider-list" },
              providers.map((provider) => h("option", { key: provider.id, value: provider.id })),
            ),
          ),
          h(
            Field,
            {
              label: "Model",
              htmlFor: "dsh-auto-f-model",
              required: draft.provider !== "",
              hint: draft.provider === ""
                ? "Set a provider first, or leave both blank for the Harness default."
                : "Choose a discovered model or type an adapter-supported model id.",
            },
            h("input", {
              id: "dsh-auto-f-model",
              className: "dsh-auto-input",
              type: "text",
              list: "dsh-auto-model-list",
              value: draft.model,
              spellCheck: false,
              placeholder: draft.provider === "" ? "Harness default" : "Model id",
              disabled: draft.provider === "",
              onChange: (event) => onChange("model", event.target.value),
            }),
            h(
              "datalist",
              { id: "dsh-auto-model-list" },
              models.map((model) => h("option", { key: model, value: model })),
            ),
          ),
          h(
            Field,
            { label: "Reasoning effort", htmlFor: "dsh-auto-f-effort", hint: "Blank uses the provider default." },
            h("input", {
              id: "dsh-auto-f-effort",
              className: "dsh-auto-input",
              type: "text",
              list: "dsh-auto-effort-list",
              value: draft.reasoningEffort,
              spellCheck: false,
              placeholder: "e.g. medium",
              onChange: (event) => onChange("reasoningEffort", event.target.value),
            }),
            h(
              "datalist",
              { id: "dsh-auto-effort-list" },
              REASONING_EFFORTS.map((effort) => h("option", { key: effort, value: effort })),
            ),
          ),
          h(
            Field,
            { label: "Agent preset", htmlFor: "dsh-auto-f-preset", hint: "Blank uses the current Harness agent-preset default." },
            h(
              "select",
              {
                id: "dsh-auto-f-preset",
                className: "dsh-auto-select",
                value: draft.agentPreset,
                onChange: (event) => onChange("agentPreset", event.target.value),
              },
              h("option", { value: "" }, "Harness default"),
              agentPresets.map((preset) =>
                h(
                  "option",
                  { key: preset.id, value: preset.id },
                  preset.name + (preset.broken ? " (broken: " + preset.broken + ")" : ""),
                ),
              ),
            ),
          ),
          h(
            Field,
            { label: "Permission preset", htmlFor: "dsh-auto-f-permission", required: true },
            h(
              "select",
              {
                id: "dsh-auto-f-permission",
                className: "dsh-auto-select",
                value: draft.permissionPreset,
                onChange: (event) => onChange("permissionPreset", event.target.value),
              },
              permissionPresets.map((preset) => h("option", { key: preset, value: preset }, preset)),
            ),
          ),
          h(
            Field,
            { label: "Overlap policy", htmlFor: "dsh-auto-f-overlap", full: true, hint: "What happens when a scheduled run fires while another run for the same job is still active." },
            h(
              "select",
              {
                id: "dsh-auto-f-overlap",
                className: "dsh-auto-select",
                value: draft.overlap,
                onChange: (event) => onChange("overlap", event.target.value),
              },
              OVERLAP_OPTIONS.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
            ),
          ),
          h(
            Field,
            { label: "Misfire policy", htmlFor: "dsh-auto-f-misfire", hint: "How a missed occurrence is handled after the scheduler is back." },
            h(
              "select",
              {
                id: "dsh-auto-f-misfire",
                className: "dsh-auto-select",
                value: draft.misfire,
                onChange: (event) => onChange("misfire", event.target.value),
              },
              MISFIRE_OPTIONS.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
            ),
          ),
          h(
            Field,
            { label: "Working directory", htmlFor: "dsh-auto-f-cwd", required: true, full: true, hint: "Absolute project directory the agent runs in." },
            h("input", {
              id: "dsh-auto-f-cwd",
              className: "dsh-auto-input",
              type: "text",
              value: draft.cwd,
              spellCheck: false,
              placeholder: "/home/you/workspace/project",
              onChange: (event) => onChange("cwd", event.target.value),
            }),
          ),
          h(
            Field,
            { label: "Prompt", htmlFor: "dsh-auto-f-prompt", required: true, full: true, hint: "Instructions for the agent run. Prompts are never shown in run history." },
            h("textarea", {
              id: "dsh-auto-f-prompt",
              className: "dsh-auto-textarea",
              value: draft.prompt,
              placeholder: "Summarize yesterday's progress and list today's priorities\u2026",
              onChange: (event) => onChange("prompt", event.target.value),
            }),
          ),
        ),
        error
          ? h("p", { className: "dsh-auto-formerror", role: "alert" }, error)
          : null,
        h(
          "div",
          { className: "dsh-auto-formactions" },
          h(
            "button",
            { type: "submit", className: "dsh-auto-btn dsh-auto-btn-primary", disabled: saving },
            saving ? "Saving\u2026" : creating ? "Create automation" : "Save changes",
          ),
          h(
            "button",
            { type: "button", className: "dsh-auto-btn", onClick: onCancel, disabled: saving },
            "Cancel",
          ),
        ),
      );
    }

    function JobCard(props) {
      const {
        job,
        meta,
        busy,
        busyForJob,
        onToggle,
        onRun,
        onEdit,
        onDelete,
        onDeleteConfirm,
        onDeleteCancel,
        confirmingDelete,
      } = props;
      const toggling = busy["toggle:" + job.id] === true;
      const running = busy["run:" + job.id] === true;
      const deleting = busy["delete:" + job.id] === true;
      const modelLabel = job.execution.provider
        ? job.execution.provider + "/" + job.execution.model
        : "Default model";
      const agentPreset = meta && Array.isArray(meta.agentPresets)
        ? meta.agentPresets.find((preset) => preset.id === job.execution.agentPreset)
        : undefined;
      const presetLabel = job.execution.agentPreset
        ? (agentPreset ? agentPreset.name : job.execution.agentPreset)
        : "";

      return h(
        "article",
        { className: "dsh-auto-card" + (job.enabled ? "" : " dsh-auto-card-disabled") },
        h(
          "div",
          { className: "dsh-auto-card-head" },
          h(
            "div",
            { className: "dsh-auto-card-title" },
            h("h3", null, job.name),
            h("span", { className: "dsh-auto-card-id", title: "Job id" }, job.id),
          ),
          h(
            "label",
            { className: "dsh-auto-switch" },
            h("input", {
              type: "checkbox",
              role: "switch",
              checked: job.enabled,
              disabled: toggling || busyForJob,
              "aria-label": (job.enabled ? "Disable" : "Enable") + " automation " + job.name,
              onChange: onToggle,
            }),
            h("span", { className: "dsh-auto-switch-track" }),
            h("span", { className: "dsh-auto-switch-text" }, job.enabled ? "Enabled" : "Disabled"),
          ),
        ),
        h(
          "div",
          { className: "dsh-auto-card-meta" },
          h("span", { title: "Schedule" }, job.schedule.cron + " \u00b7 " + job.schedule.timezone),
          h(
            "span",
            { className: "dsh-auto-next" },
            !job.enabled
              ? "Paused"
              : job.nextRunAt
                ? "Next " + formatDate(job.nextRunAt)
                : "No next run",
          ),
          h("span", { title: "Model" }, modelLabel),
          presetLabel !== ""
            ? h("span", { title: "Agent preset" }, presetLabel)
            : null,
          h("span", { title: "Permission preset" }, job.execution.permissionPreset),
          h("span", { title: "Timeout" }, formatTimeout(job.execution.timeoutMs)),
          h("span", { className: "dsh-auto-muted", title: "Version" }, "v" + job.version),
        ),
        h(
          "div",
          { className: "dsh-auto-card-actions" },
          h(
            "button",
            { type: "button", className: "dsh-auto-btn", onClick: onEdit, disabled: busyForJob || running },
            "Edit",
          ),
          h(
            "button",
            {
              type: "button",
              className: "dsh-auto-btn dsh-auto-btn-primary",
              onClick: onRun,
              disabled: busyForJob,
            },
            running ? "Starting\u2026" : "Run now",
          ),
          confirmingDelete
            ? h(
                "span",
                { className: "dsh-auto-confirm" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-auto-btn dsh-auto-btn-danger",
                    onClick: onDeleteConfirm,
                    disabled: deleting,
                  },
                  deleting ? "Deleting\u2026" : "Confirm delete",
                ),
                h(
                  "button",
                  { type: "button", className: "dsh-auto-btn", onClick: onDeleteCancel, disabled: deleting },
                  "Keep",
                ),
              )
            : h(
                "button",
                {
                  type: "button",
                  className: "dsh-auto-btn dsh-auto-btn-danger-ghost",
                  onClick: onDelete,
                  disabled: busyForJob,
                },
                "Delete",
              ),
        ),
      );
    }

    function RunsList(props) {
      const { runs, busy, confirmCancelId, onCancel, onCancelConfirm, onCancelReset } = props;
      const visible = runs.slice(0, HISTORY_SHOWN);
      const isActive = (run) => run.status === "queued" || run.status === "running";

      return h(
        "section",
        { className: "dsh-auto-runs", "aria-label": "Recent runs" },
        h("h3", null, "Recent runs" + (runs.length > 0 ? " (" + runs.length + ")" : "")),
        runs.length === 0
          ? h(
              "p",
              { className: "dsh-auto-empty" },
              "No runs yet. Runs appear here once an automation is triggered manually or its schedule fires.",
            )
          : h(
              "ul",
              { className: "dsh-auto-runlist" },
              visible.map((run) => {
                const active = isActive(run);
                const cancelling = busy["cancel:" + run.id] === true;
                return h(
                  "li",
                  { key: run.id, className: "dsh-auto-run" + (active ? " dsh-auto-run-active" : "") },
                  h(StatusPill, { status: run.status }),
                  h("span", { className: "dsh-auto-run-name", title: run.jobName }, run.jobName),
                  h(
                    "span",
                    { className: "dsh-auto-run-meta" },
                    run.trigger + (run.scheduledFor ? " \u00b7 " + formatDate(run.scheduledFor) : ""),
                  ),
                  run.startedAt
                    ? h("span", { className: "dsh-auto-run-dur", title: "Elapsed" }, formatDuration(run))
                    : null,
                  run.error
                    ? h(
                        "span",
                        {
                          className: "dsh-auto-run-error",
                          title: (run.error.code ? run.error.code + ": " : "") + run.error.message,
                        },
                        run.error.message,
                      )
                    : null,
                  run.skipReason
                    ? h("span", { className: "dsh-auto-run-skip" }, "skipped: " + run.skipReason)
                    : null,
                  run.sessionId
                    ? h(
                        "span",
                        { className: "dsh-auto-run-session", title: run.sessionId },
                        "session " + run.sessionId.slice(0, 10) + "\u2026",
                      )
                    : null,
                  active
                    ? confirmCancelId === run.id
                      ? h(
                          "span",
                          { className: "dsh-auto-confirm" },
                          h(
                            "button",
                            {
                              type: "button",
                              className: "dsh-auto-btn dsh-auto-btn-danger",
                              onClick: () => onCancelConfirm(run),
                              disabled: cancelling,
                            },
                            cancelling ? "Cancelling\u2026" : "Confirm",
                          ),
                          h(
                            "button",
                            { type: "button", className: "dsh-auto-btn", onClick: onCancelReset, disabled: cancelling },
                            "Back",
                          ),
                        )
                      : h(
                          "button",
                          {
                            type: "button",
                            className: "dsh-auto-btn dsh-auto-btn-ghost",
                            onClick: () => onCancel(run),
                          },
                          "Cancel",
                        )
                    : null,
                );
              }),
              runs.length > visible.length
                ? h(
                    "li",
                    { className: "dsh-auto-run-more" },
                    runs.length - visible.length + " more run(s) not shown.",
                  )
                : null,
            ),
      );
    }

    function AutomationsSection() {
      const [meta, setMeta] = useState(null);
      const [snapshot, setSnapshot] = useState(null);
      const [loading, setLoading] = useState(true);
      const [loadError, setLoadError] = useState(null);
      const [metaWarning, setMetaWarning] = useState(null);
      const [flash, setFlash] = useState(null);
      const [busy, setBusy] = useState({});
      const [formOpen, setFormOpen] = useState(false);
      const [editing, setEditing] = useState(null);
      const [draft, setDraft] = useState(() => emptyDraft(null));
      const [formError, setFormError] = useState(null);
      const [confirmDeleteId, setConfirmDeleteId] = useState(null);
      const [confirmCancelId, setConfirmCancelId] = useState(null);

      const aliveRef = useRef(true);
      const pollRef = useRef(false);
      const hasDataRef = useRef(false);
      const idTouchedRef = useRef(false);
      const flashTimerRef = useRef(null);

      const loadMeta = useCallback(async () => {
        try {
          const data = await apiFetch("/meta");
          if (!aliveRef.current) return;
          setMeta(data);
          setMetaWarning(null);
        } catch (error) {
          if (!aliveRef.current) return;
          setMetaWarning(errMessage(error));
        }
      }, []);

      const loadSnapshot = useCallback(async (loud) => {
        if (pollRef.current) return;
        pollRef.current = true;
        try {
          const data = await apiFetch("?limit=100");
          if (!aliveRef.current) return;
          hasDataRef.current = true;
          setSnapshot(data);
          setLoading(false);
          setLoadError(null);
        } catch (error) {
          if (!aliveRef.current) return;
          if (!hasDataRef.current) setLoadError(errMessage(error));
        } finally {
          pollRef.current = false;
        }
      }, []);

      useEffect(() => {
        aliveRef.current = true;
        loadMeta();
        loadSnapshot(true);
        const timer = window.setInterval(() => loadSnapshot(false), POLL_MS);
        return () => {
          aliveRef.current = false;
          window.clearInterval(timer);
          window.clearTimeout(flashTimerRef.current);
        };
      }, [loadMeta, loadSnapshot]);

      const flashMessage = useCallback((kind, message) => {
        setFlash({ kind, message });
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => setFlash(null), 6000);
      }, []);

      const setBusyKey = useCallback((key, value) => {
        setBusy((previous) => Object.assign({}, previous, { [key]: value }));
      }, []);

      const runAction = useCallback(
        async (key, action, onSuccess) => {
          setBusyKey(key, true);
          try {
            const result = await action();
            await loadSnapshot(true);
            if (onSuccess) onSuccess(result);
            return result;
          } catch (error) {
            flashMessage("error", errMessage(error));
            return null;
          } finally {
            setBusyKey(key, false);
          }
        },
        [flashMessage, loadSnapshot, setBusyKey],
      );

      const handleToggle = useCallback(
        (job) => {
          runAction("toggle:" + job.id, () =>
            apiFetch("/jobs/" + encodeURIComponent(job.id) + "/enabled", {
              method: "POST",
              body: JSON.stringify({ enabled: !job.enabled, expectedVersion: job.version }),
            }),
          );
        },
        [runAction],
      );

      const handleRunNow = useCallback(
        (job) => {
          runAction(
            "run:" + job.id,
            () => apiFetch("/jobs/" + encodeURIComponent(job.id) + "/run", { method: "POST", body: "{}" }),
            (run) => flashMessage(
              run && run.status === "skipped" ? "error" : "success",
              run && run.status === "skipped"
                ? "Run skipped for \u201c" + job.name + "\u201d (" + (run.skipReason || "policy") + ")."
                : "Run queued for \u201c" + job.name + "\u201d.",
            ),
          );
        },
        [runAction, flashMessage],
      );

      const handleDeleteStart = useCallback((job) => {
        setConfirmCancelId(null);
        setConfirmDeleteId(job.id);
      }, []);

      const handleDeleteConfirm = useCallback(
        (job) => {
          runAction(
            "delete:" + job.id,
            async () => {
              await apiFetch("/jobs/" + encodeURIComponent(job.id), { method: "DELETE", body: "{}" });
              setConfirmDeleteId(null);
            },
            () => flashMessage("success", "Automation \u201c" + job.name + "\u201d deleted."),
          );
        },
        [runAction, flashMessage],
      );

      const handleDeleteCancel = useCallback(() => setConfirmDeleteId(null), []);

      const handleCancelRunStart = useCallback((run) => {
        setConfirmDeleteId(null);
        setConfirmCancelId(run.id);
      }, []);

      const handleCancelRunConfirm = useCallback(
        (run) => {
          runAction(
            "cancel:" + run.id,
            () => apiFetch("/runs/" + encodeURIComponent(run.id) + "/cancel", { method: "POST", body: "{}" }),
            () => {
              setConfirmCancelId(null);
              flashMessage("success", "Run cancellation requested.");
            },
          );
        },
        [runAction, flashMessage],
      );

      const handleCancelRunReset = useCallback(() => setConfirmCancelId(null), []);

      const openCreate = useCallback(() => {
        setEditing(null);
        idTouchedRef.current = false;
        setDraft(emptyDraft(meta));
        setFormError(null);
        setFormOpen(true);
      }, [meta]);

      const openEdit = useCallback((job) => {
        setEditing(job);
        idTouchedRef.current = true;
        setDraft(draftFromJob(job));
        setFormError(null);
        setFormOpen(true);
      }, []);

      const closeForm = useCallback(() => {
        setFormOpen(false);
        setEditing(null);
        setFormError(null);
      }, []);

      const handleDraftChange = useCallback(
        (key, value) => {
          setDraft((previous) => {
            let next = Object.assign({}, previous, { [key]: value });
            if (key === "name" && editing === null && !idTouchedRef.current) {
              next = Object.assign({}, next, { id: slugifyJobId(value) });
            }
            if (key === "provider") {
              next = Object.assign({}, next, { model: "" });
            }
            return next;
          });
        },
        [editing],
      );

      const handleIdTouched = useCallback(() => {
        idTouchedRef.current = true;
      }, []);

      const handleSubmit = useCallback(
        async (event) => {
          event.preventDefault();
          const creating = editing === null;

          const name = draft.name.trim();
          if (name === "") return setFormError("Give the automation a name.");
          const cron = draft.cron.trim();
          if (cron === "") return setFormError("A cron expression is required, e.g. 0 9 * * 1-5.");
          const timezone = draft.timezone.trim();
          if (timezone === "") return setFormError("A timezone is required.");
          const cwd = draft.cwd.trim();
          if (cwd === "") return setFormError("The working directory is required.");
          const looksAbsolute = cwd.charAt(0) === "/" || /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\");
          if (!looksAbsolute) {
            return setFormError("The working directory must be an absolute filesystem path.");
          }
          const prompt = draft.prompt.trim();
          if (prompt === "") return setFormError("A prompt is required.");
          const timeoutMs = Number(draft.timeoutMs);
          if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
            return setFormError(
              "Timeout must be a whole number of milliseconds between " + MIN_TIMEOUT_MS + " and " + MAX_TIMEOUT_MS + ".",
            );
          }
          const provider = draft.provider.trim();
          const model = draft.model.trim();
          if (provider !== "" && model === "") {
            return setFormError("Pick a model for the chosen provider (or leave both blank for the Harness default).");
          }
          if (provider === "" && model !== "") {
            return setFormError("A model needs a provider (or leave both blank for the Harness default).");
          }
          let id = "";
          if (creating) {
            id = draft.id.trim().toLowerCase();
            if (id !== "" && !JOB_ID_PATTERN.test(id)) {
              return setFormError("Job id must match [a-z0-9][a-z0-9-]{0,62} (lowercase letters, digits, hyphens).");
            }
          }
          const spec = buildSpec(draft);
          setFormError(null);
          setBusyKey("save", true);
          try {
            if (creating) {
              await apiFetch("/jobs", {
                method: "POST",
                body: JSON.stringify(id === "" ? { spec } : { spec, id }),
              });
            } else {
              await apiFetch("/jobs/" + encodeURIComponent(editing.id), {
                method: "PUT",
                body: JSON.stringify({ expectedVersion: editing.version, spec }),
              });
            }
            await loadSnapshot(true);
            flashMessage("success", creating ? "Automation created." : "Automation updated.");
            closeForm();
          } catch (error) {
            setFormError(errMessage(error));
          } finally {
            setBusyKey("save", false);
          }
        },
        [draft, editing, flashMessage, loadSnapshot, closeForm, setBusyKey],
      );

      const jobs = snapshot ? snapshot.jobs : [];
      const runs = snapshot ? snapshot.runs : [];
      const busyForJob = (id) =>
        ["toggle:" + id, "run:" + id, "delete:" + id].some((key) => busy[key] === true);

      return h(
        "section",
        { className: "dsh-auto-root", "aria-busy": loading ? "true" : null },
        h(
          "div",
          { className: "dsh-auto-head" },
          h(
            "div",
            null,
            h("h2", null, "Automations"),
            h(
              "p",
              { className: "dsh-auto-sub" },
              snapshot
                ? "Scheduled agent jobs \u00b7 revision " + snapshot.revision + " \u00b7 refreshes every " + POLL_MS / 1000 + "s."
                : "Scheduled agent jobs.",
            ),
          ),
          !formOpen
            ? h(
                "button",
                { type: "button", className: "dsh-auto-btn dsh-auto-btn-primary", onClick: openCreate },
                "New automation",
              )
            : null,
        ),
        flash
          ? h("p", { className: "dsh-auto-flash dsh-auto-flash-" + flash.kind, role: "status" }, flash.message)
          : null,
        metaWarning
          ? h(
              "p",
              { className: "dsh-auto-flash dsh-auto-flash-warn", role: "status" },
              "Could not load provider/model options: ",
              metaWarning,
              " ",
              h("button", { type: "button", className: "dsh-auto-linkbtn", onClick: loadMeta }, "Retry"),
            )
          : null,
        formOpen
          ? h(JobForm, {
              meta,
              draft,
              editing,
              saving: busy.save === true,
              error: formError,
              onChange: handleDraftChange,
              onIdTouched: handleIdTouched,
              onSubmit: handleSubmit,
              onCancel: closeForm,
            })
          : null,
        loadError !== null && snapshot === null
          ? h(
              "div",
              { className: "dsh-auto-error", role: "alert" },
              h("p", null, "Could not load automations: ", loadError),
              h(
                "button",
                { type: "button", className: "dsh-auto-btn dsh-auto-btn-primary", onClick: () => loadSnapshot(true) },
                "Retry",
              ),
            )
          : loading && snapshot === null
            ? h("div", { className: "dsh-auto-loading", role: "status" }, "Loading automations\u2026")
            : h(
                "div",
                { className: "dsh-auto-jobs" },
                jobs.length === 0
                  ? h(
                      "p",
                      { className: "dsh-auto-empty" },
                      "No automations yet. Create your first scheduled agent job.",
                    )
                  : jobs.map((job) =>
                      h(JobCard, {
                        key: job.id,
                        job,
                        meta,
                        busy,
                        busyForJob: busyForJob(job.id),
                        onToggle: () => handleToggle(job),
                        onRun: () => handleRunNow(job),
                        onEdit: () => openEdit(job),
                        onDelete: () => handleDeleteStart(job),
                        onDeleteConfirm: () => handleDeleteConfirm(job),
                        onDeleteCancel: handleDeleteCancel,
                        confirmingDelete: confirmDeleteId === job.id,
                      }),
                    ),
              ),
        snapshot !== null
          ? h(RunsList, {
              runs,
              busy,
              confirmCancelId,
              onCancel: handleCancelRunStart,
              onCancelConfirm: handleCancelRunConfirm,
              onCancelReset: handleCancelRunReset,
            })
          : null,
      );
    }

    const STYLE_CSS = [
      ".dsh-auto-root{--dsh-auto-border:var(--dsw-alias-border-subtle,rgba(128,128,128,.3));--dsh-auto-bg:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.05));box-sizing:border-box;max-width:820px;display:flex;flex-direction:column;gap:16px;font-family:inherit;color:var(--dsw-alias-label-primary,#e5e7eb);}",
      ".dsh-auto-root *,.dsh-auto-root *::before,.dsh-auto-root *::after{box-sizing:border-box;}",
      ".dsh-auto-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
      ".dsh-auto-head h2{margin:0;font-size:18px;font-weight:600;line-height:1.35;}",
      ".dsh-auto-sub{margin:3px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#9ca3af);max-width:540px;}",
      ".dsh-auto-flash{margin:0;padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.45;word-break:break-word;}",
      ".dsh-auto-flash-error{background:rgba(239,68,68,.13);color:var(--dsw-alias-label-error,#f87171);}",
      ".dsh-auto-flash-success{background:rgba(34,197,94,.13);color:var(--dsw-alias-label-success,#4ade80);}",
      ".dsh-auto-flash-warn{background:rgba(234,179,8,.13);color:var(--dsw-alias-label-warning,#fbbf24);}",
      ".dsh-auto-linkbtn{font:inherit;font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer;background:none;border:none;padding:0;}",
      ".dsh-auto-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:5px 12px;border:1px solid var(--dsh-auto-border);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#e5e7eb);font-family:inherit;font-size:13px;line-height:1.2;cursor:pointer;transition:background .15s ease,opacity .15s ease;white-space:nowrap;}",
      ".dsh-auto-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));}",
      ".dsh-auto-btn:disabled{opacity:.5;cursor:default;}",
      ".dsh-auto-btn-primary{background:var(--dsw-alias-brand-primary,#3b82f6);border-color:transparent;color:#fff;}",
      ".dsh-auto-btn-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary-hover,#2563eb);}",
      ".dsh-auto-btn-danger{background:var(--dsw-alias-label-error,#ef4444);border-color:transparent;color:#fff;}",
      ".dsh-auto-btn-danger:hover:not(:disabled){background:#dc2626;}",
      ".dsh-auto-btn-danger-ghost{color:var(--dsw-alias-label-error,#ef4444);border-color:currentColor;}",
      ".dsh-auto-btn-danger-ghost:hover:not(:disabled){background:rgba(239,68,68,.12);}",
      ".dsh-auto-btn-ghost{color:var(--dsw-alias-label-secondary,#9ca3af);}",
      ".dsh-auto-input,.dsh-auto-select,.dsh-auto-textarea{width:100%;min-height:34px;padding:6px 10px;border:1px solid var(--dsh-auto-border);border-radius:8px;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,#e5e7eb);font-family:inherit;font-size:13px;line-height:1.5;}",
      ".dsh-auto-input:focus-visible,.dsh-auto-select:focus-visible,.dsh-auto-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:1px;border-color:transparent;}",
      ".dsh-auto-input:disabled,.dsh-auto-select:disabled,.dsh-auto-textarea:disabled{opacity:.55;cursor:default;}",
      ".dsh-auto-textarea{resize:vertical;min-height:110px;}",
      ".dsh-auto-check{display:inline-flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;min-height:34px;}",
      ".dsh-auto-check input{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary,#3b82f6);cursor:pointer;}",
      ".dsh-auto-form{border:1px solid var(--dsh-auto-border);border-radius:14px;padding:16px;background:var(--dsh-auto-bg);display:flex;flex-direction:column;gap:14px;}",
      ".dsh-auto-form h3{margin:0;font-size:15px;font-weight:600;}",
      ".dsh-auto-formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}",
      ".dsh-auto-field{display:flex;flex-direction:column;gap:4px;min-width:0;}",
      ".dsh-auto-field-full{grid-column:1/-1;}",
      ".dsh-auto-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary,#9ca3af);}",
      ".dsh-auto-required{color:var(--dsw-alias-label-error,#ef4444);}",
      ".dsh-auto-hint{margin:0;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#9ca3af);}",
      ".dsh-auto-formerror{margin:0;padding:8px 10px;border-radius:8px;background:rgba(239,68,68,.12);color:var(--dsw-alias-label-error,#ef4444);font-size:12px;line-height:1.45;}",
      ".dsh-auto-formactions{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;}",
      ".dsh-auto-jobs{display:flex;flex-direction:column;gap:10px;}",
      ".dsh-auto-card{border:1px solid var(--dsh-auto-border);border-radius:12px;padding:12px 14px;background:var(--dsh-auto-bg);display:flex;flex-direction:column;gap:10px;}",
      ".dsh-auto-card-disabled{opacity:.68;}",
      ".dsh-auto-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
      ".dsh-auto-card-title{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0;}",
      ".dsh-auto-card-title h3{margin:0;font-size:14px;font-weight:600;overflow-wrap:anywhere;}",
      ".dsh-auto-card-id{font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
      ".dsh-auto-card-meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);line-height:1.5;}",
      ".dsh-auto-card-meta span{white-space:nowrap;}",
      ".dsh-auto-next{font-variant-numeric:tabular-nums;}",
      ".dsh-auto-muted{color:var(--dsw-alias-label-tertiary,#9ca3af);}",
      ".dsh-auto-card-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
      ".dsh-auto-confirm{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;}",
      ".dsh-auto-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);user-select:none;}",
      ".dsh-auto-switch input{position:absolute;opacity:0;width:1px;height:1px;margin:0;}",
      ".dsh-auto-switch-track{position:relative;width:32px;height:18px;border-radius:9px;background:var(--dsw-alias-border-strong,rgba(128,128,128,.5));transition:background .15s ease;flex:none;}",
      ".dsh-auto-switch-track::after{content:\"\";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s ease;}",
      ".dsh-auto-switch input:checked+.dsh-auto-switch-track{background:var(--dsw-alias-brand-primary,#3b82f6);}",
      ".dsh-auto-switch input:checked+.dsh-auto-switch-track::after{transform:translateX(14px);}",
      ".dsh-auto-switch input:focus-visible+.dsh-auto-switch-track{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:2px;}",
      ".dsh-auto-switch input:disabled~.dsh-auto-switch-text{opacity:.6;}",
      ".dsh-auto-switch:has(input:disabled){cursor:default;}",
      ".dsh-auto-runs{border-top:1px solid var(--dsh-auto-border);padding-top:14px;display:flex;flex-direction:column;gap:10px;min-width:0;}",
      ".dsh-auto-runs h3{margin:0;font-size:14px;font-weight:600;}",
      ".dsh-auto-runlist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto;}",
      ".dsh-auto-run{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:8px 10px;border:1px solid var(--dsh-auto-border);border-radius:10px;background:var(--dsh-auto-bg);font-size:12px;line-height:1.4;}",
      ".dsh-auto-run-active{border-color:var(--dsw-alias-brand-primary,rgba(59,130,246,.5));}",
      ".dsh-auto-run-name{font-weight:500;color:var(--dsw-alias-label-primary,#e5e7eb);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsh-auto-run-meta{color:var(--dsw-alias-label-tertiary,#9ca3af);font-variant-numeric:tabular-nums;}",
      ".dsh-auto-run-dur{color:var(--dsw-alias-label-secondary,#9ca3af);font-variant-numeric:tabular-nums;white-space:nowrap;}",
      ".dsh-auto-run-error{color:var(--dsw-alias-label-error,#ef4444);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsh-auto-run-skip{color:var(--dsw-alias-label-tertiary,#9ca3af);}",
      ".dsh-auto-run-session{color:var(--dsw-alias-label-tertiary,#9ca3af);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;}",
      ".dsh-auto-run-more{color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:11px;padding:2px 4px;}",
      ".dsh-auto-status{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;text-transform:capitalize;white-space:nowrap;}",
      ".dsh-auto-status::before{content:\"\";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none;}",
      ".dsh-auto-status-queued{background:rgba(128,128,128,.16);color:#9ca3af;}",
      ".dsh-auto-status-running{background:rgba(59,130,246,.16);color:#60a5fa;}",
      ".dsh-auto-status-running::before{animation:dsh-auto-pulse 1.1s ease-in-out infinite;}",
      ".dsh-auto-status-succeeded{background:rgba(34,197,94,.16);color:#4ade80;}",
      ".dsh-auto-status-failed,.dsh-auto-status-timed-out{background:rgba(239,68,68,.16);color:#f87171;}",
      ".dsh-auto-status-cancelled,.dsh-auto-status-skipped,.dsh-auto-status-interrupted{background:rgba(128,128,128,.16);color:#9ca3af;}",
      "@keyframes dsh-auto-pulse{0%,100%{opacity:1}50%{opacity:.35}}",
      ".dsh-auto-empty,.dsh-auto-loading,.dsh-auto-error{padding:22px 16px;text-align:center;border:1px dashed var(--dsh-auto-border);border-radius:12px;font-size:13px;color:var(--dsw-alias-label-secondary,#9ca3af);}",
      ".dsh-auto-error{color:var(--dsw-alias-label-error,#ef4444);display:flex;flex-direction:column;gap:10px;align-items:center;}",
      "@media (max-width:640px){.dsh-auto-formgrid{grid-template-columns:1fr;}.dsh-auto-card-head{flex-direction:column;align-items:flex-start;}.dsh-auto-run-name{max-width:150px;}}",
    ].join("\n");

    function apply(ctx) {
      // The page styles ride a style element owned by this plugin's fiber:
      // created now and removed when the plugin unloads.
      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.setAttribute("data-plugin", "@syncended/dsh-automations");
        tag.textContent = STYLE_CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, "@syncended/dsh-automations: settings page styles");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "automations",
        order: 25,
        label: "Automations",
      }, AutomationsSection));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
