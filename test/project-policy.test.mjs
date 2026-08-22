import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ProjectPolicy } from '../dist/project-policy.js'


test('canonicalizes projects and enforces configured roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automations-projects-'))
  const allowed = join(root, 'allowed')
  const project = join(allowed, 'project')
  const outside = join(root, 'outside')
  await Promise.all([
    mkdir(project, { recursive: true }),
    mkdir(outside, { recursive: true }),
  ])
  const policy = await ProjectPolicy.create([allowed])
  assert.equal(await policy.authorize(project), project)
  await assert.rejects(() => policy.authorize(outside), /outside allowedProjectRoots/)
})

test('stores the canonical identity rather than a symlink alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automations-symlink-'))
  const target = join(root, 'target')
  const alias = join(root, 'alias')
  await mkdir(target)
  await symlink(target, alias, 'dir')
  const policy = await ProjectPolicy.create([])
  assert.equal(await policy.authorize(alias), target)
})
