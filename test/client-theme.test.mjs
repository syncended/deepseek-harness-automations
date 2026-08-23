import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientPath = new URL('../lib/client.js', import.meta.url)
const primitiveButtonCssPath = new URL('../node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/Button.module.css', import.meta.url)


test('uses the native DSH Button primitive and its paired theme tokens', async () => {
  const [source, buttonCss] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(primitiveButtonCssPath, 'utf8'),
  ])
  assert.match(source, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/)
  assert.match(source, /h\(\s*Button,[\s\S]*?variant: "primary"/)
  assert.doesNotMatch(source, /\.dsh-auto-btn-primary/)
  assert.match(buttonCss, /--dsw-alias-button-primary-fill/)
  assert.match(buttonCss, /--dsw-alias-button-primary-hover/)
  assert.match(buttonCss, /--dsw-alias-label-primary-foreground/)
})

test('uses existing semantic DSH tokens instead of dark-only fallbacks', async () => {
  const source = await readFile(clientPath, 'utf8')
  for (const token of [
    '--dsw-alias-border-subtle',
    '--dsw-alias-border-strong',
    '--dsw-alias-brand-primary-hover',
    '--dsw-alias-label-error',
    '--dsw-alias-label-success',
    '--dsw-alias-label-warning',
  ]) {
    assert.equal(source.includes(token), false, `obsolete or absent token remains: ${token}`)
  }
  for (const token of [
    '--dsw-alias-border-l2',
    '--dsw-alias-state-business-primary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-warn-primary',
  ]) {
    assert.equal(source.includes(token), true, `semantic token is missing: ${token}`)
  }
})

test('renders the Automations center as an in-flow DSH workspace', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /\.dsh-auto-workspace\{[^}]*width:100%;height:100%/)
  assert.match(source, /\.dsh-auto-workspace-toolbar\{[^}]*--dsw-alias-border-l2/)
  assert.match(source, /background:var\(--dsw-alias-bg-base/)
  assert.match(source, /variant: "toolbar"/)
  assert.doesNotMatch(source, /dsh-auto-overlay|backdrop-filter|position:fixed;inset:0/)
})

test('does not dim an entire disabled job card including live actions', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /\.dsh-auto-card-disabled\{background:/)
  assert.doesNotMatch(source, /\.dsh-auto-card-disabled\{[^}]*opacity:/)
  assert.match(source, /body\[data-ds-dark-theme\] \.dsh-auto-root\{color-scheme:dark/)
})

test('keeps plugin actions clear of the Settings shell actions', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /\.dsh-auto-root\{[^}]*padding-top:12px/)
})
