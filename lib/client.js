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
    const { createPortal } = require("react-dom");
    const h = React.createElement;
    const { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } = React;
    const {
      Button,
      Menu,
      Pill,
      RiskConfirmation,
      IconAgentPresetOutline16,
      IconBrowseOutline16,
      IconCheckOutline16,
      IconChevronDownOutline14,
      IconChevronLeftOutline14,
      IconEditOutline16,
      IconFolderClose16,
      IconGlobeOutline14,
      IconPlayOutline16,
      IconPlusOutline16,
      IconRefreshOutline16,
      IconSettingsOutline16,
      IconThinkOutline14,
      IconTrashOutline16,
      IconWarningOutline16,
    } = require("@deepseek-ai/dsh-client-ui-primitives");
    const inject = ["slots", "workspaces", "sessions"];

    const API_PREFIX = "/api/automations";
    const POLL_MS = 5000;
    const HISTORY_BADGE_POLL_MS = 30000;
    const HISTORY_SHOWN = 25;
    const DEFAULT_CRON = "0 9 * * 1-5";
    const DEFAULT_TIMEOUT_MS = 3600000;
    const MIN_TIMEOUT_MS = 1000;
    const MAX_TIMEOUT_MS = 86400000;
    const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
    const SCHEDULE_MODES = [
      { id: "minutes", label: "Minutes" },
      { id: "hourly", label: "Hourly" },
      { id: "daily", label: "Daily" },
      { id: "weekdays", label: "Weekdays" },
      { id: "weekly", label: "Weekly" },
      { id: "custom", label: "Custom" },
    ];
    const MINUTE_INTERVALS = [5, 10, 15, 20, 30];
    const HOURLY_MINUTES = Array.from({ length: 60 }, (_, index) => index);
    const WEEKDAYS = [
      { value: "1", label: "Monday" },
      { value: "2", label: "Tuesday" },
      { value: "3", label: "Wednesday" },
      { value: "4", label: "Thursday" },
      { value: "5", label: "Friday" },
      { value: "6", label: "Saturday" },
      { value: "0", label: "Sunday" },
    ];
    const CRON_FIELD_GUIDE = [
      { label: "Minute", range: "0–59" },
      { label: "Hour", range: "0–23" },
      { label: "Day", range: "1–31" },
      { label: "Month", range: "1–12" },
      { label: "Weekday", range: "0–7" },
    ];
    let formInstanceSerial = 0;

    const BROWSER_TIMEZONE = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        return "UTC";
      }
    })();

    const POPULAR_TIMEZONE_CANDIDATES = [
      BROWSER_TIMEZONE,
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "America/Sao_Paulo",
      "Europe/London",
      "Europe/Berlin",
      "Europe/Moscow",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Shanghai",
      "Asia/Tokyo",
      "Australia/Sydney",
    ];
    const PREFERRED_TIMEZONE_ALIASES = [
      "Africa/Asmara",
      "America/Argentina/Buenos_Aires",
      "America/Atikokan",
      "America/Indiana/Indianapolis",
      "America/Kentucky/Louisville",
      "America/Nuuk",
      "Asia/Ho_Chi_Minh",
      "Asia/Kathmandu",
      "Asia/Kolkata",
      "Asia/Yangon",
      "Atlantic/Faroe",
      "Europe/Kyiv",
      "Pacific/Chuuk",
      "Pacific/Kanton",
      "Pacific/Pohnpei",
    ];
    const TIMEZONE_ALIASES_BY_ZONE = new Map();
    for (const alias of PREFERRED_TIMEZONE_ALIASES) {
      const zone = canonicalTimezone(alias);
      if (!zone || zone === alias) continue;
      const aliases = TIMEZONE_ALIASES_BY_ZONE.get(zone) || [];
      aliases.push(alias);
      TIMEZONE_ALIASES_BY_ZONE.set(zone, aliases);
    }
    const POPULAR_TIMEZONES = Array.from(
      new Set(POPULAR_TIMEZONE_CANDIDATES.map(canonicalTimezone).filter(Boolean)),
    );
    const SUPPORTED_TIMEZONES = (() => {
      let discovered = [];
      try {
        discovered = typeof Intl.supportedValuesOf === "function"
          ? Intl.supportedValuesOf("timeZone")
          : [];
      } catch {
        discovered = [];
      }
      return Array.from(
        new Set([
          ...POPULAR_TIMEZONES,
          ...TIMEZONE_ALIASES_BY_ZONE.keys(),
          ...discovered.filter((zone) => typeof zone === "string" && zone !== ""),
        ]),
      ).sort((left, right) => left.localeCompare(right));
    })();
    const TIMEZONE_SEARCH_INDEX = SUPPORTED_TIMEZONES.map((zone) => {
      const aliases = TIMEZONE_ALIASES_BY_ZONE.get(zone) || [];
      const preferred = aliases[0] || zone;
      return {
        zone,
        city: timezoneCityLabel(preferred),
        search: timezoneSearchKey([zone, ...aliases].join(" ")),
      };
    });

    const MODEL_METADATA_CACHE = new Map();
    const COMMON_EFFORT_FALLBACKS = [
      { id: "off", name: "Off", description: "Disable extended reasoning when the adapter supports it." },
      { id: "minimal", name: "Minimal", description: "Use the lightest available reasoning level." },
      { id: "low", name: "Low", description: "Use a lower-cost reasoning level." },
      { id: "medium", name: "Medium", description: "Use a balanced reasoning level." },
      { id: "high", name: "High", description: "Use a deeper reasoning level." },
      { id: "max", name: "Max", description: "Use the strongest available reasoning level." },
    ];
    const EMPTY_WORKSPACE_SNAPSHOT = Object.freeze({
      items: Object.freeze([]),
      state: "idle",
      phase: "pending",
      error: null,
    });
    const OVERLAP_OPTIONS = [
      { value: "skip", label: "Skip the new run", hint: "Skip the run if a previous run is still active." },
      { value: "queue", label: "Queue the next run", hint: "Defer the run until the previous run finishes." },
      { value: "allow", label: "Allow concurrent runs", hint: "Run concurrently with any active run." },
    ];
    const MISFIRE_OPTIONS = [
      { value: "skip", label: "Skip missed runs", hint: "Drop occurrences that were missed while the scheduler was down." },
      { value: "run-once", label: "Run once after downtime", hint: "Run once after downtime for the latest missed occurrence." },
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
    const PERMISSION_PRESET_PRESENTATION = {
      "read-only": {
        label: "Read Only",
        detail: "Read files without modifying the workspace.",
        icon: IconBrowseOutline16,
        tone: "read",
      },
      "workspace-write": {
        label: "Workspace Write",
        detail: "Write inside the workspace; wider retries require approval.",
        icon: IconEditOutline16,
        tone: "write",
      },
      "danger-full-access": {
        label: "Full access",
        detail: "Full file access without approval prompts.",
        icon: IconWarningOutline16,
        tone: "danger",
      },
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

    function permissionPresetPresentation(value) {
      const known = PERMISSION_PRESET_PRESENTATION[value];
      if (known) return known;
      return {
        label: humanizePresetId(value) || value || "Unknown permission",
        detail: "Host-provided permission preset.",
        icon: IconSettingsOutline16,
        tone: "custom",
      };
    }

    function PermissionPresetIcon({ value, className }) {
      const presentation = permissionPresetPresentation(value);
      return h(presentation.icon, {
        className: (className ? className + " " : "") + "dsh-auto-permission-glyph dsh-auto-permission-glyph-" + presentation.tone,
      });
    }

    function canonicalTimezone(value) {
      const timezone = String(value || "").trim();
      if (timezone === "") return null;
      try {
        return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
      } catch {
        return null;
      }
    }

    function timezoneCityLabel(zone) {
      if (zone === "UTC") return "UTC";
      const segments = zone.split("/");
      return (segments[segments.length - 1] || zone).replace(/_/g, " ");
    }

    function timezonePreferredValue(zone) {
      return TIMEZONE_ALIASES_BY_ZONE.get(zone)?.[0] || zone;
    }

    function timezoneSearchKey(zone) {
      const literal = zone.toLowerCase();
      const expanded = literal
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\/_\-.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return expanded;
    }

    function timezoneOffsetLabel(zone, at = new Date()) {
      try {
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          timeZoneName: "longOffset",
          hour: "2-digit",
        });
        const value = formatter.formatToParts(at).find((part) => part.type === "timeZoneName")?.value;
        if (!value) return "UTC offset unavailable";
        if (value === "GMT") return "UTC+00:00";
        return value.replace(/^GMT/, "UTC");
      } catch {
        return "UTC offset unavailable";
      }
    }

    function timezoneSearchResults(query, currentValue, limit = 30) {
      const rawQuery = String(query || "").trim().toLowerCase();
      const current = canonicalTimezone(currentValue);
      if (rawQuery === "") {
        return Array.from(
          new Set([current, BROWSER_TIMEZONE, ...POPULAR_TIMEZONES].filter(Boolean)),
        ).slice(0, 12);
      }
      const normalizedQuery = timezoneSearchKey(rawQuery);
      if (normalizedQuery === "") return [];
      const terms = normalizedQuery.split(" ").filter(Boolean);
      return TIMEZONE_SEARCH_INDEX
        .filter((entry) => terms.every((term) => entry.search.includes(term)))
        .map((entry) => {
          const canonical = entry.zone.toLowerCase();
          const preferred = timezonePreferredValue(entry.zone).toLowerCase();
          const city = timezoneSearchKey(entry.city);
          let score = 5;
          if (canonical === rawQuery || preferred === rawQuery) score = 0;
          else if (city === normalizedQuery) score = 1;
          else if (city.startsWith(normalizedQuery)) score = 2;
          else if (canonical.split("/").some((segment) => timezoneSearchKey(segment).startsWith(normalizedQuery))) score = 3;
          else if (entry.search.startsWith(normalizedQuery)) score = 4;
          return { ...entry, score };
        })
        .sort((left, right) => left.score - right.score || left.city.localeCompare(right.city) || left.zone.localeCompare(right.zone))
        .slice(0, limit)
        .map((entry) => entry.zone);
    }

    function comboboxSearchResults(options, query, limit = 30) {
      const rawQuery = String(query || "").trim().toLowerCase();
      if (rawQuery === "") return options.slice(0, limit);
      const normalizedQuery = timezoneSearchKey(rawQuery);
      if (normalizedQuery === "") return [];
      const terms = normalizedQuery.split(" ").filter(Boolean);
      return options
        .map((option, order) => {
          const identifier = String(option.value ?? option.id).toLowerCase();
          const label = timezoneSearchKey(option.label || "");
          const search = timezoneSearchKey(
            [option.label, option.detail, option.value, ...(option.aliases || [])].filter(Boolean).join(" "),
          );
          if (!terms.every((term) => search.includes(term))) return null;
          let score = option.custom ? 6 : 5;
          if (identifier === rawQuery) score = 0;
          else if (label === normalizedQuery) score = 1;
          else if (!option.custom && label.startsWith(normalizedQuery)) score = 2;
          else if (!option.custom && identifier.split(/[\/:._-]+/).some((segment) => segment.startsWith(rawQuery))) score = 3;
          else if (!option.custom && search.startsWith(normalizedQuery)) score = 4;
          return { option, order, score };
        })
        .filter(Boolean)
        .sort((left, right) => left.score - right.score || left.order - right.order)
        .slice(0, limit)
        .map((entry) => entry.option);
    }

    function timezoneNavigationIndex(key, current, resultCount, reopening) {
      if (resultCount === 0) return -1;
      if (reopening) return key === "ArrowDown" ? 0 : resultCount - 1;
      if (key === "ArrowDown") return current < 0 || current >= resultCount - 1 ? 0 : current + 1;
      return current <= 0 ? resultCount - 1 : current - 1;
    }

    function timezoneOptionPresentation(zone, offsetCache) {
      let offset = offsetCache?.get(zone);
      if (!offset) {
        offset = timezoneOffsetLabel(zone);
        offsetCache?.set(zone, offset);
      }
      const current = BROWSER_TIMEZONE === zone;
      const preferred = timezonePreferredValue(zone);
      if (zone === "UTC") {
        return {
          label: "UTC",
          detail: offset + " now · Coordinated Universal Time" + (current ? " · Your browser time zone" : ""),
        };
      }
      return {
        label: timezoneCityLabel(preferred),
        detail: preferred + " · " + offset + " now" + (current ? " · Your browser time zone" : ""),
      };
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

    function overlapPolicySummary(value) {
      if (value === "queue") return "Queue overlaps";
      if (value === "allow") return "Allow concurrent runs";
      return "Skip overlaps";
    }

    function inferFormErrorField(message) {
      const text = String(message || "").toLowerCase();
      if (text.includes("job id")) return "id";
      if (text.includes("timeout")) return "timeout";
      if (text.includes("overlap")) return "overlap";
      if (text.includes("misfire")) return "misfire";
      if (text.includes("cron")) return "cron";
      if (text.includes("timezone") || text.includes("time zone")) return "timezone";
      if (text.includes("workspace")) return "cwd";
      if (text.includes("prompt")) return "prompt";
      if (text.includes("reasoning effort")) return "effort";
      if (text.includes("agent preset")) return "preset";
      if (text.includes("permission")) return "permission";
      if (text.includes("model") || text.includes("provider")) return "model";
      if (text.includes("name")) return "name";
      return null;
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
        if (error && error.name === "AbortError") throw error;
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

    function cronFields(value) {
      return String(value || "").trim().split(/\s+/).filter(Boolean);
    }

    function twoDigits(value) {
      return String(value).padStart(2, "0");
    }

    function simpleSchedule(cronValue) {
      const cron = cronFields(cronValue).join(" ");
      let match = cron.match(/^\*\/(5|10|15|20|30) \* \* \* \*$/);
      if (match) return { mode: "minutes", interval: Number(match[1]), minute: 0, hour: 9, weekday: "1" };
      match = cron.match(/^(\d{1,2}) \* \* \* \*$/);
      if (match && Number(match[1]) <= 59) {
        return { mode: "hourly", minute: Number(match[1]), hour: 9, weekday: "1", interval: 15 };
      }
      match = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* 1-5$/);
      if (match && Number(match[1]) <= 59 && Number(match[2]) <= 23) {
        return { mode: "weekdays", minute: Number(match[1]), hour: Number(match[2]), weekday: "1", interval: 15 };
      }
      match = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-7])$/);
      if (match && Number(match[1]) <= 59 && Number(match[2]) <= 23) {
        return {
          mode: "weekly",
          minute: Number(match[1]),
          hour: Number(match[2]),
          weekday: match[3] === "7" ? "0" : match[3],
          interval: 15,
        };
      }
      match = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
      if (match && Number(match[1]) <= 59 && Number(match[2]) <= 23) {
        return { mode: "daily", minute: Number(match[1]), hour: Number(match[2]), weekday: "1", interval: 15 };
      }
      return { mode: "custom", minute: 0, hour: 9, weekday: "1", interval: 15 };
    }

    function scheduleControlValues(cronValue, fallback = {}) {
      const fields = cronFields(cronValue);
      const minute = /^\d{1,2}$/.test(fields[0] || "") && Number(fields[0]) <= 59
        ? Number(fields[0])
        : Number.isInteger(fallback.minute) ? fallback.minute : 0;
      const hour = /^\d{1,2}$/.test(fields[1] || "") && Number(fields[1]) <= 23
        ? Number(fields[1])
        : Number.isInteger(fallback.hour) ? fallback.hour : 9;
      const normalizedWeekday = fields[4] === "7" ? "0" : fields[4];
      const weekday = WEEKDAYS.some((day) => day.value === normalizedWeekday)
        ? normalizedWeekday
        : WEEKDAYS.some((day) => day.value === String(fallback.weekday)) ? String(fallback.weekday) : "1";
      const intervalMatch = /^\*\/(\d+)$/.exec(fields[0] || "");
      const parsedInterval = intervalMatch ? Number(intervalMatch[1]) : NaN;
      const interval = MINUTE_INTERVALS.includes(parsedInterval)
        ? parsedInterval
        : MINUTE_INTERVALS.includes(fallback.interval) ? fallback.interval : 15;
      return { minute, hour, weekday, interval };
    }

    function cronForSimpleSchedule(mode, values = {}) {
      const minute = Number.isInteger(values.minute) && values.minute >= 0 && values.minute <= 59 ? values.minute : 0;
      const hour = Number.isInteger(values.hour) && values.hour >= 0 && values.hour <= 23 ? values.hour : 9;
      const interval = MINUTE_INTERVALS.includes(values.interval) ? values.interval : 15;
      const weekday = WEEKDAYS.some((day) => day.value === String(values.weekday)) ? String(values.weekday) : "1";
      if (mode === "minutes") return "*/" + interval + " * * * *";
      if (mode === "hourly") return minute + " * * * *";
      if (mode === "daily") return minute + " " + hour + " * * *";
      if (mode === "weekdays") return minute + " " + hour + " * * 1-5";
      if (mode === "weekly") return minute + " " + hour + " * * " + weekday;
      return null;
    }

    function scheduleModeTransition(mode, cron, values, customCron) {
      if (mode === "custom") {
        const restored = customCron === null ? cron : customCron;
        return { cron: restored, customCron: restored };
      }
      return {
        cron: cronForSimpleSchedule(mode, values) || cron,
        customCron,
      };
    }

    function describeSimpleSchedule(schedule, timezone) {
      const time = twoDigits(schedule.hour) + ":" + twoDigits(schedule.minute);
      const zone = timezone.trim() || "the selected time zone";
      if (schedule.mode === "minutes") return "Every " + schedule.interval + " minutes · " + zone;
      if (schedule.mode === "hourly") return "Every hour at :" + twoDigits(schedule.minute) + " · " + zone;
      if (schedule.mode === "daily") return "Every day at " + time + " · " + zone;
      if (schedule.mode === "weekdays") return "Monday–Friday at " + time + " · " + zone;
      if (schedule.mode === "weekly") {
        const day = WEEKDAYS.find((entry) => entry.value === schedule.weekday)?.label || "Monday";
        return "Every " + day + " at " + time + " · " + zone;
      }
      return cronFields(schedule.cron).length === 5
        ? "Custom five-field schedule · " + zone
        : "Cron needs exactly five fields · " + zone;
    }

    function FormSection({ title, description, Icon, children, className = "" }) {
      return h(
        "section",
        { className: "dsh-auto-form-section" + (className ? " " + className : "") },
        h(
          "header",
          { className: "dsh-auto-form-section-head" },
          Icon ? h("span", { className: "dsh-auto-form-section-icon", "aria-hidden": "true" }, h(Icon)) : null,
          h(
            "span",
            { className: "dsh-auto-form-section-copy" },
            h("h4", { className: "dsh-auto-form-section-title" }, title),
            description ? h("p", { className: "dsh-auto-form-section-description" }, description) : null,
          ),
        ),
        children,
      );
    }

    function CronFieldGuide({ value }) {
      const fields = cronFields(value);
      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "dsh-auto-cron-guide", "aria-label": "Cron field order" },
          CRON_FIELD_GUIDE.map((field, index) => h(
            "span",
            { key: field.label, className: "dsh-auto-cron-guide-field" },
            h("code", { className: "dsh-auto-cron-guide-value" }, fields[index] || "—"),
            h("span", { className: "dsh-auto-cron-guide-label" }, field.label),
            h("span", { className: "dsh-auto-cron-guide-range" }, field.range),
          )),
        ),
        h("p", { className: "dsh-auto-cron-syntax" }, "* any value · , list · - range · / step"),
      );
    }

    function ScheduleEditor({ fieldId, cron, timezone, onCronChange, onTimezoneChange }) {
      const detected = simpleSchedule(cron);
      const [forceCustom, setForceCustom] = useState(false);
      const [values, setValues] = useState(() => scheduleControlValues(cron));
      const customCronRef = useRef(detected.mode === "custom" ? cron : null);
      const customCronPinnedRef = useRef(detected.mode === "custom");
      const activeMode = forceCustom || detected.mode === "custom" ? "custom" : detected.mode;
      const applySimpleValues = (mode, nextValues) => {
        setValues(nextValues);
        const expression = cronForSimpleSchedule(mode, nextValues);
        if (expression !== null) onCronChange(expression);
      };
      const setMode = (mode) => {
        if (mode !== "custom" && !customCronPinnedRef.current) customCronRef.current = null;
        const transition = scheduleModeTransition(mode, cron, values, customCronRef.current);
        customCronRef.current = transition.customCron;
        setForceCustom(mode === "custom");
        if (transition.cron !== cron) onCronChange(transition.cron);
      };
      const setTime = (raw) => {
        const match = /^(\d{2}):(\d{2})$/.exec(raw);
        if (!match) return;
        applySimpleValues(activeMode, Object.assign({}, values, {
          hour: Number(match[1]),
          minute: Number(match[2]),
        }));
      };
      const summarySchedule = Object.assign({}, values, { mode: activeMode, cron });
      const displayedCron = cronFields(cron).join(" ") || "—";

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "dsh-auto-schedule-modes dsh-auto-field-full", role: "group", "aria-label": "Schedule frequency" },
          SCHEDULE_MODES.map((mode) => h(
            Pill,
            {
              key: mode.id,
              type: "button",
              active: activeMode === mode.id,
              "aria-pressed": activeMode === mode.id,
              onClick: () => setMode(mode.id),
            },
            mode.label,
          )),
        ),
        activeMode === "minutes"
          ? h(
              Field,
              { label: "Interval", htmlFor: fieldId("interval") },
              h(
                "select",
                {
                  id: fieldId("interval"),
                  className: "dsh-auto-select",
                  value: values.interval,
                  onChange: (event) => applySimpleValues("minutes", Object.assign({}, values, { interval: Number(event.target.value) })),
                },
                MINUTE_INTERVALS.map((minutes) => h("option", { key: minutes, value: minutes }, "Every " + minutes + " minutes")),
              ),
            )
          : null,
        activeMode === "hourly"
          ? h(
              Field,
              { label: "Minute past the hour", htmlFor: fieldId("hour-minute") },
              h(
                "select",
                {
                  id: fieldId("hour-minute"),
                  className: "dsh-auto-select",
                  value: values.minute,
                  onChange: (event) => applySimpleValues("hourly", Object.assign({}, values, { minute: Number(event.target.value) })),
                },
                HOURLY_MINUTES.map((minute) => h("option", { key: minute, value: minute }, ":" + twoDigits(minute))),
              ),
            )
          : null,
        ["daily", "weekdays", "weekly"].includes(activeMode)
          ? h(
              Field,
              { label: "Time", htmlFor: fieldId("schedule-time") },
              h("input", {
                id: fieldId("schedule-time"),
                className: "dsh-auto-input",
                type: "time",
                value: twoDigits(values.hour) + ":" + twoDigits(values.minute),
                onChange: (event) => setTime(event.target.value),
              }),
            )
          : null,
        activeMode === "weekly"
          ? h(
              Field,
              { label: "Day", htmlFor: fieldId("schedule-day") },
              h(
                "select",
                {
                  id: fieldId("schedule-day"),
                  className: "dsh-auto-select",
                  value: values.weekday,
                  onChange: (event) => applySimpleValues("weekly", Object.assign({}, values, { weekday: event.target.value })),
                },
                WEEKDAYS.map((day) => h("option", { key: day.value, value: day.value }, day.label)),
              ),
            )
          : null,
        h(
          Field,
          {
            label: "Time zone",
            htmlFor: fieldId("timezone"),
            required: true,
            full: activeMode === "weekly" || activeMode === "custom",
            hint: "Current UTC offsets and daylight-saving changes are handled by the selected IANA time zone.",
          },
          h(TimeZonePicker, {
            id: fieldId("timezone"),
            value: timezone,
            onChange: onTimezoneChange,
          }),
        ),
        activeMode === "custom"
          ? h(
              Field,
              {
                label: "Cron expression",
                htmlFor: fieldId("cron"),
                required: true,
                full: true,
                hint: "Five fields only. Seconds and hashed H expressions are not supported.",
              },
              h("input", {
                id: fieldId("cron"),
                className: "dsh-auto-input dsh-auto-cron-input",
                type: "text",
                value: cron,
                spellCheck: false,
                placeholder: "0 9 * * 1-5",
                onChange: (event) => {
                  const nextCron = event.target.value;
                  customCronRef.current = nextCron;
                  customCronPinnedRef.current = true;
                  setValues(scheduleControlValues(nextCron, values));
                  setForceCustom(true);
                  onCronChange(nextCron);
                },
              }),
              h(CronFieldGuide, { value: cron }),
            )
          : null,
        h(
          "div",
          { className: "dsh-auto-schedule-summary dsh-auto-field-full" },
          h("span", { className: "dsh-auto-schedule-summary-copy" }, describeSimpleSchedule(summarySchedule, timezone)),
          h("code", { className: "dsh-auto-schedule-expression", title: displayedCron }, displayedCron),
        ),
      );
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

    function pickerMenuFor(ownerId) {
      return Array.from(document.querySelectorAll('[role="menu"]')).find((menu) =>
        Array.from(menu.querySelectorAll("[data-dsh-auto-picker-owner]")).some((item) =>
          item.getAttribute("data-dsh-auto-picker-owner") === ownerId,
        ),
      ) || null;
    }

    function focusPickerTrigger(triggerRef) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }

    function focusAfterPickerTab(trigger, backwards) {
      requestAnimationFrame(() => {
        const focusBoundary = trigger?.closest(".dsh-auto-form") || trigger?.closest('[role="dialog"]');
        if (!focusBoundary) {
          trigger?.focus();
          return;
        }
        const focusables = visibleFocusables(focusBoundary);
        const index = focusables.indexOf(trigger);
        const target = index < 0 ? trigger : focusables[index + (backwards ? -1 : 1)];
        (target || trigger)?.focus();
      });
    }

    function usePickerMenuNavigation({ open, setOpen, ownerId, selectedId, triggerRef }) {
      useEffect(() => {
        if (!open) return;
        const focusSelected = () => {
          const menu = pickerMenuFor(ownerId);
          if (!menu) return;
          const buttons = Array.from(menu.querySelectorAll('button[role="menuitem"]:not(:disabled)'));
          const selected = buttons.find((button) =>
            button.querySelector("[data-dsh-auto-picker-item]")?.getAttribute("data-dsh-auto-picker-item") === selectedId,
          );
          (selected || buttons[0])?.focus();
        };
        const frame = requestAnimationFrame(focusSelected);
        const onKeyDown = (event) => {
          const menu = pickerMenuFor(ownerId);
          if (!menu || !(event.target instanceof Node) || !menu.contains(event.target)) return;
          const buttons = Array.from(menu.querySelectorAll('button[role="menuitem"]:not(:disabled)'));
          const index = buttons.indexOf(event.target.closest('button[role="menuitem"]'));
          let target;
          if (event.key === "ArrowDown") target = buttons[(Math.max(index, -1) + 1) % buttons.length];
          else if (event.key === "ArrowUp") target = buttons[(index <= 0 ? buttons.length : index) - 1];
          else if (event.key === "Home") target = buttons[0];
          else if (event.key === "End") target = buttons[buttons.length - 1];
          else if (event.key === "Escape") {
            event.preventDefault();
            event.stopImmediatePropagation();
            setOpen(false);
            focusPickerTrigger(triggerRef);
            return;
          } else if (event.key === "Tab") {
            event.preventDefault();
            event.stopImmediatePropagation();
            setOpen(false);
            focusAfterPickerTab(triggerRef.current, event.shiftKey);
            return;
          } else return;
          if (!target) return;
          event.preventDefault();
          target.focus();
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
          cancelAnimationFrame(frame);
          document.removeEventListener("keydown", onKeyDown, true);
        };
      }, [open, ownerId, selectedId, setOpen, triggerRef]);
    }

    function openPickerFromKeyboard(event, setOpen) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      setOpen(true);
    }

    function useRiskConfirmationFocus(open) {
      useEffect(() => {
        if (!open) return;
        const riskDialog = () => Array.from(document.querySelectorAll('[role="dialog"]')).find((dialog) =>
          dialog.getAttribute("aria-label") === "Enable Full access?",
        ) || null;
        let innerFrame;
        const frame = requestAnimationFrame(() => {
          innerFrame = requestAnimationFrame(() => {
            riskDialog()?.querySelector('input[type="checkbox"]')?.focus();
          });
        });
        const onKeyDown = (event) => {
          const dialog = riskDialog();
          if (!dialog) return;
          if (event.key === "Escape" && dialog.contains(event.target)) {
            event.__dshAutomationsNested = true;
            return;
          }
          if (event.key !== "Tab") return;
          const focusables = visibleFocusables(dialog);
          if (focusables.length === 0) return;
          const index = focusables.indexOf(event.target);
          const next = event.shiftKey
            ? focusables[index <= 0 ? focusables.length - 1 : index - 1]
            : focusables[index < 0 || index === focusables.length - 1 ? 0 : index + 1];
          event.preventDefault();
          event.stopImmediatePropagation();
          next.focus();
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
          cancelAnimationFrame(frame);
          if (innerFrame !== undefined) cancelAnimationFrame(innerFrame);
          document.removeEventListener("keydown", onKeyDown, true);
        };
      }, [open]);
    }

    function PickerItemCopy({ label, detail, ownerId, itemId }) {
      return h(
        "span",
        {
          className: "dsh-auto-picker-item-copy",
          "data-dsh-auto-picker-owner": ownerId,
          "data-dsh-auto-picker-item": itemId,
        },
        h("span", { className: "dsh-auto-picker-item-label" }, label),
        detail ? h("span", { className: "dsh-auto-picker-item-detail" }, detail) : null,
      );
    }

    function useComboboxPopoverLayout(open, anchorRef, panelRef) {
      const [layout, setLayout] = useState(null);
      useEffect(() => {
        if (!open) {
          setLayout(null);
          return undefined;
        }
        const place = () => {
          const anchor = anchorRef.current;
          if (!anchor) return;
          const rect = anchor.getBoundingClientRect();
          const panel = panelRef.current;
          const margin = 12;
          const gap = 4;
          const width = Math.min(Math.max(rect.width, 280), window.innerWidth - margin * 2);
          const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
          const desiredHeight = Math.min(360, panel?.scrollHeight || 360);
          const below = window.innerHeight - rect.bottom - gap - margin;
          const above = rect.top - gap - margin;
          const side = below >= Math.min(desiredHeight, 220) || below >= above ? "bottom" : "top";
          const available = Math.max(80, side === "bottom" ? below : above);
          const maxHeight = Math.min(360, available);
          const renderedHeight = Math.min(panel?.offsetHeight || desiredHeight, maxHeight);
          const top = side === "bottom"
            ? rect.bottom + gap
            : Math.max(margin, rect.top - gap - renderedHeight);
          setLayout((current) => {
            const next = { left, top, width, maxHeight, side };
            return current
              && current.left === next.left
              && current.top === next.top
              && current.width === next.width
              && current.maxHeight === next.maxHeight
              && current.side === next.side
              ? current
              : next;
          });
        };
        const frame = requestAnimationFrame(place);
        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
        if (anchorRef.current) observer?.observe(anchorRef.current);
        if (panelRef.current) observer?.observe(panelRef.current);
        return () => {
          cancelAnimationFrame(frame);
          observer?.disconnect();
          window.removeEventListener("scroll", place, true);
          window.removeEventListener("resize", place);
        };
      }, [open, anchorRef, panelRef]);
      return layout;
    }

    function EditableCombobox(props) {
      const {
        id,
        value,
        displayValue,
        onChange,
        onInputChange = onChange,
        optionsForQuery,
        selectedId,
        commitExactValue,
        placeholder,
        Icon,
        listboxLabel,
        initialTitle,
        searchTitle,
        emptyText,
        hintText,
        resultNoun,
        invalidMessage,
        invalid = false,
        disabled = false,
        commitOnBlur = false,
        notifySameValue = false,
        resumeSearch: resumeSearchProp,
        panelNotice = null,
        onOpen,
        onCancel,
      } = props;
      const [open, setOpen] = useState(false);
      const [searching, setSearching] = useState(false);
      const [activeIndex, setActiveIndex] = useState(-1);
      const [announcement, setAnnouncement] = useState("");
      const anchorRef = useRef(null);
      const inputRef = useRef(null);
      const panelRef = useRef(null);
      const listboxId = id + "-options";
      const query = searching ? value : "";
      const results = optionsForQuery(query);
      const active = activeIndex >= 0 && activeIndex < results.length ? activeIndex : -1;
      const resumeSearch = resumeSearchProp === undefined
        ? value.trim() !== "" && selectedId === null
        : resumeSearchProp;
      const popoverLayout = useComboboxPopoverLayout(open, anchorRef, panelRef);
      const close = () => {
        setOpen(false);
        setSearching(false);
        setActiveIndex(-1);
        setAnnouncement("");
      };
      const show = () => {
        setAnnouncement("");
        setOpen(true);
        onOpen?.();
      };
      const choose = (option) => {
        if (option.disabled) return;
        if (notifySameValue || option.value !== value) onChange(option.value);
        close();
        requestAnimationFrame(() => inputRef.current?.focus());
      };

      useEffect(() => {
        if (!open) return undefined;
        const dismiss = (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
          close();
        };
        document.addEventListener("pointerdown", dismiss, true);
        return () => document.removeEventListener("pointerdown", dismiss, true);
      }, [open]);

      useEffect(() => {
        if (!open) return undefined;
        const timer = window.setTimeout(() => {
          setAnnouncement(
            results.length === 0
              ? "No matching " + resultNoun + "s."
              : results.length + " " + resultNoun + (results.length === 1 ? " suggestion available." : " suggestions available."),
          );
        }, 250);
        return () => window.clearTimeout(timer);
      }, [open, query, results.length]);

      useEffect(() => {
        if (!open || active < 0) return;
        document.getElementById(listboxId + "-option-" + active)?.scrollIntoView({ block: "nearest" });
      }, [open, active, listboxId]);

      const onInputKeyDown = (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const navigationResults = !open && resumeSearch
            ? optionsForQuery(value)
            : results;
          if (!open) {
            setSearching(resumeSearch);
            show();
          }
          if (navigationResults.length === 0) {
            setActiveIndex(-1);
            return;
          }
          setActiveIndex((current) =>
            timezoneNavigationIndex(event.key, current, navigationResults.length, !open),
          );
          return;
        }
        if (event.key === "Enter" && open) {
          event.preventDefault();
          if (active >= 0) {
            choose(results[active]);
            return;
          }
          const exact = commitExactValue(value);
          if (exact !== null) choose({ id: exact, value: exact });
          else setAnnouncement(invalidMessage);
          return;
        }
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          (event.nativeEvent || event).__dshAutomationsNested = true;
          onCancel?.();
          close();
          return;
        }
        if (event.key === "Tab" && open) close();
      };

      const panel = open
        ? h(
            "div",
            {
              ref: panelRef,
              className: "dsh-auto-combobox-popover",
              style: popoverLayout
                ? {
                    left: popoverLayout.left,
                    top: popoverLayout.top,
                    width: popoverLayout.width,
                    maxHeight: popoverLayout.maxHeight,
                  }
                : { left: 12, top: 12, width: 320, visibility: "hidden" },
              "data-side": popoverLayout?.side,
              "data-dsh-auto-combobox-popover": "true",
            },
            h(
              "div",
              { className: "dsh-auto-combobox-popover-title" },
              searching && query.trim() !== "" ? searchTitle : initialTitle,
            ),
            panelNotice
              ? h("div", { className: "dsh-auto-combobox-notice", role: "status" }, panelNotice)
              : null,
            h(
              "div",
              {
                id: listboxId,
                className: "dsh-auto-combobox-list",
                role: "listbox",
                "aria-label": listboxLabel,
              },
              results.length > 0
                ? results.map((option, index) => {
                    const optionId = listboxId + "-option-" + index;
                    const OptionIcon = option.Icon || Icon;
                    const isSelected = selectedId === option.id;
                    const previous = index > 0 ? results[index - 1] : null;
                    const showGroupTitle = option.groupTitle
                      && (previous === null || previous.groupKey !== option.groupKey);
                    return h(
                      React.Fragment,
                      { key: option.id },
                      showGroupTitle
                        ? h(
                            "div",
                            {
                              className: "dsh-auto-combobox-group-title",
                              role: "presentation",
                            },
                            option.groupTitle,
                          )
                        : null,
                      h(
                        "div",
                        {
                          id: optionId,
                          className: "dsh-auto-combobox-option",
                          role: "option",
                          "aria-label": option.ariaLabel,
                          "aria-selected": isSelected,
                          "aria-disabled": option.disabled ? "true" : undefined,
                          "data-active": active === index ? "true" : undefined,
                          "data-disabled": option.disabled ? "true" : undefined,
                          onPointerMove: () => {
                            if (!option.disabled) setActiveIndex(index);
                          },
                          onPointerDown: (event) => event.preventDefault(),
                          onClick: () => choose(option),
                        },
                        OptionIcon
                          ? h("span", { className: "dsh-auto-combobox-option-icon", "aria-hidden": "true" }, h(OptionIcon))
                          : null,
                        h(
                          "span",
                          { className: "dsh-auto-picker-item-copy" },
                          h("span", { className: "dsh-auto-picker-item-label" }, option.label),
                          option.detail
                            ? h("span", { className: "dsh-auto-picker-item-detail" }, option.detail)
                            : null,
                        ),
                        isSelected
                          ? h("span", { className: "dsh-auto-combobox-option-check", "aria-hidden": "true" }, h(IconCheckOutline16))
                          : null,
                      ),
                    );
                  })
                : h(
                    "div",
                    {
                      className: "dsh-auto-combobox-empty",
                      role: "option",
                      "aria-disabled": "true",
                      "aria-selected": false,
                    },
                    emptyText,
                  ),
            ),
            hintText ? h("p", { className: "dsh-auto-combobox-popover-hint" }, hintText) : null,
          )
        : null;

      return h(
        React.Fragment,
        null,
        h(
          "span",
          {
            ref: anchorRef,
            className: "dsh-auto-combobox-control" + (Icon ? "" : " dsh-auto-combobox-control-no-icon"),
            "data-open": open ? "true" : undefined,
            onPointerDown: (event) => {
              if (disabled) return;
              if (event.target === inputRef.current) return;
              event.preventDefault();
              if (open) close();
              else {
                setSearching(resumeSearch);
                show();
                requestAnimationFrame(() => {
                  inputRef.current?.focus();
                  inputRef.current?.select();
                });
              }
            },
          },
          Icon
            ? h("span", { className: "dsh-auto-combobox-control-icon", "aria-hidden": "true" }, h(Icon))
            : null,
          h("input", {
            ref: inputRef,
            id,
            className: "dsh-auto-combobox-input",
            type: "text",
            role: "combobox",
            value: !searching && displayValue !== undefined ? displayValue : value,
            placeholder,
            disabled,
            autoComplete: "off",
            spellCheck: false,
            "aria-autocomplete": "list",
            "aria-haspopup": "listbox",
            "aria-expanded": open,
            "aria-controls": open ? listboxId : undefined,
            "aria-activedescendant": open && active >= 0 ? listboxId + "-option-" + active : undefined,
            "aria-invalid": !open && invalid ? "true" : undefined,
            onFocus: (event) => {
              setSearching(resumeSearch);
              setActiveIndex(-1);
              show();
              event.currentTarget.select();
            },
            onClick: () => {
              if (open) return;
              setSearching(resumeSearch);
              setActiveIndex(-1);
              show();
            },
            onBlur: (event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && (anchorRef.current?.contains(next) || panelRef.current?.contains(next))) return;
              if (commitOnBlur) {
                const exact = commitExactValue(value);
                if (exact !== null) onChange(exact);
              }
              close();
            },
            onChange: (event) => {
              setSearching(true);
              setActiveIndex(0);
              show();
              onInputChange(event.target.value);
            },
            onKeyDown: onInputKeyDown,
          }),
          h(
            "span",
            {
              className: "dsh-auto-combobox-chevron" + (open ? " dsh-auto-combobox-chevron-open" : ""),
              "aria-hidden": "true",
            },
            h(IconChevronDownOutline14),
          ),
        ),
        open && typeof document !== "undefined" ? createPortal(panel, document.body) : null,
        h("span", { className: "dsh-auto-sr-only", role: "status", "aria-live": "polite" }, announcement),
      );
    }

    function TimeZonePicker({ id, value, onChange }) {
      const offsetCacheRef = useRef(new Map());
      const selected = canonicalTimezone(value);
      const optionsForQuery = (query) => timezoneSearchResults(query, value).map((zone) => {
        const copy = timezoneOptionPresentation(zone, offsetCacheRef.current);
        return {
          id: zone,
          value: timezonePreferredValue(zone),
          label: copy.label,
          detail: copy.detail,
        };
      });
      return h(EditableCombobox, {
        id,
        value,
        onChange,
        optionsForQuery,
        selectedId: selected,
        commitExactValue: (raw) => {
          const canonical = canonicalTimezone(raw);
          return canonical ? timezonePreferredValue(canonical) : null;
        },
        placeholder: "Search city or time zone",
        Icon: IconGlobeOutline14,
        listboxLabel: "Time zones",
        initialTitle: "Suggested time zones",
        searchTitle: "Matching time zones",
        emptyText: "No matching time zones. You can still enter a recognized IANA time zone, such as Europe/Berlin.",
        hintText: "Type a city, region, or IANA time zone.",
        resultNoun: "time zone",
        invalidMessage: "Enter a valid IANA time zone, such as Europe/Berlin.",
        invalid: value.trim() !== "" && selected === null,
        resumeSearch: value.trim() !== "" && selected === null,
        onOpen: () => offsetCacheRef.current.clear(),
      });
    }

    function looksLikeAbsolutePath(value) {
      const path = String(value || "").trim();
      return path.charAt(0) === "/" || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
    }

    function workspacePathName(path) {
      const withoutTrailingSeparators = String(path || "").replace(/[\\/]+$/, "");
      const segments = withoutTrailingSeparators.split(/[\\/]/).filter(Boolean);
      return segments[segments.length - 1] || String(path || "");
    }

    function normalizedWorkspaces(workspaces) {
      const seenPaths = new Set();
      return (Array.isArray(workspaces) ? workspaces : [])
        .map((workspace, index) => {
          if (!workspace || typeof workspace.path !== "string" || workspace.path.trim() === "") return null;
          const path = workspace.path.trim();
          if (seenPaths.has(path)) return null;
          seenPaths.add(path);
          const rawTitle = typeof workspace.title === "string" ? workspace.title.trim() : "";
          return {
            id: String(workspace.workspaceId || workspace.id || "workspace-" + index),
            path,
            title: rawTitle || workspacePathName(path),
            sessionCount: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
          };
        })
        .filter(Boolean);
    }

    function preferredWorkspacePath(workspaceSnapshot) {
      const catalog = normalizedWorkspaces(workspaceSnapshot?.items);
      const recentId = workspaceSnapshot?.recentWorkspaceId;
      const recent = recentId === undefined
        ? null
        : catalog.find((workspace) => workspace.id === String(recentId));
      return (recent || catalog[0] || {}).path || "";
    }

    function WorkspacePicker({ id, value, workspaceSnapshot, onChange }) {
      const catalog = normalizedWorkspaces(workspaceSnapshot?.items);
      const exactValue = value.trim();
      const selected = catalog.find((workspace) => workspace.path === exactValue) || null;
      const custom = exactValue !== "" && selected === null && looksLikeAbsolutePath(exactValue);
      const options = [
        ...catalog.map((workspace) => ({
          id: "workspace:" + workspace.id,
          value: workspace.path,
          label: workspace.title,
          detail: workspace.path + " · " + workspace.sessionCount + (workspace.sessionCount === 1 ? " session" : " sessions"),
          aliases: [workspace.id, workspacePathName(workspace.path)],
          Icon: IconFolderClose16,
        })),
        ...(custom
          ? [{
              id: "custom-workspace:" + exactValue,
              value: exactValue,
              label: workspacePathName(exactValue) || exactValue,
              detail: exactValue + " · Custom absolute path",
              aliases: [exactValue],
              custom: true,
              Icon: IconFolderClose16,
            }]
          : []),
      ];
      let panelNotice = null;
      if (workspaceSnapshot?.state === "error") {
        panelNotice = "Harness workspaces are unavailable. You can still enter an absolute directory path.";
      } else if (workspaceSnapshot?.phase !== "ready" && catalog.length === 0) {
        panelNotice = "Loading Harness workspaces. You can still enter an absolute directory path.";
      }
      return h(EditableCombobox, {
        id,
        value,
        displayValue: selected ? selected.title : undefined,
        onChange,
        optionsForQuery: (query) => comboboxSearchResults(options, query),
        selectedId: selected ? "workspace:" + selected.id : custom ? "custom-workspace:" + exactValue : null,
        commitExactValue: (raw) => {
          const path = raw.trim();
          return looksLikeAbsolutePath(path) ? path : null;
        },
        placeholder: "Choose a Harness workspace or enter a path",
        Icon: IconFolderClose16,
        listboxLabel: "Harness workspaces",
        initialTitle: "Harness workspaces",
        searchTitle: "Matching workspaces",
        emptyText: catalog.length === 0
          ? "No Harness workspaces are registered. Enter an absolute directory path."
          : "No matching workspaces. Enter an absolute directory path to use it directly.",
        hintText: "Choose a registered workspace or enter an absolute path without registering it.",
        resultNoun: "workspace",
        invalidMessage: "Enter an absolute workspace path.",
        invalid: exactValue !== "" && !looksLikeAbsolutePath(exactValue),
        resumeSearch: custom,
        panelNotice,
      });
    }

    function providerFallbackName(id) {
      return humanizePresetId(id)
        .replace(/^Openai\b/, "OpenAI")
        .replace(/^Deepseek\b/, "DeepSeek");
    }

    function normalizedProviders(providers) {
      return (Array.isArray(providers) ? providers : [])
        .filter((provider) => provider && typeof provider.id === "string" && provider.id !== "")
        .map((provider) => ({
          id: provider.id,
          name: typeof provider.name === "string" && provider.name !== "" ? provider.name : providerFallbackName(provider.id),
          models: (Array.isArray(provider.models) ? provider.models : [])
            .map((model) => typeof model === "string"
              ? { id: model, name: model }
              : model && typeof model.id === "string"
                ? {
                    id: model.id,
                    name: typeof model.name === "string" && model.name !== "" ? model.name : model.id,
                    ...(typeof model.description === "string" ? { description: model.description } : {}),
                  }
                : null)
            .filter(Boolean),
        }));
    }

    function modelRoute(provider, model) {
      const exactProvider = String(provider || "").trim();
      const exactModel = String(model || "").trim();
      if (exactProvider === "" && exactModel === "") return "";
      if (exactProvider === "" || exactModel === "") return exactProvider || exactModel;
      return exactProvider + "/" + exactModel;
    }

    function parseModelRoute(value) {
      const route = String(value || "").trim();
      const separator = route.indexOf("/");
      if (separator <= 0 || separator === route.length - 1) return null;
      const provider = route.slice(0, separator).trim();
      const model = route.slice(separator + 1).trim();
      return provider === "" || model === "" ? null : { provider, model };
    }

    function modelOptionId(provider, model) {
      return "model:" + provider.length + ":" + provider + model;
    }

    function ModelPicker({ id, provider, model, providers, defaultModel, onChange }) {
      const catalog = normalizedProviders(providers);
      const route = modelRoute(provider, model);
      const selected = catalog.flatMap((group) => group.models.map((entry) => ({ group, model: entry })))
        .find((entry) => entry.group.id === provider && entry.model.id === model) || null;
      const [queryValue, setQueryValue] = useState(route);
      useEffect(() => setQueryValue(route), [route]);
      const defaultOption = {
        id: "",
        value: "",
        label: "Harness default",
        ariaLabel: "Harness default model",
        detail: defaultModel && defaultModel.provider && defaultModel.model
          ? "Use " + defaultModel.provider + " / " + defaultModel.model + "."
          : "Resolve the current Harness model at run time.",
        groupKey: "default",
        groupTitle: "Default",
        Icon: IconSettingsOutline16,
      };
      const modelOptions = catalog.flatMap((group) => group.models.map((entry) => ({
        id: modelOptionId(group.id, entry.id),
        value: modelRoute(group.id, entry.id),
        label: entry.name,
        ariaLabel: entry.name + ", provider " + group.name,
        detail: entry.description || (entry.name === entry.id ? undefined : entry.id),
        aliases: [group.id, group.name, entry.id],
        groupKey: "provider:" + group.id,
        groupTitle: group.name,
        provider: group.id,
        model: entry.id,
        Icon: IconSettingsOutline16,
      })));
      const selectedId = route === ""
        ? ""
        : selected
          ? modelOptionId(selected.group.id, selected.model.id)
          : "custom-model:" + route;
      const optionsForQuery = (query) => {
        const exact = String(query || "").trim();
        const parsed = parseModelRoute(exact);
        const known = parsed && modelOptions.some((option) => option.provider === parsed.provider && option.model === parsed.model);
        const customOption = parsed && !known
          ? {
              id: "custom-model:" + exact,
              value: modelRoute(parsed.provider, parsed.model),
              label: exact,
              ariaLabel: parsed.model + ", custom provider " + parsed.provider,
              detail: "Custom provider/model route · Availability is checked when the automation runs.",
              aliases: [parsed.provider, parsed.model],
              groupKey: "custom",
              groupTitle: "Custom route",
              custom: true,
              Icon: IconSettingsOutline16,
            }
          : null;
        return comboboxSearchResults([defaultOption, ...modelOptions, ...(customOption ? [customOption] : [])], query);
      };
      const commit = (value) => {
        const exact = String(value || "").trim();
        if (exact === "") {
          setQueryValue("");
          if (route !== "") onChange({ provider: "", model: "" });
          return;
        }
        const known = modelOptions.find((option) => option.value === exact);
        const parsed = known ? { provider: known.provider, model: known.model } : parseModelRoute(exact);
        if (!parsed) return;
        const nextRoute = modelRoute(parsed.provider, parsed.model);
        setQueryValue(nextRoute);
        if (nextRoute !== route) onChange(parsed);
      };
      return h(EditableCombobox, {
        id,
        value: queryValue,
        displayValue: selected ? selected.model.name : route === "" ? "Harness default" : route,
        onChange: commit,
        onInputChange: setQueryValue,
        onCancel: () => setQueryValue(route),
        optionsForQuery,
        selectedId,
        commitExactValue: (raw) => {
          const exact = raw.trim();
          return exact === "" || parseModelRoute(exact) ? exact : null;
        },
        placeholder: "Harness default",
        Icon: IconSettingsOutline16,
        listboxLabel: "Models grouped by provider",
        initialTitle: "Available models",
        searchTitle: "Matching models",
        emptyText: "No matching models. Enter a custom provider/model route to use it directly.",
        hintText: "Choose a model from the flat provider list or enter provider/model.",
        resultNoun: "model",
        invalidMessage: "Choose a model or enter provider/model.",
        invalid: route !== "" && parseModelRoute(route) === null,
        commitOnBlur: true,
        notifySameValue: true,
        resumeSearch: route !== "" && selected === null,
      });
    }

    function useExactModelMetadata(provider, model) {
      const cacheKey = provider && model ? provider + "\u0000" + model : "";
      const [state, setState] = useState(() => {
        const cached = cacheKey ? MODEL_METADATA_CACHE.get(cacheKey) : null;
        return cached
          ? { key: cacheKey, status: "ready", data: cached, error: null }
          : { key: cacheKey, status: cacheKey ? "loading" : "idle", data: null, error: null };
      });
      useEffect(() => {
        if (!cacheKey) {
          setState({ key: "", status: "idle", data: null, error: null });
          return undefined;
        }
        const cached = MODEL_METADATA_CACHE.get(cacheKey);
        if (cached) {
          setState({ key: cacheKey, status: "ready", data: cached, error: null });
          return undefined;
        }
        const controller = new AbortController();
        let active = true;
        setState({ key: cacheKey, status: "loading", data: null, error: null });
        const timer = window.setTimeout(() => {
          apiFetch(
            "/meta/model?provider=" + encodeURIComponent(provider) + "&model=" + encodeURIComponent(model),
            { signal: controller.signal },
          ).then((data) => {
            MODEL_METADATA_CACHE.set(cacheKey, data);
            if (active) setState({ key: cacheKey, status: "ready", data, error: null });
          }).catch((error) => {
            if (!active || (error && error.name === "AbortError")) return;
            setState({ key: cacheKey, status: "error", data: null, error: errMessage(error) });
          });
        }, 180);
        return () => {
          active = false;
          window.clearTimeout(timer);
          controller.abort();
        };
      }, [cacheKey, provider, model]);
      if (state.key === cacheKey) return state;
      const cached = cacheKey ? MODEL_METADATA_CACHE.get(cacheKey) : null;
      return cached
        ? { key: cacheKey, status: "ready", data: cached, error: null }
        : { key: cacheKey, status: cacheKey ? "loading" : "idle", data: null, error: null };
    }

    function reasoningEffortsForState(modelState) {
      const advertised = modelState.status === "ready" && modelState.data?.reasoning
        && Array.isArray(modelState.data.reasoning.efforts)
        ? modelState.data.reasoning.efforts
        : null;
      if (advertised) return advertised;
      return modelState.status === "error" ? COMMON_EFFORT_FALLBACKS : [];
    }

    function ReasoningEffortPicker({ id, value, provider, model, defaultModel, onChange }) {
      const inherited = provider.trim() === "" && model.trim() === "";
      const exactProvider = inherited ? String(defaultModel?.provider || "") : provider.trim();
      const exactModel = inherited ? String(defaultModel?.model || "") : model.trim();
      const modelState = useExactModelMetadata(exactProvider, exactModel);
      const reasoning = modelState.status === "ready" && modelState.data
        ? modelState.data.reasoning
        : undefined;
      const efforts = reasoningEffortsForState(modelState);
      const known = value === "" || efforts.some((effort) => effort.id === value);
      const advertisedDefault = inherited
        ? defaultModel?.reasoningEffort
        : reasoning?.defaultEffort;
      const defaultEffort = efforts.find((effort) => effort.id === advertisedDefault);
      const defaultDetail = advertisedDefault
        ? "Use " + (defaultEffort?.name || advertisedDefault) + (inherited ? " from the current Harness selection." : " as this model's default.")
        : inherited
          ? "Use the current Harness reasoning setting at run time."
          : "Let the selected model or provider choose.";
      const options = [
        {
          id: "",
          value: "",
          label: "Default",
          detail: defaultDetail,
          Icon: IconThinkOutline14,
        },
        ...efforts.map((effort) => ({
          id: effort.id,
          value: effort.id,
          label: effort.name || effort.id,
          detail: effort.description || (effort.name === effort.id ? "Adapter-owned effort level." : effort.id),
          aliases: [effort.id],
          Icon: IconThinkOutline14,
        })),
        ...(value.trim() !== "" && !known
          ? [{
              id: "custom-effort:" + value,
              value,
              label: value,
              detail: "Custom effort ID · Availability is checked when the automation runs.",
              custom: true,
              Icon: IconThinkOutline14,
            }]
          : []),
      ];
      let panelNotice = null;
      if (!exactProvider || !exactModel) {
        panelNotice = "Choose a model to load its effort levels.";
      } else if (modelState.status === "loading") {
        panelNotice = "Loading effort levels for " + exactProvider + " / " + exactModel + "…";
      } else if (modelState.status === "error") {
        panelNotice = "Exact-model metadata is unavailable. Common effort IDs are advisory; custom IDs remain available.";
      } else if (modelState.status === "ready" && !reasoning) {
        panelNotice = "This model does not advertise selectable effort levels. Custom IDs remain available.";
      }
      return h(EditableCombobox, {
        id,
        value,
        onChange,
        optionsForQuery: (query) => comboboxSearchResults(options, query),
        selectedId: value === "" ? "" : known ? value : "custom-effort:" + value,
        commitExactValue: (raw) => raw.trim(),
        placeholder: "Default",
        Icon: IconThinkOutline14,
        listboxLabel: "Reasoning effort levels",
        initialTitle: "Reasoning effort",
        searchTitle: "Matching effort levels",
        emptyText: "No matching effort levels. Press Enter to keep this custom effort ID.",
        hintText: "Options come from the exact model; custom adapter-owned IDs remain accepted.",
        resultNoun: "effort level",
        invalidMessage: "Enter an effort ID or choose Default.",
        resumeSearch: value.trim() !== "" && !known,
        panelNotice,
        disabled: provider.trim() !== "" && model.trim() === "" && value.trim() === "",
      });
    }

    function AgentPresetPicker({ id, value, presets, onChange }) {
      const [open, setOpen] = useState(false);
      const ownerId = useId();
      const triggerRef = useRef(null);
      usePickerMenuNavigation({ open, setOpen, ownerId, selectedId: value, triggerRef });
      const selected = presets.find((preset) => preset.id === value);
      const label = value === ""
        ? "Harness default"
        : agentPresetDisplayLabel(selected || { id: value, name: value });
      const items = [
        {
          id: "",
          label: h(PickerItemCopy, {
            label: "Harness default",
            detail: "Use the current Harness agent preset.",
            ownerId,
            itemId: "",
          }),
          icon: h(IconAgentPresetOutline16),
        },
        ...presets.map((preset) => ({
          id: preset.id,
          label: h(PickerItemCopy, {
            label: agentPresetDisplayLabel(preset),
            detail: preset.broken ? "Failed to load: " + preset.broken : null,
            ownerId,
            itemId: preset.id,
          }),
          icon: h(IconAgentPresetOutline16),
          disabled: Boolean(preset.broken),
        })),
      ];
      return h(Menu, {
        open,
        onClose: () => setOpen(false),
        items,
        selectedId: value,
        onSelect: (next) => {
          setOpen(false);
          onChange(next);
          focusPickerTrigger(triggerRef);
        },
        side: "top",
        portal: true,
        className: "dsh-auto-picker-root",
        anchor: h(
          "button",
          {
            ref: triggerRef,
            id,
            type: "button",
            className: "dsh-auto-picker-trigger",
            "aria-haspopup": "menu",
            "aria-expanded": open,
            onKeyDown: (event) => openPickerFromKeyboard(event, setOpen),
            onClick: () => setOpen((current) => !current),
          },
          h(IconAgentPresetOutline16, { className: "dsh-auto-picker-trigger-icon" }),
          h("span", { className: "dsh-auto-picker-trigger-label" }, label),
          h(IconChevronDownOutline14, { className: "dsh-auto-picker-chevron" + (open ? " dsh-auto-picker-chevron-open" : "") }),
        ),
      });
    }

    function PermissionPresetPicker({ id, value, presets, onChange }) {
      const [open, setOpen] = useState(false);
      const [confirmingFullAccess, setConfirmingFullAccess] = useState(false);
      const [acknowledged, setAcknowledged] = useState(false);
      const ownerId = useId();
      const triggerRef = useRef(null);
      usePickerMenuNavigation({ open, setOpen, ownerId, selectedId: value, triggerRef });
      useRiskConfirmationFocus(confirmingFullAccess);
      const selected = permissionPresetPresentation(value);
      const items = presets.map((preset) => {
        const presentation = permissionPresetPresentation(preset);
        return {
          id: preset,
          label: h(PickerItemCopy, {
            label: presentation.label,
            detail: presentation.detail,
            ownerId,
            itemId: preset,
          }),
          icon: h(PermissionPresetIcon, { value: preset }),
          danger: preset === "danger-full-access",
        };
      });
      const closeConfirmation = () => {
        setConfirmingFullAccess(false);
        setAcknowledged(false);
        focusPickerTrigger(triggerRef);
      };
      return h(
        React.Fragment,
        null,
        h(Menu, {
          open,
          onClose: () => setOpen(false),
          items,
          selectedId: value,
          onSelect: (next) => {
            setOpen(false);
            if (next === "danger-full-access" && value !== "danger-full-access") {
              setAcknowledged(false);
              setConfirmingFullAccess(true);
              return;
            }
            onChange(next);
            focusPickerTrigger(triggerRef);
          },
          side: "top",
          portal: true,
          className: "dsh-auto-picker-root",
          anchor: h(
            "button",
            {
              ref: triggerRef,
              id,
              type: "button",
              className: "dsh-auto-picker-trigger",
              "data-permission-preset": value,
              "aria-haspopup": "menu",
              "aria-expanded": open,
              onKeyDown: (event) => openPickerFromKeyboard(event, setOpen),
              onClick: () => setOpen((current) => !current),
            },
            h(PermissionPresetIcon, { value, className: "dsh-auto-picker-trigger-icon" }),
            h("span", { className: "dsh-auto-picker-trigger-label" }, selected.label),
            h(IconChevronDownOutline14, { className: "dsh-auto-picker-chevron" + (open ? " dsh-auto-picker-chevron-open" : "") }),
          ),
        }),
        h(RiskConfirmation, {
          open: confirmingFullAccess,
          title: "Enable Full access?",
          description: "Full access lets scheduled agents perform sensitive actions, file changes, and external commands without approval prompts. Only use it for automations you trust.",
          acknowledgeLabel: "I understand the risks and want to continue",
          cancelLabel: "Cancel",
          confirmLabel: "Enable Full access",
          acknowledged,
          onAcknowledgedChange: setAcknowledged,
          onCancel: closeConfirmation,
          onConfirm: () => {
            setConfirmingFullAccess(false);
            setAcknowledged(false);
            onChange("danger-full-access");
            focusPickerTrigger(triggerRef);
          },
        }),
      );
    }

    function StatusPill(props) {
      return h("span", { className: "dsh-auto-status dsh-auto-status-" + props.status }, props.status);
    }

    function nextFormInstancePrefix(reactFormId) {
      formInstanceSerial += 1;
      return "dsh-auto-form-" + formInstanceSerial + "-" + reactFormId;
    }

    function JobForm(props) {
      const { meta, workspaceSnapshot, draft, editing, saving, error, errorField, onChange, onIdTouched, onSubmit, onCancel } = props;
      const providers = normalizedProviders(meta && Array.isArray(meta.providers) ? meta.providers : []);
      const permissionPresets =
        meta && Array.isArray(meta.permissionPresets) && meta.permissionPresets.length > 0
          ? meta.permissionPresets
          : ["workspace-write"];
      const agentPresets = meta && Array.isArray(meta.agentPresets) ? meta.agentPresets : [];
      const creating = editing === null;
      const reactFormId = String(useId()).replace(/[^A-Za-z0-9_-]/g, "");
      const formPrefixRef = useRef(null);
      if (formPrefixRef.current === null) {
        formPrefixRef.current = nextFormInstancePrefix(reactFormId);
      }
      const fieldId = (name) => formPrefixRef.current + "-" + name;
      const errorId = fieldId("form-error");
      const [advancedOpen, setAdvancedOpen] = useState(false);
      const advancedError = ["id", "timeout", "overlap", "misfire"].includes(errorField);
      const errorPanelReady = !advancedError || advancedOpen;
      useEffect(() => {
        if (!error || !errorField) return undefined;
        if (!errorPanelReady) {
          setAdvancedOpen(true);
          return undefined;
        }
        let target = null;
        let previousInvalid = null;
        let previousDescribedBy = null;
        const frame = requestAnimationFrame(() => {
          target = document.getElementById(fieldId(errorField));
          if (!target) return;
          previousInvalid = target.getAttribute("aria-invalid");
          previousDescribedBy = target.getAttribute("aria-describedby");
          target.setAttribute("aria-invalid", "true");
          target.setAttribute("aria-describedby", errorId);
          target.focus();
        });
        return () => {
          cancelAnimationFrame(frame);
          if (!target) return;
          if (previousInvalid === null) target.removeAttribute("aria-invalid");
          else target.setAttribute("aria-invalid", previousInvalid);
          if (previousDescribedBy === null) target.removeAttribute("aria-describedby");
          else target.setAttribute("aria-describedby", previousDescribedBy);
        };
      }, [error, errorField, errorPanelReady]);
      const advancedSummary = [
        creating ? (draft.id.trim() === "" ? "Automatic job ID" : "ID " + draft.id.trim()) : "ID " + draft.id,
        (formatTimeout(Number(draft.timeoutMs)) || draft.timeoutMs + "ms") + " timeout",
        overlapPolicySummary(draft.overlap),
        draft.misfire === "skip" ? "Skip missed runs" : "Run once after downtime",
      ].join(" · ");

      return h(
        "form",
        {
          className: "dsh-auto-form",
          onSubmit,
          noValidate: true,
          "aria-label": creating ? "New automation" : "Edit automation",
        },
        h(
          "header",
          { className: "dsh-auto-form-header" },
          h(
            "span",
            { className: "dsh-auto-form-heading" },
            h("h3", null, creating ? "New automation" : "Edit \u201c" + editing.name + "\u201d"),
            h("p", null, "Configure what runs, when it runs, and which Harness agent executes it."),
          ),
          h(
            "label",
            { className: "dsh-auto-switch dsh-auto-form-enabled" },
            h("input", {
              id: fieldId("enabled"),
              type: "checkbox",
              role: "switch",
              checked: draft.enabled,
              onChange: (event) => onChange("enabled", event.target.checked),
            }),
            h("span", { className: "dsh-auto-switch-track" }),
            h("span", { className: "dsh-auto-switch-text" }, draft.enabled ? "Active" : "Paused"),
          ),
        ),
        h(
          FormSection,
          {
            title: "Task",
            description: "Describe the work and choose where the agent should run.",
            Icon: IconEditOutline16,
          },
          h(
            "div",
            { className: "dsh-auto-formgrid" },
            h(
              Field,
              { label: "Name", htmlFor: fieldId("name"), required: true, full: true },
              h("input", {
                id: fieldId("name"),
                className: "dsh-auto-input",
                type: "text",
                value: draft.name,
                autoFocus: true,
                placeholder: "e.g. Morning standup notes",
                onChange: (event) => onChange("name", event.target.value),
              }),
            ),
            h(
              Field,
              {
                label: "Prompt",
                htmlFor: fieldId("prompt"),
                required: true,
                full: true,
                hint: "Instructions sent to a fresh agent. Prompts are not copied into run-history summaries.",
              },
              h("textarea", {
                id: fieldId("prompt"),
                className: "dsh-auto-textarea dsh-auto-prompt",
                value: draft.prompt,
                placeholder: "Summarize yesterday's progress and list today's priorities\u2026",
                onChange: (event) => onChange("prompt", event.target.value),
              }),
            ),
            h(
              Field,
              {
                label: "Workspace",
                htmlFor: fieldId("cwd"),
                required: true,
                full: true,
                hint: "Choose a Harness workspace or enter the absolute directory where the agent runs.",
              },
              h(WorkspacePicker, {
                id: fieldId("cwd"),
                value: draft.cwd,
                workspaceSnapshot,
                onChange: (value) => onChange("cwd", value),
              }),
            ),
          ),
        ),
        h(
          FormSection,
          {
            title: "Schedule",
            description: "Choose a common pattern, or switch to Custom for a five-field cron expression.",
            Icon: IconGlobeOutline14,
          },
          h(
            "div",
            { className: "dsh-auto-formgrid dsh-auto-schedule-grid" },
            h(ScheduleEditor, {
              fieldId,
              cron: draft.cron,
              timezone: draft.timezone,
              onCronChange: (value) => onChange("cron", value),
              onTimezoneChange: (value) => onChange("timezone", value),
            }),
          ),
        ),
        h(
          FormSection,
          {
            title: "Agent & access",
            description: "Select the model, agent behavior, and filesystem permissions for each fresh run.",
            Icon: IconAgentPresetOutline16,
          },
          h(
            "div",
            { className: "dsh-auto-formgrid" },
            h(
              Field,
              {
                label: "Model",
                htmlFor: fieldId("model"),
                hint: "Models are listed together under provider titles. Blank uses the current Harness default.",
              },
              h(ModelPicker, {
                id: fieldId("model"),
                provider: draft.provider,
                model: draft.model,
                providers,
                defaultModel: meta?.defaultModel,
                onChange: (selection) => onChange("modelSelection", selection),
              }),
            ),
            h(
              Field,
              { label: "Reasoning effort", htmlFor: fieldId("effort"), hint: "Default follows the selected model. Custom adapter-owned IDs remain supported." },
              h(ReasoningEffortPicker, {
                id: fieldId("effort"),
                value: draft.reasoningEffort,
                provider: draft.provider,
                model: draft.model,
                defaultModel: meta?.defaultModel,
                onChange: (value) => onChange("reasoningEffort", value),
              }),
            ),
            h(
              Field,
              { label: "Agent preset", htmlFor: fieldId("preset"), hint: "Uses the current Harness default when not explicitly selected." },
              h(AgentPresetPicker, {
                id: fieldId("preset"),
                value: draft.agentPreset,
                presets: agentPresets,
                onChange: (value) => onChange("agentPreset", value),
              }),
            ),
            h(
              Field,
              {
                label: "Permission preset",
                htmlFor: fieldId("permission"),
                required: true,
                full: true,
                hint: permissionPresetPresentation(draft.permissionPreset).detail,
              },
              h(PermissionPresetPicker, {
                id: fieldId("permission"),
                value: draft.permissionPreset,
                presets: permissionPresets,
                onChange: (value) => onChange("permissionPreset", value),
              }),
            ),
          ),
        ),
        h(
          "section",
          { className: "dsh-auto-advanced", "data-open": advancedOpen ? "true" : undefined },
          h(
            "button",
            {
              type: "button",
              className: "dsh-auto-advanced-trigger",
              "aria-expanded": advancedOpen,
              "aria-controls": fieldId("advanced-content"),
              onClick: () => setAdvancedOpen((open) => !open),
            },
            h("span", { className: "dsh-auto-form-section-icon", "aria-hidden": "true" }, h(IconSettingsOutline16)),
            h(
              "span",
              { className: "dsh-auto-advanced-copy" },
              h("span", { className: "dsh-auto-form-section-title" }, "Advanced"),
              h("span", { className: "dsh-auto-advanced-summary" }, advancedSummary),
            ),
            h(
              "span",
              { className: "dsh-auto-advanced-chevron" + (advancedOpen ? " dsh-auto-advanced-chevron-open" : ""), "aria-hidden": "true" },
              h(IconChevronDownOutline14),
            ),
          ),
          h(
            "div",
            {
              id: fieldId("advanced-content"),
              className: "dsh-auto-formgrid dsh-auto-advanced-content",
              hidden: !advancedOpen,
            },
                creating
                  ? h(
                      Field,
                      { label: "Job ID", htmlFor: fieldId("id"), hint: "Auto-derived from the name. Use lowercase letters, digits, and hyphens." },
                      h("input", {
                        id: fieldId("id"),
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
                      { label: "Job ID", htmlFor: fieldId("id"), hint: "Fixed after creation." },
                      h("input", {
                        id: fieldId("id"),
                        className: "dsh-auto-input",
                        type: "text",
                        value: draft.id,
                        disabled: true,
                        spellCheck: false,
                      }),
                    ),
                h(
                  Field,
                  { label: "Timeout (ms)", htmlFor: fieldId("timeout"), required: true, hint: "Wall-clock limit for each run (1s to 24h)." },
                  h("input", {
                    id: fieldId("timeout"),
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
                  { label: "Overlap policy", htmlFor: fieldId("overlap"), hint: OVERLAP_OPTIONS.find((option) => option.value === draft.overlap)?.hint },
                  h(
                    "select",
                    {
                      id: fieldId("overlap"),
                      className: "dsh-auto-select",
                      value: draft.overlap,
                      onChange: (event) => onChange("overlap", event.target.value),
                    },
                    OVERLAP_OPTIONS.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
                  ),
                ),
                h(
                  Field,
                  { label: "Misfire policy", htmlFor: fieldId("misfire"), hint: MISFIRE_OPTIONS.find((option) => option.value === draft.misfire)?.hint },
                  h(
                    "select",
                    {
                      id: fieldId("misfire"),
                      className: "dsh-auto-select",
                      value: draft.misfire,
                      onChange: (event) => onChange("misfire", event.target.value),
                    },
                    MISFIRE_OPTIONS.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
                  ),
                ),
          ),
        ),
        h(
          "footer",
          { className: "dsh-auto-form-footer" },
          error
            ? h("p", { id: errorId, className: "dsh-auto-formerror", role: "alert" }, error)
            : null,
          h(
            "div",
            { className: "dsh-auto-formactions" },
            h(
              Button,
              {
                type: "submit",
                variant: "primary",
                icon: saving ? null : h(IconCheckOutline16),
                disabled: saving,
              },
              saving ? "Saving\u2026" : creating ? "Create automation" : "Save changes",
            ),
            h(
              Button,
              { type: "button", variant: "outline", onClick: onCancel, disabled: saving },
              "Cancel",
            ),
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
      const permission = permissionPresetPresentation(job.execution.permissionPreset);

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
          h(
            "span",
            { className: "dsh-auto-card-permission", title: "Permission preset: " + job.execution.permissionPreset },
            h(PermissionPresetIcon, { value: job.execution.permissionPreset }),
            permission.label,
          ),
          h("span", { title: "Timeout" }, formatTimeout(job.execution.timeoutMs)),
          h("span", { className: "dsh-auto-muted", title: "Version" }, "v" + job.version),
        ),
        h(
          "div",
          { className: "dsh-auto-card-actions" },
          h(
            Button,
            {
              type: "button",
              variant: "ghost",
              size: "sm",
              icon: h(IconEditOutline16),
              onClick: onEdit,
              disabled: busyForJob || running,
            },
            "Edit",
          ),
          h(
            Button,
            {
              type: "button",
              variant: "primary",
              size: "sm",
              icon: running ? null : h(IconPlayOutline16),
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
                  Button,
                  {
                    type: "button",
                    variant: "ghost",
                    size: "sm",
                    className: "dsh-auto-danger-button",
                    icon: deleting ? null : h(IconTrashOutline16),
                    onClick: onDeleteConfirm,
                    disabled: deleting,
                  },
                  deleting ? "Deleting\u2026" : "Confirm delete",
                ),
                h(
                  Button,
                  { type: "button", variant: "outline", size: "sm", onClick: onDeleteCancel, disabled: deleting },
                  "Keep",
                ),
              )
            : h(
                Button,
                {
                  type: "button",
                  variant: "ghost",
                  size: "sm",
                  className: "dsh-auto-danger-button",
                  icon: h(IconTrashOutline16),
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
                            Button,
                            {
                              type: "button",
                              variant: "ghost",
                              size: "sm",
                              className: "dsh-auto-danger-button",
                              onClick: () => onCancelConfirm(run),
                              disabled: cancelling,
                            },
                            cancelling ? "Cancelling\u2026" : "Confirm",
                          ),
                          h(
                            Button,
                            { type: "button", variant: "outline", size: "sm", onClick: onCancelReset, disabled: cancelling },
                            "Back",
                          ),
                        )
                      : h(
                          Button,
                          {
                            type: "button",
                            variant: "ghost",
                            size: "sm",
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

    function useHarnessWorkspaceSnapshot(workspaceRuntime) {
      const list = workspaceRuntime?.list;
      const subscribe = useCallback(
        (listener) => list ? list.subscribe(listener) : () => {},
        [list],
      );
      const getSnapshot = useCallback(
        () => list ? list.getSnapshot() : EMPTY_WORKSPACE_SNAPSHOT,
        [list],
      );
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    function AutomationsSection({ centerMode = false, workspaceRuntime = null } = {}) {
      const workspaceSnapshot = useHarnessWorkspaceSnapshot(workspaceRuntime);
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
      const [formErrorField, setFormErrorField] = useState(null);
      const [confirmDeleteId, setConfirmDeleteId] = useState(null);
      const [confirmCancelId, setConfirmCancelId] = useState(null);

      const aliveRef = useRef(true);
      const pollRef = useRef(false);
      const hasDataRef = useRef(false);
      const idTouchedRef = useRef(false);
      const workspaceTouchedRef = useRef(false);
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
        workspaceTouchedRef.current = false;
        setDraft(Object.assign(emptyDraft(meta), { cwd: preferredWorkspacePath(workspaceSnapshot) }));
        setFormError(null);
        setFormErrorField(null);
        setFormOpen(true);
      }, [meta, workspaceSnapshot]);

      const openEdit = useCallback((job) => {
        setEditing(job);
        idTouchedRef.current = true;
        workspaceTouchedRef.current = true;
        setDraft(draftFromJob(job));
        setFormError(null);
        setFormErrorField(null);
        setFormOpen(true);
      }, []);

      const closeForm = useCallback(() => {
        setFormOpen(false);
        setEditing(null);
        setFormError(null);
        setFormErrorField(null);
      }, []);

      useEffect(() => {
        if (!formOpen || editing !== null || workspaceTouchedRef.current || draft.cwd !== "") return;
        const preferred = preferredWorkspacePath(workspaceSnapshot);
        if (preferred === "") return;
        setDraft((previous) => previous.cwd === "" ? Object.assign({}, previous, { cwd: preferred }) : previous);
      }, [formOpen, editing, draft.cwd, workspaceSnapshot]);

      const handleDraftChange = useCallback(
        (key, value) => {
          if (key === "cwd") workspaceTouchedRef.current = true;
          setFormError(null);
          setFormErrorField(null);
          setDraft((previous) => {
            if (key === "modelSelection") {
              return Object.assign({}, previous, {
                provider: value.provider,
                model: value.model,
                reasoningEffort: "",
              });
            }
            let next = Object.assign({}, previous, { [key]: value });
            if (key === "name" && editing === null && !idTouchedRef.current) {
              next = Object.assign({}, next, { id: slugifyJobId(value) });
            }
            if (key === "provider") {
              next = Object.assign({}, next, { model: "", reasoningEffort: "" });
            } else if (key === "model") {
              next = Object.assign({}, next, { reasoningEffort: "" });
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
          const fail = (field, message) => {
            setFormErrorField(field);
            setFormError(message);
          };

          const name = draft.name.trim();
          if (name === "") return fail("name", "Give the automation a name.");
          const cron = draft.cron.trim();
          if (cron === "") return fail("cron", "A cron expression is required, e.g. 0 9 * * 1-5.");
          if (cronFields(cron).length !== 5) {
            return fail("cron", "Cron needs exactly five fields: minute, hour, day, month, and weekday.");
          }
          const timezone = draft.timezone.trim();
          if (timezone === "") return fail("timezone", "A timezone is required.");
          const cwd = draft.cwd.trim();
          if (cwd === "") return fail("cwd", "A workspace is required.");
          if (!looksLikeAbsolutePath(cwd)) {
            return fail("cwd", "The workspace must be an absolute filesystem path.");
          }
          const prompt = draft.prompt.trim();
          if (prompt === "") return fail("prompt", "A prompt is required.");
          const timeoutMs = Number(draft.timeoutMs);
          if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
            return fail(
              "timeout",
              "Timeout must be a whole number of milliseconds between " + MIN_TIMEOUT_MS + " and " + MAX_TIMEOUT_MS + ".",
            );
          }
          const provider = draft.provider.trim();
          const model = draft.model.trim();
          if (provider !== "" && model === "") {
            return fail("model", "Pick a model for the chosen provider (or leave both blank for the Harness default).");
          }
          if (provider === "" && model !== "") {
            return fail("model", "A model needs a provider (or leave both blank for the Harness default).");
          }
          let id = "";
          if (creating) {
            id = draft.id.trim().toLowerCase();
            if (id !== "" && !JOB_ID_PATTERN.test(id)) {
              return fail("id", "Job id must match [a-z0-9][a-z0-9-]{0,62} (lowercase letters, digits, hyphens).");
            }
          }
          const spec = buildSpec(draft);
          setFormError(null);
          setFormErrorField(null);
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
            const message = errMessage(error);
            setFormErrorField(inferFormErrorField(message));
            setFormError(message);
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
        {
          className: "dsh-auto-root" + (centerMode ? " dsh-auto-root-workspace" : ""),
          "aria-busy": loading ? "true" : null,
        },
        h(
          "div",
          { className: "dsh-auto-head" },
          h(
            "div",
            null,
            h("h2", { className: centerMode ? "dsh-auto-sr-only" : undefined }, "Automations"),
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
                Button,
                { type: "button", variant: "primary", icon: h(IconPlusOutline16), onClick: openCreate },
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
              key: editing === null ? "create" : "edit:" + editing.id,
              meta,
              workspaceSnapshot,
              draft,
              editing,
              saving: busy.save === true,
              error: formError,
              errorField: formErrorField,
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
                Button,
                { type: "button", variant: "primary", size: "sm", icon: h(IconRefreshOutline16), onClick: () => loadSnapshot(true) },
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

    const FOCUSABLE_SELECTOR = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[contenteditable=\"true\"]",
      "[tabindex]:not([tabindex=\"-1\"])",
    ].join(",");

    function visibleFocusables(panel) {
      if (!panel) return [];
      return Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) =>
        !element.hasAttribute("hidden") &&
        element.getAttribute("aria-hidden") !== "true" &&
        element.getClientRects().length > 0,
      );
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

    function sidebarWorkspaceRegion(trigger) {
      const action = trigger?.closest?.(".dsh-auto-sidebar-action");
      const footerActions = action?.parentElement;
      const footer = footerActions?.parentElement;
      return footer?.previousElementSibling || null;
    }

    function workspaceNavigationRowFromClick(target, region) {
      if (!target || !region) return null;
      const row = target.closest?.('[role="treeitem"][aria-selected]') || null;
      if (!row || !region.contains?.(row)) return null;
      const nestedButton = target.closest?.("button") || null;
      return nestedButton && nestedButton !== row ? null : row;
    }

    function AutomationsSidebarAction({ wide, disclosure }) {
      const open = useSyncExternalStore(
        disclosure.subscribe,
        disclosure.getSnapshot,
        disclosure.getSnapshot,
      );
      const triggerRef = useRef(null);
      const previousOpenRef = useRef(open);
      const restoreTriggerFocusRef = useRef(true);

      useEffect(() => {
        const onWorkspaceClick = (event) => {
          if (!disclosure.getSnapshot()) return;
          const region = sidebarWorkspaceRegion(triggerRef.current);
          if (!workspaceNavigationRowFromClick(event.target, region)) return;
          restoreTriggerFocusRef.current = false;
          disclosure.close();
        };
        document.addEventListener("click", onWorkspaceClick, true);
        return () => document.removeEventListener("click", onWorkspaceClick, true);
      }, [disclosure]);

      useEffect(() => {
        const previous = previousOpenRef.current;
        previousOpenRef.current = open;
        if (!previous || open) return undefined;
        if (!restoreTriggerFocusRef.current) {
          restoreTriggerFocusRef.current = true;
          return undefined;
        }
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
            title: wide ? undefined : open ? "Exit Automations" : "Automations",
            "aria-label": open ? "Exit Automations" : "Open Automations",
            "aria-pressed": open,
            "data-active": open ? "true" : undefined,
            "data-dsh-automations-trigger": "true",
            onClick: disclosure.toggle,
          },
          h(AutomationGlyph, { size: wide ? 16 : 18 }),
          wide ? h("span", { className: "dsh-auto-sidebar-label" }, "Automations") : null,
        ),
      );
    }

    function AutomationsWorkspace({ disclosure, workspaceRuntime }) {
      const workspaceRef = useRef(null);
      const titleId = useId();

      useEffect(() => {
        const frame = window.requestAnimationFrame(() =>
          workspaceRef.current?.querySelector('[data-dsh-automations-exit="true"]')?.focus(),
        );
        const onKeyDown = (event) => {
          if (event.key !== "Escape" || event.defaultPrevented || event.__dshAutomationsNested) return;
          if (event.target?.closest?.('[role="dialog"],[role="menu"]')) return;
          if (document.querySelector('.dsh-auto-picker-trigger[aria-expanded="true"],.dsh-auto-combobox-input[aria-expanded="true"]')) return;
          event.preventDefault();
          disclosure.close();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
          window.cancelAnimationFrame(frame);
          window.removeEventListener("keydown", onKeyDown);
        };
      }, [disclosure]);

      return h(
        "section",
        {
          ref: workspaceRef,
          className: "dsh-auto-workspace",
          "data-dsh-automations-workspace": "true",
          "aria-labelledby": titleId,
        },
        h(
          "header",
          { className: "dsh-auto-workspace-toolbar" },
          h("span", { className: "dsh-auto-workspace-icon", "aria-hidden": "true" }, h(AutomationGlyph, { size: 16 })),
          h("strong", { id: titleId, className: "dsh-auto-workspace-title" }, "Automations"),
          h(
            Button,
            {
              type: "button",
              variant: "toolbar",
              size: "sm",
              icon: h(IconChevronLeftOutline14),
              onClick: disclosure.close,
              "data-dsh-automations-exit": "true",
            },
            "Exit Automations",
          ),
        ),
        h("div", { className: "dsh-auto-workspace-scroll" }, h(AutomationsSection, { centerMode: true, workspaceRuntime })),
      );
    }

    function automationMarkableTitles(sessionSnapshot, automationSessionIds) {
      const groups = new Map();
      for (const sessionId of sessionSnapshot && Array.isArray(sessionSnapshot.ids) ? sessionSnapshot.ids : []) {
        const summary = sessionSnapshot.byId && sessionSnapshot.byId[sessionId];
        if (!summary || summary.blank || typeof summary.displayTitle !== "string") continue;
        const title = summary.displayTitle.trim();
        if (!title) continue;
        const group = groups.get(title) || { total: 0, automations: 0 };
        group.total += 1;
        if (automationSessionIds.has(String(sessionId))) group.automations += 1;
        groups.set(title, group);
      }
      return new Set(
        Array.from(groups.entries())
          .filter(([, group]) => group.automations > 0 && group.automations === group.total)
          .map(([title]) => title),
      );
    }

    function automationHistoryRowTitle(row) {
      if (row.tagName === "DIV") {
        return Array.from(row.children).find(
          (child) => child.tagName === "SPAN"
            && child.childElementCount === 0
            && (child.textContent || "").trim() !== "",
        ) || null;
      }
      if (row.tagName === "BUTTON") {
        const heading = Array.from(row.children).find(
          (child) => child.tagName === "SPAN" && child.childElementCount > 0,
        );
        return heading
          ? Array.from(heading.children).find(
              (child) => child.tagName === "SPAN"
                && child.childElementCount === 0
                && (child.textContent || "").trim() !== "",
            ) || null
          : null;
      }
      return null;
    }

    function decorateAutomationHistoryRows(markableTitles, selectedAutomationTitle) {
      const marker = "data-dsh-automation-history";
      for (const stale of document.querySelectorAll("[" + marker + "]")) stale.removeAttribute(marker);
      const rows = document.querySelectorAll('[role="treeitem"][aria-selected]');
      for (const row of rows) {
        if (row.tagName !== "DIV" && row.tagName !== "BUTTON") continue;
        const expected = row.getAttribute("aria-selected") === "true" && selectedAutomationTitle
          ? selectedAutomationTitle
          : null;
        const title = automationHistoryRowTitle(row);
        const text = (title?.textContent || "").trim();
        if (title && (text === expected || markableTitles.has(text))) title.setAttribute(marker, "true");
      }
    }

    function installAutomationHistoryBadges(ctx) {
      let automationSessionIds = new Set();
      let automationSessionsRevision = null;
      const pendingSessionIds = new Set();
      let sessionSnapshot = ctx.sessions.list.getSnapshot();
      let disposed = false;
      let scheduled = false;
      let requestController = null;
      let postAddRetryTimer = null;
      let observer = null;
      const render = () => {
        scheduled = false;
        if (disposed) return;
        const current = sessionSnapshot && sessionSnapshot.current && sessionSnapshot.byId
          ? sessionSnapshot.byId[sessionSnapshot.current]
          : null;
        const selectedAutomationTitle = current && automationSessionIds.has(String(current.id))
          ? current.displayTitle
          : null;
        decorateAutomationHistoryRows(
          automationMarkableTitles(sessionSnapshot, automationSessionIds),
          selectedAutomationTitle,
        );
      };
      const schedule = () => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(render);
      };
      const refresh = async () => {
        if (disposed || document.visibilityState === "hidden") return;
        requestController?.abort();
        const controller = new AbortController();
        requestController = controller;
        try {
          const query = automationSessionsRevision === null
            ? ""
            : "?revision=" + encodeURIComponent(String(automationSessionsRevision));
          const snapshot = await apiFetch("/sessions" + query, { signal: controller.signal });
          if (disposed || controller.signal.aborted) return;
          if (Array.isArray(snapshot.sessionIds)) {
            automationSessionIds = new Set(snapshot.sessionIds.map(String));
          }
          if (Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0) {
            automationSessionsRevision = snapshot.revision;
          }
          schedule();
        } catch (error) {
          if (!controller.signal.aborted) {
            // The Automations page owns connection errors; history decoration is optional.
          }
        } finally {
          if (requestController === controller) requestController = null;
        }
      };
      const unsubscribe = ctx.sessions.list.subscribe(() => {
        const previousIds = new Set(Array.isArray(sessionSnapshot.ids) ? sessionSnapshot.ids : []);
        sessionSnapshot = ctx.sessions.list.getSnapshot();
        const addedIds = Array.isArray(sessionSnapshot.ids)
          ? sessionSnapshot.ids.filter((sessionId) => !previousIds.has(sessionId))
          : [];
        for (const sessionId of addedIds) pendingSessionIds.add(sessionId);
        let becameNonblank = false;
        for (const sessionId of pendingSessionIds) {
          const summary = sessionSnapshot.byId?.[sessionId];
          if (summary && !summary.blank) {
            pendingSessionIds.delete(sessionId);
            becameNonblank = true;
          }
        }
        if (addedIds.length > 0 || becameNonblank) void refresh();
        else schedule();
        if (addedIds.some((sessionId) => pendingSessionIds.has(sessionId))) {
          if (postAddRetryTimer !== null) window.clearTimeout(postAddRetryTimer);
          postAddRetryTimer = window.setTimeout(() => {
            postAddRetryTimer = null;
            void refresh();
          }, 750);
        }
      });
      const refreshVisible = () => {
        if (document.visibilityState !== "hidden") void refresh();
      };
      observer = new MutationObserver((records) => {
        const selector = '[role="tree"],[role="treeitem"]';
        for (const record of records) {
          const changedNodes = [...record.addedNodes, ...record.removedNodes];
          if (changedNodes.some((node) => node.nodeType === 1
            && (node.matches?.(selector) || node.querySelector?.(selector)))) {
            schedule();
            return;
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("visibilitychange", refreshVisible);
      window.addEventListener("focus", refreshVisible);
      const timer = window.setInterval(refresh, HISTORY_BADGE_POLL_MS);
      void refresh();
      schedule();
      return () => {
        disposed = true;
        requestController?.abort();
        if (postAddRetryTimer !== null) window.clearTimeout(postAddRetryTimer);
        unsubscribe();
        observer.disconnect();
        document.removeEventListener("visibilitychange", refreshVisible);
        window.removeEventListener("focus", refreshVisible);
        window.clearInterval(timer);
        for (const marked of document.querySelectorAll("[data-dsh-automation-history]")) {
          marked.removeAttribute("data-dsh-automation-history");
        }
      };
    }

    const STYLE_CSS = [
      ".dsh-auto-sidebar-action{box-sizing:border-box;width:100%;height:42px;flex:none;display:flex;align-items:center;margin:4px 0 0;}",
      ".dsh-auto-sidebar-trigger{box-sizing:border-box;appearance:none;width:calc(100% + 4px);height:42px;margin:0 -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);display:flex;align-items:center;gap:8px;overflow:hidden;font-family:inherit;font-size:14px;line-height:22px;cursor:pointer;}",
      ".dsh-auto-sidebar-trigger:hover,.dsh-auto-sidebar-trigger[data-active=\"true\"]{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));}",
      ".dsh-auto-sidebar-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:-2px;}",
      ".dsh-auto-sidebar-trigger svg{flex:none;}",
      ".dsh-auto-sidebar-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      "[data-dsh-automation-history]{box-sizing:border-box;position:relative;padding-right:38px!important;}",
      "[data-dsh-automation-history]::after{content:'Auto';position:absolute;right:0;top:50%;box-sizing:border-box;display:inline-flex;align-items:center;height:16px;padding:0 5px;transform:translateY(-50%);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 32%,transparent);border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 10%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font-size:9px;font-weight:600;line-height:14px;letter-spacing:.01em;}",
      ".dsh-auto-sidebar-action-rail{width:36px;height:36px;margin:0;}",
      ".dsh-auto-sidebar-action-rail .dsh-auto-sidebar-trigger{width:36px;height:36px;margin:0;padding:0;justify-content:center;gap:0;border-radius:50%;}",
      ".dsh-auto-workspace{box-sizing:border-box;width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary,#0f1115);background:var(--dsw-alias-bg-base,#fff);font-family:inherit;}",
      ".dsh-auto-workspace-toolbar{box-sizing:border-box;width:100%;height:44px;flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px 6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(15,17,21,.14));background:var(--dsw-alias-bg-base,#fff);}",
      ".dsh-auto-workspace-icon{width:28px;height:28px;flex:none;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 10%,transparent);}",
      ".dsh-auto-workspace-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;line-height:20px;}",
      ".dsh-auto-workspace-scroll{container:dsh-auto-workspace / inline-size;box-sizing:border-box;min-height:0;flex:1;padding:24px clamp(20px,4vw,48px) 40px;overflow-y:auto;overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);}",
      ".dsh-auto-workspace-scroll>.dsh-auto-root{width:100%;margin:0 auto;padding-top:0;}",
      ".dsh-auto-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;}",
      ".dsh-auto-root{--dsh-auto-border:var(--dsw-alias-border-l2,rgba(15,17,21,.14));--dsh-auto-surface:var(--dsw-alias-bg-layer-3,#fff);--dsh-auto-surface-active:var(--dsw-alias-bg-layer-2,#fff);--dsh-auto-input-bg:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff));--dsh-auto-text:var(--dsw-alias-label-primary,#0f1115);--dsh-auto-text-secondary:var(--dsw-alias-label-secondary,#4f5661);--dsh-auto-muted:var(--dsw-alias-label-tertiary,#81858c);--dsh-auto-caption:var(--dsw-alias-label-caption,#adb2b8);--dsh-auto-accent:var(--dsw-alias-state-business-primary,#4176e6);--dsh-auto-danger:var(--dsw-alias-state-error-primary,#ec1313);--dsh-auto-success:var(--dsw-alias-state-success-primary,#22c55e);--dsh-auto-warning:var(--dsw-alias-state-warn-primary,#f59e0b);box-sizing:border-box;max-width:820px;padding-top:12px;display:flex;flex-direction:column;gap:16px;font-family:inherit;color:var(--dsh-auto-text);}",
      ".dsh-auto-root-workspace{max-width:960px;}",
      "body:not([data-ds-dark-theme]) .dsh-auto-root{color-scheme:light;}",
      "body[data-ds-dark-theme] .dsh-auto-root{color-scheme:dark;}",
      ".dsh-auto-root *,.dsh-auto-root *::before,.dsh-auto-root *::after{box-sizing:border-box;}",
      ".dsh-auto-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
      ".dsh-auto-head h2{margin:0;font-size:18px;font-weight:600;line-height:1.35;}",
      ".dsh-auto-sub{margin:3px 0 0;font-size:13px;line-height:20px;color:var(--dsh-auto-muted);max-width:560px;}",
      ".dsh-auto-flash{margin:0;padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.45;word-break:break-word;}",
      ".dsh-auto-flash-error{background:color-mix(in srgb,var(--dsh-auto-danger) 12%,transparent);color:var(--dsh-auto-danger);}",
      ".dsh-auto-flash-success{background:color-mix(in srgb,var(--dsh-auto-success) 12%,transparent);color:var(--dsh-auto-success);}",
      ".dsh-auto-flash-warn{background:color-mix(in srgb,var(--dsh-auto-warning) 12%,transparent);color:var(--dsh-auto-warning);}",
      ".dsh-auto-linkbtn{appearance:none;font:inherit;font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer;background:none;border:none;padding:0;}",
      ".dsh-auto-danger-button{color:var(--dsh-auto-danger);}",
      ".dsh-auto-danger-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,color-mix(in srgb,var(--dsh-auto-danger) 10%,transparent));}",
      ".dsh-auto-input,.dsh-auto-select,.dsh-auto-textarea{width:100%;min-height:36px;padding:6px 11px;border:1px solid var(--dsh-auto-border);border-radius:8px;background:var(--dsh-auto-input-bg);color:var(--dsh-auto-text);font-family:inherit;font-size:14px;line-height:22px;}",
      ".dsh-auto-input,.dsh-auto-textarea{appearance:none;}",
      ".dsh-auto-input::placeholder,.dsh-auto-textarea::placeholder{color:var(--dsh-auto-caption);}",
      ".dsh-auto-select option{background:var(--dsh-auto-input-bg);color:var(--dsh-auto-text);}",
      ".dsh-auto-input:focus-visible,.dsh-auto-select:focus-visible,.dsh-auto-textarea:focus-visible{outline:none;border-color:var(--dsh-auto-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsh-auto-accent) 18%,transparent);}",
      ".dsh-auto-input[aria-invalid=\"true\"],.dsh-auto-select[aria-invalid=\"true\"],.dsh-auto-textarea[aria-invalid=\"true\"]{border-color:var(--dsh-auto-danger);}",
      ".dsh-auto-input:disabled,.dsh-auto-select:disabled,.dsh-auto-textarea:disabled{opacity:1;color:var(--dsh-auto-muted);background:var(--dsh-auto-surface-active);cursor:default;}",
      ".dsh-auto-picker-root{width:100%;display:flex;}",
      ".dsh-auto-picker-trigger{appearance:none;width:100%;height:36px;padding:0 11px;border:1px solid var(--dsh-auto-border);border-radius:8px;background:var(--dsh-auto-input-bg);color:var(--dsh-auto-text);display:flex;align-items:center;gap:8px;font-family:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer;}",
      ".dsh-auto-picker-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsh-auto-input-bg));}",
      ".dsh-auto-picker-trigger:focus-visible{outline:none;border-color:var(--dsh-auto-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsh-auto-accent) 18%,transparent);}",
      ".dsh-auto-picker-trigger-icon{flex:none;color:var(--dsh-auto-muted);}",
      ".dsh-auto-picker-trigger-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsh-auto-picker-chevron{flex:none;color:var(--dsh-auto-muted);transition:transform .12s ease;}",
      ".dsh-auto-picker-chevron-open{transform:rotate(180deg);}",
      ".dsh-auto-picker-item-copy{min-width:0;display:flex;flex-direction:column;white-space:normal;}",
      ".dsh-auto-picker-item-label{color:inherit;font-size:14px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsh-auto-picker-item-detail{color:var(--dsh-auto-muted,var(--dsw-alias-label-tertiary,#81858c));font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsh-auto-combobox-control{width:100%;height:36px;padding:0 10px;display:flex;align-items:center;gap:8px;border:1px solid var(--dsh-auto-border);border-radius:8px;background:var(--dsh-auto-input-bg);color:var(--dsh-auto-text);cursor:text;}",
      ".dsh-auto-combobox-control:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsh-auto-input-bg));}",
      ".dsh-auto-combobox-control:focus-within,.dsh-auto-combobox-control[data-open=\"true\"]{border-color:var(--dsh-auto-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsh-auto-accent) 18%,transparent);}",
      ".dsh-auto-combobox-control:has(.dsh-auto-combobox-input[aria-invalid=\"true\"]){border-color:var(--dsh-auto-danger);}",
      ".dsh-auto-combobox-control:has(.dsh-auto-combobox-input:disabled){background:var(--dsh-auto-surface-active);color:var(--dsh-auto-muted);cursor:default;}",
      ".dsh-auto-combobox-control-icon,.dsh-auto-combobox-chevron{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsh-auto-muted);pointer-events:none;}",
      ".dsh-auto-combobox-input{appearance:none;min-width:0;height:100%;flex:1;padding:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:22px;}",
      ".dsh-auto-combobox-input::placeholder{color:var(--dsh-auto-caption);}",
      ".dsh-auto-combobox-input:disabled{cursor:default;}",
      ".dsh-auto-combobox-chevron{transition:transform .12s ease;}",
      ".dsh-auto-combobox-chevron-open{transform:rotate(180deg);}",
      ".dsh-auto-combobox-popover{box-sizing:border-box;position:fixed;z-index:1100;max-height:min(360px,calc(100vh - 24px));padding:4px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-inverted,var(--dsw-alias-border-l2,rgba(15,17,21,.16)));border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#fff));box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(15,17,21,.16));color:var(--dsw-alias-label-primary,#0f1115);font-family:inherit;}",
      ".dsh-auto-combobox-popover *,.dsh-auto-combobox-popover *::before,.dsh-auto-combobox-popover *::after{box-sizing:border-box;}",
      ".dsh-auto-combobox-popover-title{flex:none;padding:7px 10px 5px;color:var(--dsw-alias-label-tertiary,#81858c);font-size:11px;font-weight:600;line-height:16px;text-transform:uppercase;letter-spacing:.04em;}",
      ".dsh-auto-combobox-group-title{flex:none;padding:8px 9px 3px;color:var(--dsw-alias-label-tertiary,#81858c);font-size:11px;font-weight:600;line-height:16px;}",
      ".dsh-auto-combobox-group-title:first-child{padding-top:5px;}",
      ".dsh-auto-combobox-notice{flex:none;margin:2px 4px 4px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06)));color:var(--dsw-alias-label-secondary,#4f5661);font-size:12px;line-height:18px;}",
      ".dsh-auto-combobox-list{min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);}",
      ".dsh-auto-combobox-option{width:100%;min-height:48px;padding:6px 9px;display:flex;align-items:center;gap:8px;border-radius:9px;cursor:pointer;user-select:none;}",
      ".dsh-auto-combobox-option:hover,.dsh-auto-combobox-option[data-active=\"true\"]{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));}",
      ".dsh-auto-combobox-option[data-disabled=\"true\"]{cursor:default;color:var(--dsw-alias-label-dimmed,var(--dsh-auto-caption));}",
      ".dsh-auto-combobox-option[data-disabled=\"true\"]:hover{background:transparent;}",
      ".dsh-auto-combobox-option[aria-selected=\"true\"]{color:var(--dsw-alias-state-business-primary,#4176e6);}",
      ".dsh-auto-combobox-option-icon,.dsh-auto-combobox-option-check{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#81858c);}",
      ".dsh-auto-combobox-option>.dsh-auto-picker-item-copy{min-width:0;flex:1;}",
      ".dsh-auto-combobox-option .dsh-auto-picker-item-detail{color:var(--dsw-alias-label-tertiary,#81858c);}",
      ".dsh-auto-combobox-option-check{color:var(--dsw-alias-state-business-primary,#4176e6);}",
      ".dsh-auto-combobox-empty{margin:0;padding:16px 12px;color:var(--dsw-alias-label-secondary,#4f5661);font-size:12px;line-height:18px;text-align:center;}",
      ".dsh-auto-combobox-popover-hint{flex:none;margin:4px 0 0;padding:7px 10px 5px;border-top:1px solid var(--dsw-alias-border-l2,rgba(15,17,21,.12));color:var(--dsw-alias-label-tertiary,#81858c);font-size:11px;line-height:16px;}",
      ".dsh-auto-permission-glyph{flex:none;}",
      ".dsh-auto-permission-glyph-read{color:var(--dsh-auto-muted);}",
      ".dsh-auto-permission-glyph-write{color:var(--dsh-auto-accent);}",
      ".dsh-auto-permission-glyph-danger{color:var(--dsh-auto-danger);}",
      ".dsh-auto-permission-glyph-custom{color:var(--dsh-auto-muted);}",
      ".dsh-auto-textarea{resize:vertical;min-height:120px;}",
      ".dsh-auto-prompt{min-height:154px;line-height:22px;}",
      ".dsh-auto-check{display:inline-flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;min-height:34px;}",
      ".dsh-auto-check input{width:16px;height:16px;margin:0;accent-color:var(--dsh-auto-accent);cursor:pointer;}",
      ".dsh-auto-form{box-sizing:border-box;width:min(100%,780px);margin:0 auto;padding:0 0 4px;background:transparent;display:flex;flex-direction:column;gap:18px;}",
      ".dsh-auto-form-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:2px 2px 0;}",
      ".dsh-auto-form-heading{min-width:0;display:flex;flex-direction:column;gap:4px;}",
      ".dsh-auto-form h3{margin:0;font-size:18px;font-weight:600;line-height:26px;}",
      ".dsh-auto-form-heading p{margin:0;color:var(--dsh-auto-muted);font-size:13px;line-height:20px;}",
      ".dsh-auto-form-enabled{flex:none;margin-top:1px;padding:6px 10px;border:1px solid var(--dsh-auto-border);border-radius:999px;background:var(--dsh-auto-surface);font-size:13px;line-height:20px;}",
      ".dsh-auto-form-section,.dsh-auto-advanced{border:1px solid var(--dsh-auto-border);border-radius:14px;background:var(--dsh-auto-surface);box-shadow:0 1px 1px color-mix(in srgb,var(--dsh-auto-text) 4%,transparent);}",
      ".dsh-auto-form-section{padding:18px;display:flex;flex-direction:column;gap:18px;}",
      ".dsh-auto-form-section-head{display:flex;align-items:flex-start;gap:12px;}",
      ".dsh-auto-form-section-icon{width:34px;height:34px;flex:none;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsh-auto-accent);background:color-mix(in srgb,var(--dsh-auto-accent) 10%,transparent);}",
      ".dsh-auto-form-section-copy{min-width:0;display:flex;flex-direction:column;gap:2px;}",
      ".dsh-auto-form-section-title{margin:0;color:var(--dsh-auto-text);font-size:16px;font-weight:600;line-height:22px;}",
      ".dsh-auto-form-section-description{margin:0;color:var(--dsh-auto-muted);font-size:12px;line-height:18px;}",
      ".dsh-auto-formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 14px;}",
      ".dsh-auto-field{display:flex;flex-direction:column;gap:6px;min-width:0;}",
      ".dsh-auto-field-full{grid-column:1/-1;}",
      ".dsh-auto-label{font-size:14px;font-weight:400;line-height:22px;color:var(--dsh-auto-text-secondary);}",
      ".dsh-auto-required{color:var(--dsh-auto-danger);}",
      ".dsh-auto-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsh-auto-muted);}",
      ".dsh-auto-schedule-modes{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
      ".dsh-auto-schedule-modes button{height:32px;padding:0 11px;border-radius:16px;font-size:14px;line-height:22px;}",
      ".dsh-auto-schedule-summary{min-height:48px;padding:11px 13px;border:1px solid color-mix(in srgb,var(--dsh-auto-accent) 20%,var(--dsh-auto-border));border-radius:10px;background:color-mix(in srgb,var(--dsh-auto-accent) 6%,var(--dsh-auto-input-bg));display:flex;align-items:center;justify-content:space-between;gap:12px;}",
      ".dsh-auto-schedule-summary-copy{min-width:0;color:var(--dsh-auto-text-secondary);font-size:14px;font-weight:400;line-height:22px;}",
      ".dsh-auto-schedule-expression{min-width:0;max-width:100%;flex:none;padding:3px 7px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsh-auto-muted);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".dsh-auto-cron-input{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;letter-spacing:.02em;}",
      ".dsh-auto-cron-guide{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:4px;}",
      ".dsh-auto-cron-guide-field{min-width:0;padding:9px 7px;border:1px solid var(--dsh-auto-border);border-radius:9px;background:var(--dsh-auto-input-bg);text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px;}",
      ".dsh-auto-cron-guide-value{max-width:100%;overflow:hidden;text-overflow:ellipsis;color:var(--dsh-auto-text);font-size:14px;font-weight:600;line-height:20px;}",
      ".dsh-auto-cron-guide-label{color:var(--dsh-auto-text-secondary);font-size:12px;font-weight:500;line-height:18px;}",
      ".dsh-auto-cron-guide-range{color:var(--dsh-auto-caption);font-size:10px;line-height:14px;}",
      ".dsh-auto-cron-syntax{margin:0;color:var(--dsh-auto-muted);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:18px;}",
      ".dsh-auto-advanced{overflow:hidden;}",
      ".dsh-auto-advanced-trigger{box-sizing:border-box;width:100%;min-height:72px;padding:16px 18px;border:0;background:transparent;color:inherit;text-align:left;font:inherit;display:flex;align-items:center;gap:12px;cursor:pointer;}",
      ".dsh-auto-advanced-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));}",
      ".dsh-auto-advanced-trigger:focus-visible{outline:2px solid var(--dsh-auto-accent);outline-offset:-2px;border-radius:13px;}",
      ".dsh-auto-advanced-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px;}",
      ".dsh-auto-advanced-summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsh-auto-muted);font-size:12px;line-height:18px;}",
      ".dsh-auto-advanced-chevron{flex:none;color:var(--dsh-auto-muted);transition:transform .15s ease;}",
      ".dsh-auto-advanced-chevron-open{transform:rotate(180deg);}",
      ".dsh-auto-advanced-content{margin:0 18px;padding:18px 0;border-top:1px solid var(--dsh-auto-border);}",
      ".dsh-auto-advanced-content[hidden]{display:none;}",
      ".dsh-auto-form-footer{position:sticky;z-index:4;bottom:8px;align-self:flex-end;max-width:100%;padding:10px 11px;border:1px solid var(--dsh-auto-border);border-radius:12px;background:var(--dsh-auto-surface);box-shadow:var(--dsw-shadow-lv2,0 6px 18px rgba(15,17,21,.12));display:flex;flex-direction:column;gap:8px;}",
      ".dsh-auto-formerror{margin:0;padding:9px 11px;border-radius:8px;background:color-mix(in srgb,var(--dsh-auto-danger) 10%,transparent);color:var(--dsh-auto-danger);font-size:13px;line-height:20px;}",
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
      ".dsh-auto-card-permission{display:inline-flex;align-items:center;gap:4px;}",
      ".dsh-auto-card-permission svg{width:14px;height:14px;}",
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
      "@container dsh-auto-workspace (max-width:680px){.dsh-auto-formgrid{grid-template-columns:1fr;}.dsh-auto-form-header{align-items:center;}.dsh-auto-schedule-summary{align-items:flex-start;flex-direction:column;}.dsh-auto-card-head{flex-direction:column;align-items:flex-start;}.dsh-auto-run-name{max-width:150px;}}",
      "@container dsh-auto-workspace (max-width:460px){.dsh-auto-form-header{align-items:flex-start;flex-direction:column;}.dsh-auto-cron-guide{grid-template-columns:repeat(2,minmax(0,1fr));}.dsh-auto-cron-guide-field:last-child{grid-column:1/-1;}}",
      "@media (max-width:640px){.dsh-auto-workspace-toolbar{padding-inline:8px;}.dsh-auto-workspace-scroll{padding:16px 14px 28px;}.dsh-auto-formgrid{grid-template-columns:1fr;}.dsh-auto-form-header{align-items:center;}.dsh-auto-form-section{padding:16px;}.dsh-auto-advanced-trigger{padding:14px 15px;}.dsh-auto-advanced-content{margin-inline:15px;padding-block:16px;}.dsh-auto-schedule-summary{align-items:flex-start;flex-direction:column;}.dsh-auto-cron-guide{gap:4px;}.dsh-auto-cron-guide-field{padding-inline:4px;}.dsh-auto-card-head{flex-direction:column;align-items:flex-start;}.dsh-auto-run-name{max-width:150px;}}",
      "@media (max-width:480px){.dsh-auto-form-header{align-items:flex-start;flex-direction:column;}.dsh-auto-cron-guide{grid-template-columns:repeat(2,minmax(0,1fr));}.dsh-auto-cron-guide-field:last-child{grid-column:1/-1;}}",
    ].join("\n");

    function apply(ctx) {
      const disclosure = createDisclosureStore();
      let centerDeclared = false;
      let disposeCenter = null;
      const unmountCenter = () => {
        if (!disposeCenter) return;
        const dispose = disposeCenter;
        disposeCenter = null;
        dispose();
      };
      const mountCenter = () => {
        if (!centerDeclared || !disclosure.getSnapshot() || disposeCenter) return;
        try {
          disposeCenter = ctx.slots.register({
            name: "conversation",
            priority: -200,
            inject: () => ({ disclosure, workspaceRuntime: ctx.workspaces }),
          }, AutomationsWorkspace);
        } catch (error) {
          console.error("dsh automations: could not mount center workspace", error);
          disclosure.close();
        }
      };

      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.setAttribute("data-plugin", "@syncended/dsh-automations");
        tag.textContent = STYLE_CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, "@syncended/dsh-automations: client styles");
      ctx.effect(
        () => installAutomationHistoryBadges(ctx),
        "@syncended/dsh-automations: history badges",
      );
      ctx.effect(
        () => ctx.slots.inject("conversation", () => {
          centerDeclared = true;
          mountCenter();
          return () => {
            centerDeclared = false;
            unmountCenter();
          };
        }),
        "@syncended/dsh-automations: center workspace",
      );
      ctx.effect(() => {
        const unsubscribe = disclosure.subscribe(() => {
          if (disclosure.getSnapshot()) mountCenter();
          else unmountCenter();
        });
        return () => {
          unsubscribe();
          unmountCenter();
          disclosure.dispose();
        };
      }, "@syncended/dsh-automations: workspace state");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "automations",
        order: 25,
        label: "Automations",
        inject: () => ({ workspaceRuntime: ctx.workspaces }),
      }, AutomationsSection));
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "automations",
        order: 50,
        label: "Automations",
        inject: () => ({ disclosure }),
      }, AutomationsSidebarAction));
    }

    exports.agentPresetDisplayLabel = agentPresetDisplayLabel;
    exports.permissionPresetPresentation = permissionPresetPresentation;
    exports.PermissionPresetPicker = PermissionPresetPicker;
    exports.EditableCombobox = EditableCombobox;
    exports.ScheduleEditor = ScheduleEditor;
    exports.WorkspacePicker = WorkspacePicker;
    exports.ModelPicker = ModelPicker;
    exports.ReasoningEffortPicker = ReasoningEffortPicker;
    exports.TimeZonePicker = TimeZonePicker;
    exports.__testing = Object.freeze({
      nextFormInstancePrefix,
      canonicalTimezone,
      cronFields,
      simpleSchedule,
      scheduleControlValues,
      cronForSimpleSchedule,
      scheduleModeTransition,
      describeSimpleSchedule,
      inferFormErrorField,
      overlapPolicySummary,
      comboboxSearchResults,
      looksLikeAbsolutePath,
      normalizedWorkspaces,
      preferredWorkspacePath,
      normalizedProviders,
      providerFallbackName,
      modelRoute,
      parseModelRoute,
      modelOptionId,
      sidebarWorkspaceRegion,
      workspaceNavigationRowFromClick,
      automationMarkableTitles,
      automationHistoryRowTitle,
      decorateAutomationHistoryRows,
      reasoningEffortsForState,
      timezoneOffsetLabel,
      timezoneNavigationIndex,
      timezoneOptionPresentation,
      timezonePreferredValue,
      timezoneSearchResults,
    });
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
