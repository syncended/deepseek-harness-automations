import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientPath = new URL('../lib/client.js', import.meta.url)
const packagePath = new URL('../package.json', import.meta.url)

const reactStub = {
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

async function loadClientPlugin() {
  const source = await readFile(clientPath, 'utf8')
  let plugin
  const window = {
    __ModuleLoader__: {
      load(definition) {
        plugin = definition.factory((id) => {
          assert.equal(id, 'react')
          return reactStub
        })
      },
    },
  }
  vm.runInNewContext(source, { window, Set, Array, Object, Intl, Error, String, Number, RegExp })
  return { plugin, source }
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

test('registers additive main-sidebar and overlay seats while retaining Settings', async () => {
  const { plugin } = await loadClientPlugin()
  const registrations = []
  const ctx = {
    effect() {},
    slots: {
      inject(_name, register) {
        register()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  plugin.apply(ctx)

  assert.deepEqual(
    registrations.map(({ options }) => options.name),
    ['settings.section', 'sidebar.footer.action', 'shell.overlay'],
  )
  assert.deepEqual(
    registrations.map(({ options }) => options.id),
    ['automations', 'automations', 'automations'],
  )
  assert.equal(registrations[0].component.name, 'AutomationsSection')
  assert.equal(registrations[1].component.name, 'AutomationsSidebarAction')
  assert.equal(registrations[2].component.name, 'AutomationsOverlay')

  const sidebarDisclosure = registrations[1].options.inject().disclosure
  const overlayDisclosure = registrations[2].options.inject().disclosure
  assert.equal(sidebarDisclosure, overlayDisclosure)
  assert.equal(sidebarDisclosure.getSnapshot(), false)
  sidebarDisclosure.open()
  assert.equal(overlayDisclosure.getSnapshot(), true)
  overlayDisclosure.close()
  assert.equal(sidebarDisclosure.getSnapshot(), false)
})

test('overlay traps keyboard focus and closes on Escape', async () => {
  const { plugin } = await loadClientPlugin()
  const registrations = []
  const ctx = {
    effect() {},
    slots: {
      inject(_name, register) {
        register()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  const overlayRegistration = registrations.find(({ options }) => options.name === 'shell.overlay')
  const disclosure = overlayRegistration.options.inject().disclosure
  disclosure.open()
  const tree = overlayRegistration.component({ disclosure })
  const panelNode = tree.children[1]

  const ownerDocument = { activeElement: null }
  const focusable = (name) => ({
    name,
    focus() {
      ownerDocument.activeElement = this
    },
    getClientRects() {
      return [{}]
    },
    getAttribute() {
      return null
    },
    hasAttribute() {
      return false
    },
  })
  const first = focusable('first')
  const last = focusable('last')
  const panel = {
    ownerDocument,
    querySelectorAll() {
      return [first, last]
    },
    contains(element) {
      return element === first || element === last
    },
    focus() {
      ownerDocument.activeElement = this
    },
  }
  panelNode.props.ref.current = panel

  let prevented = false
  ownerDocument.activeElement = last
  panelNode.props.onKeyDownCapture({
    key: 'Tab',
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.equal(ownerDocument.activeElement, first)

  prevented = false
  ownerDocument.activeElement = first
  panelNode.props.onKeyDownCapture({
    key: 'Tab',
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.equal(ownerDocument.activeElement, last)

  panelNode.props.onKeyDownCapture({
    key: 'Escape',
    preventDefault() {},
  })
  assert.equal(disclosure.getSnapshot(), false)
})

test('declares load-order dependencies for both public shell extension points', async () => {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-settings',
  ])
  for (const dependency of [
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-sidebar',
  ]) {
    assert.equal(pkg.peerDependencies[dependency], '^0.1.1-rc.2')
    assert.equal(pkg.devDependencies[dependency], '0.1.1-rc.2')
  }
})

test('sidebar surface is accessible and does not replace occupied shell slots', async () => {
  const { source } = await loadClientPlugin()
  assert.match(source, /data-dsh-automations-trigger/)
  assert.match(source, /data-dsh-automations-overlay/)
  assert.match(source, /"aria-haspopup": "dialog"/)
  assert.match(source, /"aria-modal": "true"/)
  assert.match(source, /event\.key === "Escape"/)
  assert.match(source, /\.dsh-auto-overlay\{[^}]*pointer-events:auto/)
  assert.doesNotMatch(source, /ctx\.slots\.inject\("(?:root|sidebar|sidebar\.settings|sidebar\.workspaces)"/)
})
