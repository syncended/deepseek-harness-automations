import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientPath = new URL('../lib/client.js', import.meta.url)
const packagePath = new URL('../package.json', import.meta.url)

const reactStub = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useCallback(callback) {
    return callback
  },
  useEffect() {},
  useId() {
    return 'automation-dialog-title'
  },
  useRef(value) {
    return { current: value }
  },
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

const reactDomStub = {
  createPortal(child, target) {
    return { type: 'portal', child, target }
  },
}

const primitivesStub = new Proxy({}, {
  get(target, property) {
    if (!(property in target)) target[property] = () => null
    return target[property]
  },
})

function treeNodes(value) {
  const nodes = []
  const visit = (entry) => {
    if (Array.isArray(entry)) return entry.forEach(visit)
    if (!entry || typeof entry !== 'object') return
    nodes.push(entry)
    visit(entry.children)
  }
  visit(value)
  return nodes
}

async function loadClientPlugin() {
  const source = await readFile(clientPath, 'utf8')
  let plugin
  const window = {
    innerWidth: 1440,
    __ModuleLoader__: {
      load(definition) {
        plugin = definition.factory((id) => {
          if (id === 'react') return reactStub
          if (id === 'react-dom') return reactDomStub
          if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
          assert.fail(`unexpected client dependency: ${id}`)
        })
      },
    },
  }
  vm.runInNewContext(source, {
    window,
    Set,
    Array,
    Object,
    Intl,
    Error,
    String,
    Number,
    RegExp,
    Node: class Node {},
    requestAnimationFrame(callback) {
      callback()
      return 1
    },
    cancelAnimationFrame() {},
  })
  return { plugin, source }
}

