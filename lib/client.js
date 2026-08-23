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
    const { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } = React;
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

    const CJK_LABEL_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
    const BUILTIN_AGENT_PRESET_LABELS = {
      standard: "Standard mode",
      code: "PTC mode",
      minimal: "Minimal mode",
      cordis: "Creator mode",
    };

    function humanizePresetId(id) {
      return id
        .split(/[-_]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }

    function agentPresetDisplayLabel(preset) {
      const id = preset && typeof preset.id === "string" ? preset.id.trim() : "";
      const name = preset && typeof preset.name === "string" ? preset.name.trim() : "";
      if (id === "") return name !== "" && !CJK_LABEL_PATTERN.test(name) ? name : "Unknown preset";
      if (name !== "" && name !== id && !CJK_LABEL_PATTERN.test(name)) return name + " (" + id + ")";
      const readableId = BUILTIN_AGENT_PRESET_LABELS[id] || humanizePresetId(id) || id;
      return readableId === id ? id : readableId + " (" + id + ")";
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
                  agentPresetDisplayLabel(preset) + (preset.broken ? " (broken: " + preset.broken + ")" : ""),
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
        ? agentPresetDisplayLabel(agentPreset || {
            id: job.execution.agentPreset,
            name: job.execution.agentPreset,
          })
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

    function createDisclosureStore() {
      let open = false;
      let disposed = false;
      const listeners = new Set();
      const publish = (next) => {
        if (disposed || open === next) return;
        open = next;
        for (const listener of Array.from(listeners)) listener();
      };
      return {
        getSnapshot: () => open,
        subscribe: (listener) => {
          if (disposed) return () => {};
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        open: () => publish(true),
        close: () => publish(false),
        toggle: () => publish(!open),
        dispose: () => {
          disposed = true;
          open = false;
          listeners.clear();
        },
      };
    }

    const MODAL_FOCUS_SELECTOR = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[contenteditable=\"true\"]",
      "[tabindex]:not([tabindex=\"-1\"])",
    ].join(",");

    function modalFocusables(panel) {
      if (!panel) return [];
      return Array.from(panel.querySelectorAll(MODAL_FOCUS_SELECTOR)).filter((element) =>
        !element.hasAttribute("hidden") &&
        element.getAttribute("aria-hidden") !== "true" &&
        element.getClientRects().length > 0,
      );
    }

    function trapModalTab(event, panel) {
      if (
        event.key !== "Tab" ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) return;
      const focusables = modalFocusables(panel);
      if (focusables.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = panel.ownerDocument.activeElement;
      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    function AutomationGlyph({ size = 18 }) {
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.7",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false",
        },
        h("rect", { x: "3.5", y: "5.5", width: "17", height: "15", rx: "3" }),
        h("path", { d: "M8 3.5v4M16 3.5v4M3.5 10h17" }),
        h("circle", { cx: "12", cy: "15.25", r: "2.75" }),
        h("path", { d: "M12 13.8v1.65l1.15.7" }),
      );
    }

    function CloseGlyph() {
      return h(
        "svg",
        {
          width: "16",
          height: "16",
          viewBox: "0 0 16 16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.5",
          strokeLinecap: "round",
          "aria-hidden": "true",
          focusable: "false",
        },
        h("path", { d: "M3.5 3.5l9 9M12.5 3.5l-9 9" }),
      );
    }

    function AutomationsSidebarAction({ wide, disclosure }) {
      const open = useSyncExternalStore(
        disclosure.subscribe,
        disclosure.getSnapshot,
        disclosure.getSnapshot,
      );
      const triggerRef = useRef(null);
      const previousOpenRef = useRef(open);

      useEffect(() => {
        const previous = previousOpenRef.current;
        previousOpenRef.current = open;
        if (!previous || open) return undefined;
        const frame = window.requestAnimationFrame(() => triggerRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
      }, [open]);

      return h(
        "div",
        { className: "dsh-auto-sidebar-action" + (wide ? "" : " dsh-auto-sidebar-action-rail") },
        h(
          "button",
          {
            ref: triggerRef,
            type: "button",
            className: "dsh-auto-sidebar-trigger",
            title: wide ? undefined : "Automations",
            "aria-label": "Automations",
            "aria-haspopup": "dialog",
            "aria-expanded": open,
            "data-active": open ? "true" : undefined,
            "data-dsh-automations-trigger": "true",
            onClick: disclosure.toggle,
          },
          h(AutomationGlyph, { size: wide ? 16 : 18 }),
          wide ? h("span", { className: "dsh-auto-sidebar-label" }, "Automations") : null,
        ),
      );
    }

    function AutomationsOverlay({ disclosure }) {
      const open = useSyncExternalStore(
        disclosure.subscribe,
        disclosure.getSnapshot,
        disclosure.getSnapshot,
      );
      const closeRef = useRef(null);
      const panelRef = useRef(null);
      const titleId = useId();

      useEffect(() => {
        if (!open) return undefined;
        const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
      }, [open]);

      if (!open) return null;
      return h(
        "div",
        { className: "dsh-auto-overlay", "data-dsh-automations-overlay": "true" },
        h("div", { className: "dsh-auto-overlay-mask", "aria-hidden": "true", onClick: disclosure.close }),
        h(
          "section",
          {
            ref: panelRef,
            className: "dsh-auto-overlay-panel",
            role: "dialog",
            tabIndex: -1,
            "aria-modal": "true",
            "aria-labelledby": titleId,
            onKeyDownCapture: (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                disclosure.close();
                return;
              }
              trapModalTab(event, panelRef.current);
            },
          },
          h(
            "header",
            { className: "dsh-auto-overlay-header" },
            h("span", { id: titleId, className: "dsh-auto-sr-only" }, "Automations"),
            h(
              "button",
              {
                ref: closeRef,
                type: "button",
                className: "dsh-auto-overlay-close",
                "aria-label": "Close Automations",
                title: "Close",
                onClick: disclosure.close,
              },
              h(CloseGlyph),
            ),
          ),
          h("div", { className: "dsh-auto-overlay-body" }, h(AutomationsSection)),
        ),
      );
    }

    const STYLE_CSS = [
      ".dsh-auto-sidebar-action{box-sizing:border-box;width:100%;height:42px;flex:none;display:flex;align-items:center;margin:4px 0 0;}",
      ".dsh-auto-sidebar-trigger{box-sizing:border-box;appearance:none;width:calc(100% + 4px);height:42px;margin:0 -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);display:flex;align-items:center;gap:8px;overflow:hidden;font:14px/22px inherit;cursor:pointer;}",
      ".dsh-auto-sidebar-trigger:hover,.dsh-auto-sidebar-trigger[data-active=\"true\"]{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));}",
      ".dsh-auto-sidebar-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:-2px;}",
      ".dsh-auto-sidebar-trigger svg{flex:none;}",
      ".dsh-auto-sidebar-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsh-auto-sidebar-action-rail{width:36px;height:36px;margin:0;}",
      ".dsh-auto-sidebar-action-rail .dsh-auto-sidebar-trigger{width:36px;height:36px;margin:0;padding:0;justify-content:center;gap:0;border-radius:50%;}",
      ".dsh-auto-overlay{z-index:1000;pointer-events:auto;position:fixed;inset:0;display:flex;align-items:center;justify-content:center;}",
      ".dsh-auto-overlay-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.46));backdrop-filter:var(--dsw-mask-blur,blur(2px));}",
      ".dsh-auto-overlay-panel{box-sizing:border-box;z-index:1;position:relative;width:900px;max-width:calc(100vw - 48px);height:min(800px,calc(100vh - 48px));border:0;border-radius:24px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv3,0 18px 60px rgba(0,0,0,.3));color:var(--dsw-alias-label-primary,#0f1115);display:flex;flex-direction:column;overflow:hidden;}",
      ".dsh-auto-overlay-header{box-sizing:border-box;height:52px;flex:none;display:flex;align-items:center;justify-content:flex-end;padding:10px 16px;}",
      ".dsh-auto-overlay-close{appearance:none;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary,#4f5661);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}",
      ".dsh-auto-overlay-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,#0f1115);}",
      ".dsh-auto-overlay-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px;}",
      ".dsh-auto-overlay-body{box-sizing:border-box;min-height:0;flex:1;padding:0 28px 28px;overflow-y:auto;overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);}",
      ".dsh-auto-overlay-body>.dsh-auto-root{width:100%;margin:0 auto;padding-top:0;}",
      ".dsh-auto-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;}",
      ".dsh-auto-root{--dsh-auto-border:var(--dsw-alias-border-l2,rgba(15,17,21,.14));--dsh-auto-border-strong:var(--dsw-alias-border-l3,rgba(15,17,21,.2));--dsh-auto-surface:var(--dsw-alias-bg-layer-3,#fff);--dsh-auto-surface-active:var(--dsw-alias-bg-layer-2,#fff);--dsh-auto-input-bg:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff));--dsh-auto-text:var(--dsw-alias-label-primary,#0f1115);--dsh-auto-text-secondary:var(--dsw-alias-label-secondary,#4f5661);--dsh-auto-muted:var(--dsw-alias-label-tertiary,#81858c);--dsh-auto-caption:var(--dsw-alias-label-caption,#adb2b8);--dsh-auto-accent:var(--dsw-alias-state-business-primary,#4176e6);--dsh-auto-primary-fill:var(--dsw-alias-button-primary-fill,#0f1115);--dsh-auto-primary-hover:var(--dsw-alias-button-primary-hover,#34415b);--dsh-auto-on-primary:var(--dsw-alias-label-primary-foreground,#fff);--dsh-auto-danger:var(--dsw-alias-state-error-primary,#ec1313);--dsh-auto-success:var(--dsw-alias-state-success-primary,#22c55e);--dsh-auto-warning:var(--dsw-alias-state-warn-primary,#f59e0b);box-sizing:border-box;max-width:820px;padding-top:12px;display:flex;flex-direction:column;gap:16px;font-family:inherit;color:var(--dsh-auto-text);}",
      "body:not([data-ds-dark-theme]) .dsh-auto-root{color-scheme:light;}",
      "body[data-ds-dark-theme] .dsh-auto-root{color-scheme:dark;}",
      ".dsh-auto-root *,.dsh-auto-root *::before,.dsh-auto-root *::after{box-sizing:border-box;}",
      ".dsh-auto-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
      ".dsh-auto-head h2{margin:0;font-size:18px;font-weight:600;line-height:1.35;}",
      ".dsh-auto-sub{margin:3px 0 0;font-size:12px;line-height:1.5;color:var(--dsh-auto-muted);max-width:540px;}",
      ".dsh-auto-flash{margin:0;padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.45;word-break:break-word;}",
      ".dsh-auto-flash-error{background:color-mix(in srgb,var(--dsh-auto-danger) 12%,transparent);color:var(--dsh-auto-danger);}",
      ".dsh-auto-flash-success{background:color-mix(in srgb,var(--dsh-auto-success) 12%,transparent);color:var(--dsh-auto-success);}",
      ".dsh-auto-flash-warn{background:color-mix(in srgb,var(--dsh-auto-warning) 12%,transparent);color:var(--dsh-auto-warning);}",
      ".dsh-auto-linkbtn{appearance:none;font:inherit;font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer;background:none;border:none;padding:0;}",
      ".dsh-auto-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 12px;border:1px solid var(--dsh-auto-border);border-radius:16px;background:transparent;color:var(--dsh-auto-text);font-family:inherit;font-size:13px;line-height:1.2;cursor:pointer;transition:background .15s ease,color .15s ease,opacity .15s ease;white-space:nowrap;}",
      ".dsh-auto-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.08)));}",
      ".dsh-auto-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsh-auto-border-strong);}",
      ".dsh-auto-btn:disabled{opacity:.4;cursor:default;}",
      ".dsh-auto-btn-primary{background:var(--dsh-auto-primary-fill);border-color:transparent;color:var(--dsh-auto-on-primary);}",
      ".dsh-auto-btn-primary:hover:not(:disabled){background:var(--dsh-auto-primary-hover);}",
      ".dsh-auto-btn-danger,.dsh-auto-btn-danger-ghost{background:transparent;border-color:transparent;color:var(--dsh-auto-danger);}",
      ".dsh-auto-btn-danger:hover:not(:disabled),.dsh-auto-btn-danger-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,color-mix(in srgb,var(--dsh-auto-danger) 10%,transparent));}",
      ".dsh-auto-btn-ghost{border-color:transparent;color:var(--dsh-auto-text-secondary);}",
      ".dsh-auto-input,.dsh-auto-select,.dsh-auto-textarea{width:100%;min-height:34px;padding:6px 10px;border:1px solid var(--dsh-auto-border);border-radius:8px;background:var(--dsh-auto-input-bg);color:var(--dsh-auto-text);font-family:inherit;font-size:13px;line-height:1.5;}",
      ".dsh-auto-input,.dsh-auto-textarea{appearance:none;}",
      ".dsh-auto-input::placeholder,.dsh-auto-textarea::placeholder{color:var(--dsh-auto-caption);}",
      ".dsh-auto-select option{background:var(--dsh-auto-input-bg);color:var(--dsh-auto-text);}",
      ".dsh-auto-input:focus-visible,.dsh-auto-select:focus-visible,.dsh-auto-textarea:focus-visible{outline:none;border-color:var(--dsh-auto-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsh-auto-accent) 18%,transparent);}",
      ".dsh-auto-input:disabled,.dsh-auto-select:disabled,.dsh-auto-textarea:disabled{opacity:1;color:var(--dsh-auto-muted);background:var(--dsh-auto-surface-active);cursor:default;}",
      ".dsh-auto-textarea{resize:vertical;min-height:110px;}",
      ".dsh-auto-check{display:inline-flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;min-height:34px;}",
      ".dsh-auto-check input{width:16px;height:16px;margin:0;accent-color:var(--dsh-auto-accent);cursor:pointer;}",
      ".dsh-auto-form{border:1px solid var(--dsh-auto-border);border-radius:14px;padding:16px;background:var(--dsh-auto-surface);display:flex;flex-direction:column;gap:14px;}",
      ".dsh-auto-form h3{margin:0;font-size:15px;font-weight:600;}",
      ".dsh-auto-formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}",
      ".dsh-auto-field{display:flex;flex-direction:column;gap:4px;min-width:0;}",
      ".dsh-auto-field-full{grid-column:1/-1;}",
      ".dsh-auto-label{font-size:12px;font-weight:500;color:var(--dsh-auto-text-secondary);}",
      ".dsh-auto-required{color:var(--dsh-auto-danger);}",
      ".dsh-auto-hint{margin:0;font-size:11px;line-height:1.45;color:var(--dsh-auto-muted);}",
      ".dsh-auto-formerror{margin:0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsh-auto-danger) 10%,transparent);color:var(--dsh-auto-danger);font-size:12px;line-height:1.45;}",
      ".dsh-auto-formactions{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;}",
      ".dsh-auto-jobs{display:flex;flex-direction:column;gap:10px;}",
      ".dsh-auto-card{border:1px solid var(--dsh-auto-border);border-radius:12px;padding:12px 14px;background:var(--dsh-auto-surface);display:flex;flex-direction:column;gap:10px;}",
      ".dsh-auto-card-disabled{background:var(--dsh-auto-surface-active);}",
      ".dsh-auto-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
      ".dsh-auto-card-title{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0;}",
      ".dsh-auto-card-title h3{margin:0;font-size:14px;font-weight:600;overflow-wrap:anywhere;}",
      ".dsh-auto-card-id{font-size:11px;color:var(--dsh-auto-muted);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
      ".dsh-auto-card-meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--dsh-auto-text-secondary);line-height:1.5;}",
      ".dsh-auto-card-meta span{white-space:nowrap;}",
      ".dsh-auto-next{font-variant-numeric:tabular-nums;}",
      ".dsh-auto-muted{color:var(--dsh-auto-muted);}",
      ".dsh-auto-card-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
      ".dsh-auto-confirm{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;}",
      ".dsh-auto-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--dsh-auto-text-secondary);user-select:none;}",
      ".dsh-auto-switch input{position:absolute;opacity:0;width:1px;height:1px;margin:0;}",
      ".dsh-auto-switch-track{position:relative;width:32px;height:18px;border-radius:9px;background:var(--dsh-auto-caption);transition:background .15s ease;flex:none;}",
      ".dsh-auto-switch-track::after{content:\"\";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsh-auto-input-bg);box-shadow:0 1px 2px rgba(0,0,0,.22);transition:transform .15s ease;}",
      ".dsh-auto-switch input:checked+.dsh-auto-switch-track{background:var(--dsh-auto-accent);}",
      ".dsh-auto-switch input:checked+.dsh-auto-switch-track::after{transform:translateX(14px);background:#fff;}",
      ".dsh-auto-switch input:focus-visible+.dsh-auto-switch-track{outline:2px solid var(--dsh-auto-accent);outline-offset:2px;}",
      ".dsh-auto-switch input:disabled~.dsh-auto-switch-text{opacity:.6;}",
      ".dsh-auto-switch:has(input:disabled){cursor:default;}",
      ".dsh-auto-runs{border-top:1px solid var(--dsh-auto-border);padding-top:14px;display:flex;flex-direction:column;gap:10px;min-width:0;}",
      ".dsh-auto-runs h3{margin:0;font-size:14px;font-weight:600;}",
      ".dsh-auto-runlist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto;}",
      ".dsh-auto-run{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:8px 10px;border:1px solid var(--dsh-auto-border);border-radius:10px;background:var(--dsh-auto-surface);font-size:12px;line-height:1.4;}",
      ".dsh-auto-run-active{border-color:var(--dsh-auto-accent);}",
      ".dsh-auto-run-name{font-weight:500;color:var(--dsh-auto-text);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsh-auto-run-meta{color:var(--dsh-auto-muted);font-variant-numeric:tabular-nums;}",
      ".dsh-auto-run-dur{color:var(--dsh-auto-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;}",
      ".dsh-auto-run-error{color:var(--dsh-auto-danger);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsh-auto-run-skip{color:var(--dsh-auto-muted);}",
      ".dsh-auto-run-session{color:var(--dsh-auto-muted);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;}",
      ".dsh-auto-run-more{color:var(--dsh-auto-muted);font-size:11px;padding:2px 4px;}",
      ".dsh-auto-status{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;text-transform:capitalize;white-space:nowrap;}",
      ".dsh-auto-status::before{content:\"\";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none;}",
      ".dsh-auto-status-queued{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsh-auto-muted);}",
      ".dsh-auto-status-running{background:color-mix(in srgb,var(--dsh-auto-accent) 14%,transparent);color:var(--dsh-auto-accent);}",
      ".dsh-auto-status-running::before{animation:dsh-auto-pulse 1.1s ease-in-out infinite;}",
      ".dsh-auto-status-succeeded{background:color-mix(in srgb,var(--dsh-auto-success) 14%,transparent);color:var(--dsh-auto-success);}",
      ".dsh-auto-status-failed,.dsh-auto-status-timed-out{background:color-mix(in srgb,var(--dsh-auto-danger) 14%,transparent);color:var(--dsh-auto-danger);}",
      ".dsh-auto-status-cancelled,.dsh-auto-status-skipped,.dsh-auto-status-interrupted{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsh-auto-muted);}",
      "@keyframes dsh-auto-pulse{0%,100%{opacity:1}50%{opacity:.35}}",
      ".dsh-auto-empty,.dsh-auto-loading,.dsh-auto-error{padding:22px 16px;text-align:center;border:1px dashed var(--dsh-auto-border);border-radius:12px;font-size:13px;color:var(--dsh-auto-text-secondary);}",
      ".dsh-auto-error{color:var(--dsh-auto-danger);display:flex;flex-direction:column;gap:10px;align-items:center;}",
      "@media (max-width:640px){.dsh-auto-overlay-panel{max-width:calc(100vw - 16px);height:calc(100vh - 16px);border-radius:16px;}.dsh-auto-overlay-header{height:46px;padding:8px 10px;}.dsh-auto-overlay-body{padding:0 16px 16px;}.dsh-auto-formgrid{grid-template-columns:1fr;}.dsh-auto-card-head{flex-direction:column;align-items:flex-start;}.dsh-auto-run-name{max-width:150px;}}",
    ].join("\n");

    function apply(ctx) {
      const disclosure = createDisclosureStore();
      // All package-owned surfaces share one style element and one disclosure
      // store; both are released with the client-plugin fiber.
      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.setAttribute("data-plugin", "@syncended/dsh-automations");
        tag.textContent = STYLE_CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, "@syncended/dsh-automations: client styles");
      ctx.effect(() => () => disclosure.dispose(), "@syncended/dsh-automations: disclosure store");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "automations",
        order: 25,
        label: "Automations",
      }, AutomationsSection));
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "automations",
        order: 50,
        label: "Automations",
        inject: () => ({ disclosure }),
      }, AutomationsSidebarAction));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay",
        id: "automations",
        order: 50,
        label: "Automations",
        inject: () => ({ disclosure }),
      }, AutomationsOverlay));
    }

    exports.agentPresetDisplayLabel = agentPresetDisplayLabel;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
