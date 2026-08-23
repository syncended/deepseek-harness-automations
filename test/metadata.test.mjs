import assert from 'node:assert/strict'
import test from 'node:test'
import { AutomationService } from '../dist/index.js'

test('lists provider and model display metadata without eager exact-model resolution', async () => {
  let exactCalls = 0
  const receiver = {
    ctx: {
      agentDefaultModel: {
        currentSelection() {
          return { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'max' }
        },
      },
      llm: {
        listProviders() {
          return [{ id: 'openai-codex', name: 'OpenAI Codex' }]
        },
        async listModels(provider) {
          assert.equal(provider, 'openai-codex')
          return [{
            provider,
            id: 'gpt-5.6-sol',
            name: 'GPT-5.6 Sol',
            description: 'General coding model.',
          }]
        },
        async resolveModelInfo() {
          exactCalls += 1
          throw new Error('metadata() must stay lazy')
        },
      },
      logger: { warn() {} },
      agentPresets: { async list() { return [] } },
      permissionPresets: { names: ['workspace-write'] },
    },
  }

  const metadata = await AutomationService.prototype.metadata.call(receiver)
  assert.equal(exactCalls, 0)
  assert.deepEqual(metadata.defaultModel, {
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'max',
  })
  assert.deepEqual(metadata.providers, [{
    id: 'openai-codex',
    name: 'OpenAI Codex',
    models: [{
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      description: 'General coding model.',
    }],
  }])
})

test('detaches exact-model reasoning metadata for the effort picker', async () => {
  const receiver = {
    ctx: {
      llm: {
        async resolveModelInfo(provider, model) {
          assert.equal(provider, 'openai-codex')
          assert.equal(model, 'gpt-5.6-sol')
          return {
            provider,
            id: model,
            name: 'GPT-5.6 Sol',
            description: 'General coding model.',
            reasoning: {
              defaultEffort: 'high',
              efforts: [
                { id: 'low', name: 'Low', description: 'Light reasoning.' },
                { id: 'high', name: 'High', description: 'Deeper reasoning.' },
              ],
            },
          }
        },
      },
    },
  }

  assert.deepEqual(
    await AutomationService.prototype.modelMetadata.call(receiver, 'openai-codex', 'gpt-5.6-sol'),
    {
      provider: 'openai-codex',
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      description: 'General coding model.',
      reasoning: {
        defaultEffort: 'high',
        efforts: [
          { id: 'low', name: 'Low', description: 'Light reasoning.' },
          { id: 'high', name: 'High', description: 'Deeper reasoning.' },
        ],
      },
    },
  )
})