function createClientContext() {
  const registrations = []
  const injections = []
  const injectionControls = []
  const effectDisposers = []
  const workspaceSnapshot = {
    items: [{ workspaceId: 'workspace-test', title: 'Test workspace', path: '/work/test', sessionIds: [] }],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  const workspaceRuntime = {
    list: {
      getSnapshot: () => workspaceSnapshot,
      subscribe: () => () => {},
    },
  }
  const sessionsRuntime = {
    list: {
      getSnapshot: () => ({ ids: [], byId: {}, current: 'session-current' }),
      subscribe: () => () => {},
    },
  }
  const ctx = {
    workspaces: workspaceRuntime,
    sessions: sessionsRuntime,
    effect(run, label = '') {
      if (!/center workspace|workspace state/.test(label)) return undefined
      const dispose = run()
      if (typeof dispose === 'function') effectDisposers.push(dispose)
      return dispose
    },
    slots: {
      inject(name, install) {
        injections.push(name)
        const control = {
          name,
          activeDisposer: undefined,
          declare() {
            if (this.activeDisposer !== undefined) return
            const dispose = install()
            this.activeDisposer = typeof dispose === 'function' ? dispose : null
          },
          collapse() {
            if (typeof this.activeDisposer === 'function') this.activeDisposer()
            this.activeDisposer = undefined
          },
        }
        injectionControls.push(control)
        control.declare()
        return () => control.collapse()
      },
      register(options, component) {
        const registration = { options, component, disposed: false }
        registrations.push(registration)
        return () => {
          registration.disposed = true
        }
      },
    },
  }
  return {
    ctx,
    registrations,
    injections,
    injectionControls,
    workspaceRuntime,
    sessionsRuntime,
    disposeEffects() {
      for (const dispose of effectDisposers.reverse()) dispose()
    },
  }
}

test('renders CJK preset metadata with stable English identifiers', async () => {
  const { plugin, source } = await loadClientPlugin()
  assert.equal(plugin.agentPresetDisplayLabel({ id: 'standard', name: '标准模式' }), 'Standard mode (standard)')
  assert.equal(plugin.agentPresetDisplayLabel({ id: 'code', name: 'PTC 模式' }), 'PTC mode (code)')
  assert.equal(plugin.agentPresetDisplayLabel({ id: 'minimal', name: '极简模式' }), 'Minimal mode (minimal)')
  assert.equal(plugin.agentPresetDisplayLabel({ id: 'cordis', name: '创造模式' }), 'Creator mode (cordis)')
  assert.equal(plugin.agentPresetDisplayLabel({ id: 'review', name: 'Review mode' }), 'Review mode (review)')
  assert.equal(plugin.agentPresetDisplayLabel({ id: 'my-preset', name: 'my-preset' }), 'My Preset (my-preset)')
  assert.equal(plugin.agentPresetDisplayLabel({ id: '', name: '标准模式' }), 'Unknown preset')
  assert.ok((source.match(/agentPresetDisplayLabel\(/g) ?? []).length >= 3)
})

test('marks only unambiguous automation session titles for history badges', async () => {
  const { plugin, source } = await loadClientPlugin()
  const snapshot = {
    ids: ['auto-1', 'auto-2', 'manual-1'],
    byId: {
      'auto-1': { displayTitle: 'Nightly sync', blank: false },
      'auto-2': { displayTitle: 'Nightly sync', blank: false },
      'manual-1': { displayTitle: 'Planning', blank: false },
    },
  }
  assert.deepEqual(
    Array.from(plugin.__testing.automationMarkableTitles(snapshot, new Set(['auto-1', 'auto-2']))),
    ['Nightly sync'],
  )

  snapshot.ids.push('manual-2')
  snapshot.byId['manual-2'] = { displayTitle: 'Nightly sync', blank: false }
  assert.deepEqual(
    Array.from(plugin.__testing.automationMarkableTitles(snapshot, new Set(['auto-1', 'auto-2']))),
    [],
  )
  const status = { tagName: 'SPAN', childElementCount: 1, textContent: 'Running' }
  const title = { tagName: 'SPAN', childElementCount: 0, textContent: 'Running' }
  const time = { tagName: 'SPAN', childElementCount: 0, textContent: 'now' }
  assert.equal(plugin.__testing.automationHistoryRowTitle({
    tagName: 'DIV',
    children: [status, title, time],
  }), title)
  const searchTitle = { tagName: 'SPAN', childElementCount: 0, textContent: 'Nightly sync' }
  assert.equal(plugin.__testing.automationHistoryRowTitle({
    tagName: 'BUTTON',
    children: [{ tagName: 'SPAN', childElementCount: 2, children: [status, searchTitle] }],
  }), searchTitle)
  assert.match(source, /apiFetch\("\/sessions"/)
  assert.match(source, /data-dsh-automation-history/)
  assert.match(source, /observer\.observe\(document\.body/)
  assert.match(source, /aria-selected/)
})

test('presents permission presets with distinct DSH icons and plain-language detail', async () => {
  const { plugin, source } = await loadClientPlugin()
  const readOnly = plugin.permissionPresetPresentation('read-only')
  const workspaceWrite = plugin.permissionPresetPresentation('workspace-write')
  const fullAccess = plugin.permissionPresetPresentation('danger-full-access')

  assert.deepEqual(
    [readOnly.label, workspaceWrite.label, fullAccess.label],
    ['Read Only', 'Workspace Write', 'Full access'],
  )
  assert.match(readOnly.detail, /without modifying/i)
  assert.match(workspaceWrite.detail, /wider retries require approval/i)
  assert.match(fullAccess.detail, /without approval prompts/i)
  assert.notEqual(readOnly.icon, workspaceWrite.icon)
  assert.notEqual(workspaceWrite.icon, fullAccess.icon)
  const changes = []
  const pickerTree = plugin.PermissionPresetPicker({
    id: 'permission-picker',
    value: 'workspace-write',
    presets: ['read-only', 'workspace-write', 'danger-full-access'],
    onChange: (value) => changes.push(value),
  })
  assert.equal(pickerTree.type, reactStub.Fragment)
  const picker = pickerTree.children[0]
  const risk = pickerTree.children[1]
  assert.equal(picker.type, primitivesStub.Menu)
  assert.equal(picker.props.side, 'top')
  assert.equal(picker.props.portal, true)
  assert.equal(picker.props.selectedId, 'workspace-write')
  assert.deepEqual(Array.from(picker.props.items, ({ id }) => id), ['read-only', 'workspace-write', 'danger-full-access'])
  assert.equal(picker.props.items[2].danger, true)
  assert.equal(picker.props.anchor.props['data-permission-preset'], 'workspace-write')
  assert.equal(risk.type, primitivesStub.RiskConfirmation)
  assert.match(risk.props.description, /scheduled agents/i)

  picker.props.onSelect('read-only')
  assert.deepEqual(changes, ['read-only'])
  picker.props.onSelect('danger-full-access')
  assert.deepEqual(changes, ['read-only'], 'Full access must wait for risk confirmation')
  risk.props.onConfirm()
  assert.deepEqual(changes, ['read-only', 'danger-full-access'])

  assert.match(source, /function PermissionPresetPicker/)
  assert.match(source, /h\(RiskConfirmation/)
  assert.match(source, /usePickerMenuNavigation/)
  assert.match(source, /useRiskConfirmationFocus/)
  assert.match(source, /event\.key === "ArrowDown"/)
  assert.match(source, /focusAfterPickerTab/)
  assert.match(source, /stopImmediatePropagation/)
  assert.match(source, /data-permission-preset/)
  assert.match(source, /h\(PermissionPresetIcon, \{ value: job\.execution\.permissionPreset \}\)/)
})

test('allocates unique form prefixes when separate React roots reuse useId values', async () => {
  const { plugin, source } = await loadClientPlugin()
  const first = plugin.__testing.nextFormInstancePrefix('same-react-id')
  const second = plugin.__testing.nextFormInstancePrefix('same-react-id')
  assert.notEqual(first, second)
  assert.match(first, /^dsh-auto-form-\d+-same-react-id$/)
  assert.match(second, /^dsh-auto-form-\d+-same-react-id$/)
  assert.match(source, /formPrefixRef\.current = nextFormInstancePrefix\(reactFormId\)/)
})

test('offers an accessible searchable IANA time zone combobox', async () => {
  const { plugin, source } = await loadClientPlugin()
  const search = plugin.__testing.timezoneSearchResults

  assert.equal(search('', 'Europe/Paris')[0], 'Europe/Paris')
  assert.ok(search('new york', '').includes('America/New_York'))
  assert.ok(search('buenos aires', '').some((zone) => zone.endsWith('/Buenos_Aires')))
  assert.ok(search('São Paulo', '').includes('America/Sao_Paulo'))
  assert.ok(search('moscow', '').includes('Europe/Moscow'))
  for (const [query, alias] of [
    ['kolkata', 'Asia/Kolkata'],
    ['kyiv', 'Europe/Kyiv'],
    ['nuuk', 'America/Nuuk'],
  ]) {
    const canonical = plugin.__testing.canonicalTimezone(alias)
    assert.ok(search(query, '').includes(canonical), `${query} must find ${canonical}`)
    assert.equal(plugin.__testing.timezonePreferredValue(canonical), alias)
  }
  assert.deepEqual(Array.from(search('.', '')), [])
  assert.deepEqual(Array.from(search('/', '')), [])
  const reopened = search('mos', 'mos')
  assert.ok(reopened.length > 1)
  assert.equal(plugin.__testing.timezoneNavigationIndex('ArrowDown', -1, reopened.length, true), 0)
  assert.equal(plugin.__testing.timezoneNavigationIndex('ArrowUp', -1, reopened.length, true), reopened.length - 1)
  assert.equal(plugin.__testing.canonicalTimezone('europe/berlin'), 'Europe/Berlin')
  assert.match(plugin.__testing.timezoneOffsetLabel('UTC'), /^UTC\+00:00$/)
  const copy = plugin.__testing.timezoneOptionPresentation('Europe/Moscow')
  assert.equal(copy.label, 'Moscow')
  assert.match(copy.detail, /^Europe\/Moscow · UTC[+-]\d{2}:\d{2} now/)
  const kolkata = plugin.__testing.timezoneOptionPresentation(plugin.__testing.canonicalTimezone('Asia/Kolkata'))
  assert.equal(kolkata.label, 'Kolkata')
  assert.match(kolkata.detail, /^Asia\/Kolkata · UTC[+-]\d{2}:\d{2} now/)

  const pickerNode = plugin.TimeZonePicker({ id: 'timezone-field', value: 'UTC', onChange() {} })
  const picker = pickerNode.type(pickerNode.props)
  const control = picker.children[0]
  const input = control.children[1]
  assert.equal(input.type, 'input')
  assert.equal(input.props.role, 'combobox')
  assert.equal(input.props['aria-autocomplete'], 'list')
  assert.equal(input.props['aria-haspopup'], 'listbox')
  assert.equal(input.props.list, undefined)
  let homePrevented = false
  input.props.onKeyDown({ key: 'Home', preventDefault() { homePrevented = true } })
  assert.equal(homePrevented, false, 'Home must retain native text-caret behavior')

  assert.match(source, /role: "listbox"/)
  assert.match(source, /role: "option"/)
  assert.match(source, /className: "dsh-auto-combobox-empty",\s+role: "option",\s+"aria-disabled": "true"/)
  assert.match(source, /"aria-activedescendant"/)
  assert.match(source, /createPortal\(panel, document\.body\)/)
  assert.doesNotMatch(source, /fieldId\("timezone-list"\)/)
})

test('offers readable schedule presets with an explained custom cron mode', async () => {
  const { plugin, source } = await loadClientPlugin()
  const schedule = plugin.__testing.simpleSchedule
  assert.equal(schedule('*/15 * * * *').mode, 'minutes')
  assert.equal(schedule('17 * * * *').mode, 'hourly')
  assert.equal(schedule('59 * * * *').minute, 59)
  assert.equal(schedule('0 6 * * *').mode, 'daily')
  assert.equal(schedule('30 8 * * 1-5').mode, 'weekdays')
  assert.equal(schedule('45 18 * * 5').mode, 'weekly')
  assert.equal(schedule('0 9 1 * *').mode, 'custom')
  assert.deepEqual(
    { ...plugin.__testing.scheduleControlValues('30 14 * * 5') },
    { minute: 30, hour: 14, weekday: '5', interval: 15 },
  )
  assert.deepEqual(
    { ...plugin.__testing.scheduleControlValues('*/20 * * * *', { minute: 30, hour: 14, weekday: '5' }) },
    { minute: 30, hour: 14, weekday: '5', interval: 20 },
  )
  assert.deepEqual(
    { ...plugin.__testing.scheduleControlValues('30 8 * * MON-FRI') },
    { minute: 30, hour: 8, weekday: '1', interval: 15 },
  )
  assert.equal(plugin.__testing.cronForSimpleSchedule('minutes', { interval: 20 }), '*/20 * * * *')
  assert.equal(plugin.__testing.cronForSimpleSchedule('hourly', { minute: 10 }), '10 * * * *')
  assert.equal(plugin.__testing.cronForSimpleSchedule('daily', { hour: 7, minute: 5 }), '5 7 * * *')
  assert.equal(plugin.__testing.cronForSimpleSchedule('weekdays', { hour: 9, minute: 30 }), '30 9 * * 1-5')
  assert.equal(plugin.__testing.cronForSimpleSchedule('weekly', { hour: 18, minute: 45, weekday: '5' }), '45 18 * * 5')
  const customCron = '0 9 1 * *'
  const customValues = plugin.__testing.scheduleControlValues(customCron)
  const dailyTransition = plugin.__testing.scheduleModeTransition('daily', customCron, customValues, customCron)
  assert.equal(dailyTransition.cron, '0 9 * * *')
  assert.equal(dailyTransition.customCron, customCron)
  assert.equal(
    plugin.__testing.scheduleModeTransition('custom', dailyTransition.cron, customValues, dailyTransition.customCron).cron,
    customCron,
  )
  const weeklyValues = plugin.__testing.scheduleControlValues('30 14 * * 5')
  assert.equal(plugin.__testing.scheduleModeTransition('minutes', '30 14 * * 5', weeklyValues, null).cron, '*/15 * * * *')
  assert.equal(plugin.__testing.scheduleModeTransition('weekly', '*/15 * * * *', weeklyValues, null).cron, '30 14 * * 5')
  assert.equal(plugin.__testing.describeSimpleSchedule(schedule('30 8 * * 1-5'), 'Europe/Moscow'), 'Monday–Friday at 08:30 · Europe/Moscow')
  assert.equal(plugin.__testing.describeSimpleSchedule({ mode: 'custom', cron: '0 9 * * *' }, 'UTC'), 'Custom five-field schedule · UTC')
  assert.equal(plugin.__testing.describeSimpleSchedule({ mode: 'custom', cron: '0 9 * *' }, 'UTC'), 'Cron needs exactly five fields · UTC')
  assert.equal(plugin.__testing.overlapPolicySummary('skip'), 'Skip overlaps')
  assert.equal(plugin.__testing.overlapPolicySummary('queue'), 'Queue overlaps')
  assert.equal(plugin.__testing.overlapPolicySummary('allow'), 'Allow concurrent runs')
  assert.equal(plugin.__testing.inferFormErrorField('Timeout must be a whole number.'), 'timeout')
  assert.equal(plugin.__testing.inferFormErrorField('invalid cron expression'), 'cron')
  assert.equal(plugin.__testing.inferFormErrorField('unrelated server error'), null)

  const changes = []
  const tree = plugin.ScheduleEditor({
    fieldId: (name) => 'schedule-' + name,
    cron: '30 8 * * 1-5',
    timezone: 'Europe/Moscow',
    onCronChange: (value) => changes.push(value),
    onTimezoneChange() {},
  })
  const nodes = treeNodes(tree)
  const weekdayPill = nodes.find((node) => node.type === primitivesStub.Pill && node.children[0] === 'Weekdays')
  const dailyPill = nodes.find((node) => node.type === primitivesStub.Pill && node.children[0] === 'Daily')
  assert.equal(weekdayPill.props.active, true)
  assert.equal(weekdayPill.props['aria-pressed'], true)
  dailyPill.props.onClick()
  assert.equal(changes.at(-1), '30 8 * * *')
  const time = nodes.find((node) => node.type === 'input' && node.props.type === 'time')
  assert.equal(time.props.value, '08:30')
  time.props.onChange({ target: { value: '09:45' } })
  assert.equal(changes.at(-1), '45 9 * * 1-5')
  assert.match(source, /title: "Task"/)
  assert.match(source, /title: "Schedule"/)
  assert.match(source, /title: "Agent & access"/)
  assert.match(source, /className: "dsh-auto-advanced-trigger"/)
  assert.match(source, /hidden: !advancedOpen/)
  assert.match(source, /key: editing === null \? "create" : "edit:" \+ editing\.id/)
  assert.match(source, /aria-label": "Schedule frequency"/)
  assert.match(source, /Cron needs exactly five fields/)
  assert.doesNotMatch(source, /label: "Cron"/)
})

test('uses an editable selector backed by Harness workspaces', async () => {
  const { plugin, source } = await loadClientPlugin()
  const workspaces = [
    { workspaceId: 'workspace-a', title: 'Harness Automations', path: '/work/automations', sessionIds: ['one', 'two'] },
    { workspaceId: 'workspace-b', title: '', path: '/work/reports', sessionIds: [] },
    { workspaceId: 'duplicate', title: 'Duplicate', path: '/work/automations', sessionIds: [] },
  ]
  assert.deepEqual(
    Array.from(plugin.__testing.normalizedWorkspaces(workspaces), ({ id, title, path, sessionCount }) => ({ id, title, path, sessionCount })),
    [
      { id: 'workspace-a', title: 'Harness Automations', path: '/work/automations', sessionCount: 2 },
      { id: 'workspace-b', title: 'reports', path: '/work/reports', sessionCount: 0 },
    ],
  )
  assert.equal(plugin.__testing.looksLikeAbsolutePath('/work/automations'), true)
  assert.equal(plugin.__testing.looksLikeAbsolutePath('C:\\work\\automations'), true)
  assert.equal(plugin.__testing.looksLikeAbsolutePath('C:/work/automations'), true)
  assert.equal(plugin.__testing.looksLikeAbsolutePath('\\\\server\\share\\automations'), true)
  assert.equal(plugin.__testing.looksLikeAbsolutePath('relative/path'), false)
  assert.equal(plugin.__testing.preferredWorkspacePath({ items: workspaces, recentWorkspaceId: 'workspace-b' }), '/work/reports')
  assert.equal(plugin.__testing.preferredWorkspacePath({ items: workspaces }), '/work/automations')
  assert.equal(plugin.__testing.preferredWorkspacePath({ items: [] }), '')

  const registeredNode = plugin.WorkspacePicker({
    id: 'workspace-field',
    value: '/work/automations',
    workspaceSnapshot: { items: workspaces, state: 'idle', phase: 'ready', error: null },
    onChange() {},
  })
  assert.equal(registeredNode.props.selectedId, 'workspace:workspace-a')
  assert.equal(registeredNode.props.displayValue, 'Harness Automations')
  assert.equal(registeredNode.type(registeredNode.props).children[0].children[1].props.value, 'Harness Automations')
  assert.equal(registeredNode.props.optionsForQuery('harness')[0].value, '/work/automations')
  assert.match(registeredNode.props.optionsForQuery('harness')[0].detail, /2 sessions/)
  assert.equal(registeredNode.props.panelNotice, null)

  const customNode = plugin.WorkspacePicker({
    id: 'workspace-field',
    value: '/srv/custom-project',
    workspaceSnapshot: { items: workspaces, state: 'idle', phase: 'ready', error: null },
    onChange() {},
  })
  assert.equal(customNode.props.selectedId, 'custom-workspace:/srv/custom-project')
  assert.equal(customNode.props.optionsForQuery('/srv/custom-project')[0].custom, true)
  assert.equal(customNode.props.commitExactValue(' /srv/custom-project '), '/srv/custom-project')
  assert.equal(customNode.props.commitExactValue('relative/path'), null)
  const customTree = customNode.type(customNode.props)
  assert.equal(customTree.children[0].children[1].props.role, 'combobox')
  assert.equal(customTree.children[0].children[1].props.list, undefined)

  assert.deepEqual(Array.from(plugin.inject), ['slots', 'workspaces', 'sessions'])
  assert.match(source, /label: "Workspace"/)
  assert.match(source, /workspaceRuntime: ctx\.workspaces/)
  assert.match(source, /workspaceTouchedRef\.current/)
  assert.match(source, /preferredWorkspacePath\(workspaceSnapshot\)/)
  assert.doesNotMatch(source, /label: "Working directory"/)
})

test('uses one flat DSH-style model list with provider titles and model-owned effort', async () => {
  const { plugin, source } = await loadClientPlugin()
  const providers = [
    { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }] },
    { id: 'openai-codex', name: 'OpenAI Codex', models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }] },
  ]
  assert.equal(plugin.__testing.normalizedProviders([{ id: 'openai-codex', models: ['gpt'] }])[0].name, 'OpenAI Codex')
  assert.equal(plugin.__testing.modelRoute('openai-codex', 'gpt-5.6-sol'), 'openai-codex/gpt-5.6-sol')
  assert.deepEqual({ ...plugin.__testing.parseModelRoute(' openai-codex/gpt-5.6-sol ') }, {
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
  })
  assert.equal(plugin.__testing.parseModelRoute('gpt-5.6-sol'), null)
  assert.deepEqual(
    Array.from(plugin.__testing.reasoningEffortsForState({ status: 'error', data: null })).map((effort) => effort.id),
    ['off', 'minimal', 'low', 'medium', 'high', 'max'],
  )
  assert.deepEqual(
    Array.from(plugin.__testing.reasoningEffortsForState({
      status: 'ready',
      data: { reasoning: { efforts: [{ id: 'turbo', name: 'Turbo' }] } },
    })).map((effort) => effort.id),
    ['turbo'],
  )
  const selections = []
  const modelNode = plugin.ModelPicker({
    id: 'model-field',
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    providers,
    defaultModel: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
    onChange(selection) { selections.push(selection) },
  })
  const modelResults = modelNode.props.optionsForQuery('open')
  assert.equal(modelResults[0].value, 'openai-codex/gpt-5.6-sol')
  assert.equal(modelResults[0].label, 'GPT-5.6 Sol')
  assert.equal(modelResults[0].groupTitle, 'OpenAI Codex')
  assert.equal(modelResults[0].ariaLabel, 'GPT-5.6 Sol, provider OpenAI Codex')
  const initialResults = modelNode.props.optionsForQuery('')
  assert.deepEqual(Array.from(initialResults, ({ groupTitle }) => groupTitle), ['Default', 'DeepSeek', 'OpenAI Codex'])
  const customResults = modelNode.props.optionsForQuery('custom-provider/custom-model')
  assert.equal(customResults[0].custom, true)
  assert.equal(customResults[0].groupTitle, 'Custom route')
  const fuzzyCollision = modelNode.props.optionsForQuery('openai-codex/gpt-5')
  assert.equal(fuzzyCollision[0].value, 'openai-codex/gpt-5', 'an exact custom route ranks ahead of fuzzy models')
  assert.equal(fuzzyCollision[0].custom, true)
  assert.match(modelNode.props.selectedId, /^model:/)
  assert.equal(modelNode.props.commitOnBlur, true)
  assert.equal(modelNode.props.notifySameValue, true)
  assert.equal(typeof modelNode.props.onCancel, 'function')
  assert.equal(modelNode.props.displayValue, 'GPT-5.6 Sol')
  modelNode.props.onChange('openai-codex/gpt-5.6-sol')
  assert.deepEqual(selections, [], 'reselecting the current model must preserve its reasoning effort')
  modelNode.props.onChange('deepseek-official/deepseek-v4-pro')
  assert.deepEqual(selections.map((selection) => ({ ...selection })), [{ provider: 'deepseek-official', model: 'deepseek-v4-pro' }])
  const modelTree = modelNode.type(modelNode.props)
  const modelInput = modelTree.children[0].children[1]
  assert.equal(modelInput.props.role, 'combobox')
  assert.equal(modelInput.props.placeholder, 'Harness default')
  assert.equal(modelInput.props.list, undefined)
  const blurCommits = []
  const blurTree = plugin.EditableCombobox({
    id: 'custom-route-field',
    value: 'custom-provider/custom-model',
    onChange(value) { blurCommits.push(value) },
    optionsForQuery() { return [] },
    selectedId: null,
    commitExactValue(value) { return plugin.__testing.parseModelRoute(value) ? value : null },
    placeholder: '',
    listboxLabel: 'Models',
    initialTitle: 'Models',
    searchTitle: 'Models',
    emptyText: 'None',
    hintText: '',
    resultNoun: 'model',
    invalidMessage: 'Invalid',
    commitOnBlur: true,
  })
  blurTree.children[0].children[1].props.onBlur({ relatedTarget: null })
  assert.deepEqual(blurCommits, ['custom-provider/custom-model'])

  const effortNode = plugin.ReasoningEffortPicker({
    id: 'effort-field',
    value: 'turbo',
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    defaultModel: { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'max' },
    onChange() {},
  })
  const effortResults = effortNode.props.optionsForQuery('')
  assert.equal(effortResults[0].label, 'Default')
  assert.equal(effortResults[1].value, 'turbo')
  assert.equal(effortResults[1].custom, true)
  assert.equal(effortNode.props.selectedId, 'custom-effort:turbo')
  assert.match(effortNode.props.panelNotice, /^Loading effort levels/)
  const effortTree = effortNode.type(effortNode.props)
  assert.equal(effortTree.children[0].children[1].props.role, 'combobox')

  assert.match(source, /\/meta\/model\?provider=/)
  assert.match(source, /MODEL_METADATA_CACHE/)
  assert.match(source, /controller\.abort\(\)/)
  assert.match(source, /reasoningEffort: ""/)
  assert.match(source, /className: "dsh-auto-combobox-group-title"/)
  assert.match(source, /"aria-label": option\.ariaLabel/)
  assert.match(source, /if \(commitOnBlur\)/)
  assert.match(source, /onCancel\?\.\(\)/)
  assert.match(source, /if \(nextRoute !== route\) onChange\(parsed\)/)
  assert.match(source, /onChange\("modelSelection", selection\)/)
  assert.doesNotMatch(source, /label: "Provider"/)
  assert.doesNotMatch(source, /fieldId\("provider-list"\)/)
  assert.doesNotMatch(source, /fieldId\("model-list"\)/)
  assert.doesNotMatch(source, /fieldId\("effort-list"\)/)
  assert.doesNotMatch(source, /REASONING_EFFORTS/)
})

test('opens Automations as a disposable center workspace while retaining Settings', async () => {
  const { plugin } = await loadClientPlugin()
  const harness = createClientContext()

  assert.deepEqual(Array.from(plugin.inject), ['slots', 'workspaces', 'sessions'])
  plugin.apply(harness.ctx)

  assert.deepEqual(
    harness.registrations.map(({ options }) => options.name),
    ['settings.section', 'sidebar.footer.action'],
  )
  assert.deepEqual(harness.injections, ['conversation', 'settings.section', 'sidebar.footer.action'])
  assert.equal(harness.registrations[0].component.name, 'AutomationsSection')
  assert.equal(harness.registrations[1].component.name, 'AutomationsSidebarAction')
  const settingsInjection = harness.registrations[0].options.inject()
  assert.equal(settingsInjection.workspaceRuntime, harness.workspaceRuntime)
  const settingsTree = harness.registrations[0].component(settingsInjection)
  assert.equal(settingsTree.props.className, 'dsh-auto-root')
  assert.equal(settingsTree.children[0].children[0].children[0].props.className, undefined)

  const sidebarInjection = harness.registrations[1].options.inject()
  const disclosure = sidebarInjection.disclosure
  assert.equal(sidebarInjection.sessionsRuntime, harness.sessionsRuntime)
  assert.equal(disclosure.getSnapshot(), false)
  disclosure.open()

  const center = harness.registrations.at(-1)
  assert.equal(center.options.name, 'conversation')
  assert.equal(center.options.priority, -200)
  assert.equal(center.component.name, 'AutomationsWorkspace')
  assert.equal(center.options.inject().disclosure, disclosure)
  assert.equal(center.options.inject().workspaceRuntime, harness.workspaceRuntime)
  assert.equal(center.disposed, false)

  const conversationDeclaration = harness.injectionControls.find(({ name }) => name === 'conversation')
  conversationDeclaration.collapse()
  assert.equal(center.disposed, true)
  assert.equal(disclosure.getSnapshot(), true)
  conversationDeclaration.declare()
  const remountedCenter = harness.registrations.at(-1)
  assert.notEqual(remountedCenter, center)
  assert.equal(remountedCenter.options.name, 'conversation')

  const workspace = remountedCenter.component(remountedCenter.options.inject())
  assert.equal(workspace.type, 'section')
  assert.equal(workspace.props['data-dsh-automations-workspace'], 'true')
  assert.equal(workspace.props.role, undefined)
  assert.equal(workspace.props['aria-modal'], undefined)
  const toolbar = workspace.children[0]
  const exit = toolbar.children[2]
  assert.equal(exit.type, primitivesStub.Button)
  assert.equal(exit.props.variant, 'toolbar')
  assert.equal(exit.props['data-dsh-automations-exit'], 'true')
  const section = workspace.children[1].children[0]
  assert.equal(section.type.name, 'AutomationsSection')
  assert.equal(section.props.centerMode, true)

  exit.props.onClick()
  assert.equal(disclosure.getSnapshot(), false)
  assert.equal(remountedCenter.disposed, true)

  disclosure.open()
  const reopenedCenter = harness.registrations.at(-1)
  assert.notEqual(reopenedCenter, remountedCenter)
  assert.equal(reopenedCenter.options.name, 'conversation')
  harness.disposeEffects()
  assert.equal(reopenedCenter.disposed, true)
})

test('recognizes sidebar session navigation even when the current chat is clicked', async () => {
  const { plugin, source } = await loadClientPlugin()
  const region = { contains: (candidate) => candidate === row }
  const footer = { previousElementSibling: region }
  const footerActions = { parentElement: footer }
  const action = { parentElement: footerActions }
  const trigger = { closest: (selector) => selector === '.dsh-auto-sidebar-action' ? action : null }
  const row = {}
  const label = {
    closest(selector) {
      if (selector === '[role="treeitem"][aria-selected]') return row
      return null
    },
  }
  const actionButton = {}
  const actionTarget = {
    closest(selector) {
      if (selector === '[role="treeitem"][aria-selected]') return row
      if (selector === 'button') return actionButton
      return null
    },
  }
  const searchRow = {
    closest(selector) {
      if (selector === '[role="treeitem"][aria-selected]' || selector === 'button') return searchRow
      return null
    },
  }

  assert.equal(plugin.__testing.sidebarWorkspaceRegion(trigger), region)
  assert.equal(plugin.__testing.workspaceNavigationRowFromClick(label, region), row)
  assert.equal(plugin.__testing.workspaceNavigationRowFromClick(label), row)
  assert.equal(plugin.__testing.workspaceNavigationRowFromClick(actionTarget, region), null)
  region.contains = (candidate) => candidate === searchRow
  assert.equal(plugin.__testing.workspaceNavigationRowFromClick(searchRow, region), searchRow)
  assert.match(source, /document\.addEventListener\("click", onWorkspaceClick\)/)
  assert.doesNotMatch(source, /document\.addEventListener\("click", onWorkspaceClick, true\)/)
  assert.match(source, /if \(!disclosure\.getSnapshot\(\)\) return/)
  assert.match(source, /restoreTriggerFocusRef\.current = false/)
})

test('declares load-order dependencies for Settings, sidebar, and center workspace', async () => {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-settings',
  ])
  for (const dependency of [
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-sidebar',
  ]) {
    assert.equal(pkg.peerDependencies[dependency], '^0.1.1-rc.2')
    assert.equal(pkg.devDependencies[dependency], '0.1.1-rc.2')
  }
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh-client-ui-primitives'], '0.1.1-rc.2')
  assert.equal(pkg.peerDependencies['react-dom'], '^18.2.0')
  assert.equal(pkg.devDependencies['react-dom'], '^18.2.0')
})

test('center workspace behaves as a non-modal page with an explicit exit', async () => {
  const { source } = await loadClientPlugin()
  assert.match(source, /data-dsh-automations-trigger/)
  assert.match(source, /data-dsh-automations-workspace/)
  assert.match(source, /data-dsh-automations-exit/)
  assert.match(source, /"aria-pressed": open/)
  assert.match(source, /name: "conversation"/)
  assert.match(source, /priority: -200/)
  assert.match(source, /event\.key !== "Escape"/)
  assert.match(source, /const reactFormId = String\(useId\(\)\)/)
  assert.match(source, /formInstanceSerial \+= 1/)
  assert.doesNotMatch(source, /"dsh-auto-f-(?:name|permission|prompt)"/)
  assert.match(source, /\.dsh-auto-workspace\{[^}]*height:100%/)
  assert.doesNotMatch(source, /shell\.overlay|dsh-auto-overlay|"aria-haspopup": "dialog"|"aria-modal": "true"/)
  assert.doesNotMatch(source, /ctx\.slots\.inject\("(?:root|sidebar|sidebar\.settings|sidebar\.workspaces)"/)
})
