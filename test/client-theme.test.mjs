import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientPath = new URL('../lib/client.js', import.meta.url)


test('uses DSH foreground-aware button tokens in both themes', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /--dsw-alias-button-primary-fill/)
  assert.match(source, /--dsw-alias-button-primary-hover/)
  assert.match(source, /--dsw-alias-label-primary-foreground/)
  assert.match(source, /\.dsh-auto-btn-primary\{[^}]*color:var\(--dsh-auto-on-primary\)/)
  assert.doesNotMatch(source, /\.dsh-auto-btn-primary\{[^}]*color:#fff/)
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

test('does not dim an entire disabled job card including live actions', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /\.dsh-auto-card-disabled\{background:/)
  assert.doesNotMatch(source, /\.dsh-auto-card-disabled\{[^}]*opacity:/)
  assert.match(source, /body\[data-ds-dark-theme\] \.dsh-auto-root\{color-scheme:dark/)
})
