const test = require('node:test')
const assert = require('node:assert/strict')

let optionCrudWorkflowPromise

async function loadOptionCrudWorkflow() {
  optionCrudWorkflowPromise ??= import('../src/renderer/src/optionCrudWorkflow.mjs')
  const module = await optionCrudWorkflowPromise
  return module.default
}

test('prepareDeleteConfirmation reloads fresh laundry-set data for each washer delete preview', async () => {
  const { prepareDeleteConfirmation } = await loadOptionCrudWorkflow()
  const loadCalls = []
  const electronApi = {
    async loadOptions(applianceKey) {
      loadCalls.push(applianceKey)

      if (loadCalls.length === 1) {
        return {
          ok: true,
          options: [
            {
              id: 'set-1',
              evaluations: {
                washer: { status: 'known', value: 'washer-1' }
              }
            }
          ]
        }
      }

      return {
        ok: true,
        options: []
      }
    }
  }

  const option = {
    id: 'washer-1',
    evaluations: {
      brand: { status: 'known', value: 'LG' },
      model: { status: 'known', value: 'Wave 9' }
    }
  }

  const firstPreview = await prepareDeleteConfirmation({
    electronApi,
    applianceKey: 'washer',
    option
  })
  const secondPreview = await prepareDeleteConfirmation({
    electronApi,
    applianceKey: 'washer',
    option
  })

  assert.deepEqual(loadCalls, ['laundry-set', 'laundry-set'])
  assert.match(firstPreview.message, /1 Laundry Set Option still references this washer/i)
  assert.match(secondPreview.message, /removes only the selected Washer Option/i)
})

test('saveOptionAndReload keeps refreshed list retrieval after save success', async () => {
  const { saveOptionAndReload } = await loadOptionCrudWorkflow()
  const callOrder = []
  const electronApi = {
    async saveOption(applianceKey, optionPayload) {
      callOrder.push(['saveOption', applianceKey, optionPayload])
      return {
        ok: true,
        option: { id: 'washer-1' }
      }
    },
    async loadOptions(applianceKey) {
      callOrder.push(['loadOptions', applianceKey])
      return {
        ok: true,
        options: [
          {
            id: 'washer-1',
            evaluations: {
              brand: { status: 'known', value: 'Reloaded Brand' }
            }
          }
        ],
        warnings: []
      }
    }
  }

  const workflowResult = await saveOptionAndReload({
    electronApi,
    applianceKey: 'washer',
    optionPayload: {
      evaluations: {
        brand: { status: 'known', value: 'Draft Brand' }
      }
    }
  })

  assert.equal(workflowResult.ok, true)
  assert.deepEqual(callOrder.map(([name]) => name), ['saveOption', 'loadOptions'])
  assert.equal(workflowResult.reloadResult.options[0].evaluations.brand.value, 'Reloaded Brand')
})

test('deleteOptionAndReload waits for delete success before loading refreshed rows', async () => {
  const { deleteOptionAndReload } = await loadOptionCrudWorkflow()
  const callOrder = []
  const electronApi = {
    async deleteOption(applianceKey, optionId) {
      callOrder.push(['deleteOption', applianceKey, optionId])
      return {
        ok: true,
        deletedOptionId: optionId
      }
    },
    async loadOptions(applianceKey) {
      callOrder.push(['loadOptions', applianceKey])
      return {
        ok: true,
        options: [],
        warnings: []
      }
    }
  }

  const workflowResult = await deleteOptionAndReload({
    electronApi,
    applianceKey: 'dryer',
    optionId: 'dryer-1'
  })

  assert.equal(workflowResult.ok, true)
  assert.deepEqual(callOrder, [
    ['deleteOption', 'dryer', 'dryer-1'],
    ['loadOptions', 'dryer']
  ])
  assert.deepEqual(workflowResult.reloadResult.options, [])
})

test('loadLaundrySetPointerCatalogs reports auxiliary catalog failure for laundry-set CRUD', async () => {
  const { loadLaundrySetPointerCatalogs } = await loadOptionCrudWorkflow()
  const electronApi = {
    async loadOptions(applianceKey) {
      if (applianceKey === 'washer') {
        return {
          ok: true,
          options: [{ id: 'washer-1', evaluations: {} }]
        }
      }

      return {
        ok: false,
        failure: {
          code: 'OPTIONS_READ_FAILED',
          message: 'Dryer options could not be read.'
        }
      }
    }
  }

  const workflowResult = await loadLaundrySetPointerCatalogs({ electronApi })

  assert.equal(workflowResult.ok, false)
  assert.equal(workflowResult.washerResult.ok, true)
  assert.equal(workflowResult.dryerResult.ok, false)
  assert.match(workflowResult.error, /Dryer catalog: Dryer options could not be read\./)
})
