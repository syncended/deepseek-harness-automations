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

const primitivesStub = new Proxy({}, {
  get(target, property) {
    if (!(property in target)) target[property] = () => null
    return target[property]
  },
})

async function loadClientPlugin() {
  const source = await readFile(clientPath, 'utf8')
  let plugin
  const window = {
    __ModuleLoader__: {
      load(definition) {
        plugin = definition.factory((id) => {
          if (id === 'react') return reactStub
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
  const ctx = {
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

test('opens Automations as a disposable center workspace while retaining Settings', async () => {
  const { plugin } = await loadClientPlugin()
  const harness = createClientContext()

  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  plugin.apply(harness.ctx)

  assert.deepEqual(
    harness.registrations.map(({ options }) => options.name),
    ['settings.section', 'sidebar.footer.action'],
  )
  assert.deepEqual(harness.injections, ['conversation', 'settings.section', 'sidebar.footer.action'])
  assert.equal(harness.registrations[0].component.name, 'AutomationsSection')
  assert.equal(harness.registrations[1].component.name, 'AutomationsSidebarAction')
  const settingsTree = harness.registrations[0].component({ workspace: { id: 'host-owner-prop' } })
  assert.equal(settingsTree.props.className, 'dsh-auto-root')
  assert.equal(settingsTree.children[0].children[0].children[0].props.className, undefined)

  const disclosure = harness.registrations[1].options.inject().disclosure
  assert.equal(disclosure.getSnapshot(), false)
  disclosure.open()

  const center = harness.registrations.at(-1)
  assert.equal(center.options.name, 'conversation')
  assert.equal(center.options.priority, -200)
  assert.equal(center.component.name, 'AutomationsWorkspace')
  assert.equal(center.options.inject().disclosure, disclosure)
  assert.equal(center.disposed, false)

  const conversationDeclaration = harness.injectionControls.find(({ name }) => name === 'conversation')
  conversationDeclaration.collapse()
  assert.equal(center.disposed, true)
  assert.equal(disclosure.getSnapshot(), true)
  conversationDeclaration.declare()
  const remountedCenter = harness.registrations.at(-1)
  assert.notEqual(remountedCenter, center)
  assert.equal(remountedCenter.options.name, 'conversation')

  const workspace = remountedCenter.component({ disclosure })
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
