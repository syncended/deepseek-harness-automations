import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { AutomationInputError } from './validation.js'

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function canonicalDirectory(path: string, label: string): Promise<string> {
  let metadata
  let canonical
  try {
    ;[metadata, canonical] = await Promise.all([stat(path), realpath(path)])
  } catch (cause) {
    throw new AutomationInputError(`${label} is not an accessible directory: ${path}`, 'PROJECT_UNAVAILABLE', 400, {
      cause,
    })
  }
  if (!metadata.isDirectory()) {
    throw new AutomationInputError(`${label} is not a directory: ${path}`, 'PROJECT_NOT_DIRECTORY')
  }
  return canonical
}

/** Host-side allowlist and symlink-canonicalization boundary for job workspaces. */
export class ProjectPolicy {
  private readonly roots: string[]

  private constructor(roots: string[]) {
    this.roots = roots
  }

  static async create(configuredRoots: readonly string[]): Promise<ProjectPolicy> {
    const roots: string[] = []
    for (const configured of configuredRoots) {
      const path = resolve(expandHomePath(configured))
      roots.push(await canonicalDirectory(path, 'allowed project root'))
    }
    return new ProjectPolicy([...new Set(roots)])
  }

  async authorize(cwd: string): Promise<string> {
    if (!isAbsolute(cwd)) throw new AutomationInputError('project cwd must be absolute')
    const canonical = await canonicalDirectory(cwd, 'project cwd')
    if (this.roots.length > 0 && !this.roots.some((root) => isWithin(root, canonical))) {
      throw new AutomationInputError(
        `project cwd is outside allowedProjectRoots: ${canonical}`,
        'PROJECT_NOT_ALLOWED',
        403,
      )
    }
    return canonical
  }

  listRoots(): readonly string[] {
    return this.roots
  }
}
