const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { pathToFileURL } = require('node:url')

async function loadComparisonWorkspaceModule() {
  return import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'composables', 'comparisonWorkspace.mjs')).href)
}

function createSchema(appliance, overrides = {}) {
  const baseByAppliance = {
    washer: {
      appliance: 'washer',
      defaultComparisonDimensionIds: ['brand', 'model', 'price', 'price', 'missing'],
      dimensions: [
        { id: 'brand', label: 'Brand', type: 'string', required: true },
        { id: 'model', label: 'Model', type: 'string', required: true },
        { id: 'price', label: 'Price', type: 'numeric', unit: 'CNY', required: true },
        { id: 'warrantyMonths', label: 'Warranty', type: 'numeric', unit: 'months', required: false }
      ],
      defaultListOrder: [
        { dimensionId: 'price', direction: 'asc' }
      ]
    },
    dryer: {
      appliance: 'dryer',
      defaultComparisonDimensionIds: ['brand', 'price'],
      dimensions: [
        { id: 'brand', label: 'Brand', type: 'string', required: true },
        { id: 'model', label: 'Model', type: 'string', required: true },
        { id: 'price', label: 'Price', type: 'numeric', unit: 'CNY', required: true },
        { id: 'noiseLevelDb', label: 'Noise', type: 'numeric', unit: 'dB', required: false }
      ],
      defaultListOrder: [
        { dimensionId: 'price', direction: 'asc' }
      ]
    },
    'laundry-set': {
      appliance: 'laundry-set',
      defaultComparisonDimensionIds: ['brand', 'washer.capacityKg', 'washer', 'dryer'],
      dimensions: [
        { id: 'brand', label: 'Brand', type: 'string', required: true },
        { id: 'bundlePrice', label: 'Bundle Price', type: 'numeric', unit: 'CNY', required: true },
        { id: 'washer', label: 'Washer', type: 'pointer', required: true },
        { id: 'dryer', label: 'Dryer', type: 'pointer', required: true },
        { id: 'washer.capacityKg', label: 'Washer Capacity', type: 'numeric', required: false }
      ],
      defaultListOrder: [
        { dimensionId: 'bundlePrice', direction: 'asc' }
      ]
    }
  }

  return {
    ...baseByAppliance[appliance],
    ...overrides
  }
}

function createOption(id, values) {
  return {
    id,
    evaluations: values
  }
}

function createApiStub({ schemas, optionsByAppliance, presetsByAppliance, savePresetResult, deletePresetResult }) {
  return {
    listSchemas: async () => ({
      schemas: Object.keys(schemas).map((applianceKey) => ({
        applianceKey,
        displayName: applianceKey === 'laundry-set' ? 'Laundry Set' : applianceKey[0].toUpperCase() + applianceKey.slice(1)
      }))
    }),
    loadSchema: async (applianceKey) => ({ ok: true, schema: schemas[applianceKey] }),
    loadOptions: async (applianceKey) => ({ ok: true, options: optionsByAppliance[applianceKey] || [] }),
    loadPresets: async (applianceKey) => presetsByAppliance[applianceKey],
    savePreset: async () => savePresetResult,
    deletePreset: async () => deletePresetResult
  }
}

function createShellControllerStub({ initialState, bootStateByKey }) {
  let state = initialState
  const listeners = new Set()
  let bootCalls = 0
  let retryCalls = 0
  const selectCalls = []

  function emit() {
    for (const listener of listeners) {
      listener(state)
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      listener(state)

      return () => {
        listeners.delete(listener)
      }
    },
    async boot() {
      bootCalls += 1
      state = bootStateByKey[state.activeKey] || state
      emit()
      return state
    },
    async selectAppliance(applianceKey) {
      selectCalls.push(applianceKey)
      state = bootStateByKey[applianceKey] || state
      emit()
      return state
    },
    async retry() {
      retryCalls += 1
      state = bootStateByKey[state.activeKey] || state
      emit()
      return state
    },
    dispose() {},
    get bootCalls() {
      return bootCalls
    },
    get retryCalls() {
      return retryCalls
    },
    get selectCalls() {
      return [...selectCalls]
    }
  }
}

test('deriveDefaultComparisonDimensionKeys filters missing ids and preserves first-seen order', async () => {
  const { deriveEligibleComparisonDimensions, deriveDefaultComparisonDimensionKeys } = await loadComparisonWorkspaceModule()
  const schema = createSchema('washer')
  const eligibleResult = deriveEligibleComparisonDimensions('washer', schema)

  assert.equal(eligibleResult.ok, true)
  assert.deepEqual(
    deriveDefaultComparisonDimensionKeys('washer', schema, eligibleResult.dimensions),
    ['brand', 'model', 'price']
  )
})

test('controller derives comparison state from the existing shell controller', async () => {
  const { createComparisonWorkspaceController } = await loadComparisonWorkspaceModule()
  const washerSchema = createSchema('washer')
  const washerOption = createOption('washer-1', {
    brand: { status: 'known', value: 'Alpha' },
    model: { status: 'known', value: 'A1' },
    price: { status: 'known', value: 900 }
  })

  const shellController = createShellControllerStub({
    initialState: {
      navigationItems: [{ key: 'washer', label: 'Washer' }],
      activeKey: 'washer',
      view: {
        status: 'loading',
        message: 'Loading Washer…',
        columns: [],
        rows: []
      }
    },
    bootStateByKey: {
      washer: {
        navigationItems: [{ key: 'washer', label: 'Washer' }],
        activeKey: 'washer',
        view: {
          status: 'ready',
          message: '',
          columns: [
            { id: 'brand', label: 'Brand' },
            { id: 'model', label: 'Model' },
            { id: 'price', label: 'Price' }
          ],
          rows: [
            {
              key: washerOption.id,
              option: washerOption,
              cells: []
            }
          ]
        }
      }
    }
  })

  const controller = createComparisonWorkspaceController({
    apiProvider: () => ({
      loadSchema: async () => ({ ok: true, schema: washerSchema }),
      loadPresets: async () => ({ ok: true, presets: [], warnings: [], failure: null }),
      savePreset: async () => ({ ok: true, preset: null, warnings: [], validationErrors: [], failure: null }),
      deletePreset: async () => ({ ok: true, deletedPresetId: 'unused', warnings: [], failure: null })
    }),
    shellController
  })

  await controller.boot()

  assert.equal(shellController.bootCalls, 1)
  assert.deepEqual(controller.getState().comparison.comparedDimensionKeys, ['brand', 'model', 'price'])
  assert.deepEqual(controller.getState().comparison.selectedOptions.map((option) => option.id), [])

  controller.toggleOptionSelection('washer-1')
  assert.deepEqual(controller.getState().comparison.selectedOptions.map((option) => option.id), ['washer-1'])
})

test('controller keeps selection appliance-scoped and prunes stale selected ids on reload', async () => {
  const { createComparisonWorkspaceController } = await loadComparisonWorkspaceModule()
  const schemas = {
    washer: createSchema('washer'),
    dryer: createSchema('dryer')
  }
  const optionsByAppliance = {
    washer: [
      createOption('washer-b', {
        brand: { status: 'known', value: 'Bravo' },
        model: { status: 'known', value: 'B2' },
        price: { status: 'known', value: 1200 }
      }),
      createOption('washer-a', {
        brand: { status: 'known', value: 'Alpha' },
        model: { status: 'known', value: 'A1' },
        price: { status: 'known', value: 900 }
      })
    ],
    dryer: [
      createOption('dryer-1', {
        brand: { status: 'known', value: 'Dryco' },
        model: { status: 'known', value: 'D1' },
        price: { status: 'known', value: 800 }
      })
    ]
  }

  const presetEnvelope = { ok: true, presets: [], warnings: [], failure: null }
  const api = createApiStub({
    schemas,
    optionsByAppliance,
    presetsByAppliance: { washer: presetEnvelope, dryer: presetEnvelope },
    savePresetResult: { ok: true, preset: null, warnings: [], validationErrors: [], failure: null },
    deletePresetResult: { ok: true, deletedPresetId: 'unused', warnings: [], failure: null }
  })

  const controller = createComparisonWorkspaceController({ apiProvider: () => api })
  await controller.boot()
  controller.toggleOptionSelection('washer-a')

  assert.deepEqual(controller.getState().comparison.selectedOptionIds, ['washer-a'])

  await controller.selectAppliance('dryer')
  assert.deepEqual(controller.getState().comparison.selectedOptionIds, [])
  assert.deepEqual(controller.getState().comparison.comparedDimensionKeys, ['brand', 'price'])

  optionsByAppliance.dryer = []
  await controller.selectAppliance('washer')
  controller.toggleOptionSelection('washer-b')
  optionsByAppliance.washer = [optionsByAppliance.washer[1]]

  await controller.retry()
  assert.deepEqual(controller.getState().comparison.selectedOptionIds, [])
})

test('comparison columns follow current ordered list instead of selection order', async () => {
  const { buildComparisonMatrix, deriveEligibleComparisonDimensions, deriveDefaultComparisonDimensionKeys } = await loadComparisonWorkspaceModule()
  const schema = createSchema('washer')
  const availableDimensions = deriveEligibleComparisonDimensions('washer', schema).dimensions
  const comparedDimensionKeys = deriveDefaultComparisonDimensionKeys('washer', schema, availableDimensions)
  const orderedOptions = [
    createOption('washer-a', {
      brand: { status: 'known', value: 'Alpha' },
      model: { status: 'known', value: 'A1' },
      price: { status: 'known', value: 900 }
    }),
    createOption('washer-b', {
      brand: { status: 'known', value: 'Bravo' },
      model: { status: 'known', value: 'B2' },
      price: { status: 'known', value: 1200 }
    })
  ]

  const matrix = buildComparisonMatrix({
    availableDimensions,
    comparedDimensionKeys,
    orderedOptions,
    selectedOptionIds: ['washer-b', 'washer-a']
  })

  assert.deepEqual(matrix.selectedOptions.map((option) => option.id), ['washer-a', 'washer-b'])
})

test('dimension edits append or remove keys and preset application replaces compared keys', async () => {
  const { createComparisonWorkspaceController } = await loadComparisonWorkspaceModule()
  const presetEnvelope = {
    ok: true,
    presets: [
      {
        id: 'preset-1',
        name: 'Minimal',
        applianceKey: 'washer',
        dimensionKeys: ['warrantyMonths', 'brand'],
        effectiveDimensionKeys: ['warrantyMonths', 'brand']
      }
    ],
    warnings: [],
    failure: null
  }
  const api = createApiStub({
    schemas: { washer: createSchema('washer') },
    optionsByAppliance: {
      washer: [
        createOption('washer-1', {
          brand: { status: 'known', value: 'Alpha' },
          model: { status: 'known', value: 'A1' },
          price: { status: 'known', value: 900 },
          warrantyMonths: { status: 'known', value: 24 }
        })
      ]
    },
    presetsByAppliance: { washer: presetEnvelope },
    savePresetResult: { ok: true, preset: null, warnings: [], validationErrors: [], failure: null },
    deletePresetResult: { ok: true, deletedPresetId: 'unused', warnings: [], failure: null }
  })

  const controller = createComparisonWorkspaceController({ apiProvider: () => api })
  await controller.boot()
  controller.addComparedDimension('warrantyMonths')
  assert.deepEqual(controller.getState().comparison.comparedDimensionKeys, ['brand', 'model', 'price', 'warrantyMonths'])

  controller.removeComparedDimension('model')
  assert.deepEqual(controller.getState().comparison.comparedDimensionKeys, ['brand', 'price', 'warrantyMonths'])

  controller.applyPreset('preset-1')
  assert.deepEqual(controller.getState().comparison.comparedDimensionKeys, ['warrantyMonths', 'brand'])
})

test('preset warnings stay dormant until applied and clear when a clean preset is applied', async () => {
  const { createComparisonWorkspaceController } = await loadComparisonWorkspaceModule()
  const api = createApiStub({
    schemas: { washer: createSchema('washer') },
    optionsByAppliance: {
      washer: [
        createOption('washer-1', {
          brand: { status: 'known', value: 'Alpha' },
          model: { status: 'known', value: 'A1' },
          price: { status: 'known', value: 900 }
        })
      ]
    },
    presetsByAppliance: {
      washer: {
        ok: true,
        presets: [
          {
            id: 'preset-warning',
            name: 'Warning preset',
            applianceKey: 'washer',
            dimensionKeys: ['price', 'missing'],
            effectiveDimensionKeys: ['price']
          },
          {
            id: 'preset-clean',
            name: 'Clean preset',
            applianceKey: 'washer',
            dimensionKeys: ['brand'],
            effectiveDimensionKeys: ['brand']
          }
        ],
        warnings: [
          {
            code: 'PRESET_DIMENSION_MISSING',
            message: 'A saved comparison preset references a missing Dimension.',
            applianceKey: 'washer',
            presetId: 'preset-warning',
            dimensionKey: 'missing'
          }
        ],
        failure: null
      }
    },
    savePresetResult: { ok: true, preset: null, warnings: [], validationErrors: [], failure: null },
    deletePresetResult: { ok: true, deletedPresetId: 'unused', warnings: [], failure: null }
  })

  const controller = createComparisonWorkspaceController({ apiProvider: () => api })
  await controller.boot()

  assert.equal(controller.getState().comparison.appliedPresetWarning, null)
  assert.equal(controller.getState().comparison.presets[0].warnings.length, 1)

  controller.applyPreset('preset-warning')
  assert.equal(controller.getState().comparison.appliedPresetWarning.presetId, 'preset-warning')
  assert.deepEqual(controller.getState().comparison.comparedDimensionKeys, ['price'])

  controller.applyPreset('preset-clean')
  assert.equal(controller.getState().comparison.appliedPresetWarning, null)
  assert.deepEqual(controller.getState().comparison.comparedDimensionKeys, ['brand'])
})

test('save and delete preset mutations keep or reconcile local state based on result envelope', async () => {
  const { createComparisonWorkspaceController } = await loadComparisonWorkspaceModule()
  let saveMode = 'validation'
  let deleteMode = 'failure'
  let loadPresetsCalls = 0
  const api = createApiStub({
    schemas: { washer: createSchema('washer') },
    optionsByAppliance: {
      washer: [
        createOption('washer-1', {
          brand: { status: 'known', value: 'Alpha' },
          model: { status: 'known', value: 'A1' },
          price: { status: 'known', value: 900 }
        })
      ]
    },
    presetsByAppliance: {
      washer: {
        ok: true,
        presets: [
          {
            id: 'preset-existing',
            name: 'Existing preset',
            applianceKey: 'washer',
            dimensionKeys: ['brand'],
            effectiveDimensionKeys: ['brand']
          }
        ],
        warnings: [],
        failure: null
      }
    },
    savePresetResult: null,
    deletePresetResult: null
  })

  const originalLoadPresets = api.loadPresets
  api.loadPresets = async (...args) => {
    loadPresetsCalls += 1
    return originalLoadPresets(...args)
  }

  api.savePreset = async () => {
    if (saveMode === 'validation') {
      return {
        ok: false,
        preset: null,
        warnings: [],
        validationErrors: [{ code: 'INVALID_PRESET_NAME', message: 'Preset name is invalid.' }],
        failure: null
      }
    }

    if (saveMode === 'failure') {
      return {
        ok: false,
        preset: null,
        warnings: [],
        validationErrors: [],
        failure: { message: 'Comparison preset file could not be read or written.' }
      }
    }

    return {
      ok: true,
      preset: {
        id: 'preset-new',
        name: 'Canonical saved preset',
        applianceKey: 'washer',
        dimensionKeys: ['brand', 'model'],
        effectiveDimensionKeys: ['brand', 'model']
      },
      warnings: [],
      validationErrors: [],
      failure: null
    }
  }

  api.deletePreset = async () => {
    if (deleteMode === 'failure') {
      return {
        ok: false,
        deletedPresetId: null,
        warnings: [],
        failure: { message: 'The requested comparison preset was not found.' }
      }
    }

    return {
      ok: true,
      deletedPresetId: 'preset-existing',
      warnings: [],
      failure: null
    }
  }

  const controller = createComparisonWorkspaceController({ apiProvider: () => api })
  await controller.boot()
  assert.equal(loadPresetsCalls, 1)
  controller.toggleOptionSelection('washer-1')
  controller.setPresetSaveName('Bad preset')

  await controller.savePreset()
  assert.deepEqual(controller.getState().comparison.selectedOptionIds, ['washer-1'])
  assert.equal(controller.getState().comparison.presets.length, 1)
  assert.equal(controller.getState().comparison.presetSaveValidationErrors[0].message, 'Preset name is invalid.')

  saveMode = 'failure'
  await controller.savePreset()
  assert.equal(controller.getState().comparison.presetActionError, 'Comparison preset file could not be read or written.')
  assert.equal(controller.getState().comparison.presets.length, 1)

  saveMode = 'success'
  controller.setPresetSaveName('New preset')
  await controller.savePreset()
  assert.deepEqual(controller.getState().comparison.presets.map((preset) => preset.id), ['preset-existing', 'preset-new'])
  assert.equal(controller.getState().comparison.presets[1].name, 'Canonical saved preset')
  assert.equal(loadPresetsCalls, 1)

  await controller.deletePreset('preset-existing')
  assert.equal(controller.getState().comparison.presetActionError, 'The requested comparison preset was not found.')
  assert.deepEqual(controller.getState().comparison.presets.map((preset) => preset.id), ['preset-existing', 'preset-new'])
  assert.equal(loadPresetsCalls, 1)

  deleteMode = 'success'
  await controller.deletePreset('preset-existing')
  assert.deepEqual(controller.getState().comparison.presets.map((preset) => preset.id), ['preset-new'])
  assert.equal(loadPresetsCalls, 1)
})

test('laundry-set comparison excludes delegated dotted dimensions from defaults addable choices and preset application', async () => {
  const { createComparisonWorkspaceController } = await loadComparisonWorkspaceModule()
  const api = createApiStub({
    schemas: {
      'laundry-set': createSchema('laundry-set'),
      washer: createSchema('washer', {
        dimensions: [
          { id: 'brand', label: 'Brand', type: 'string', required: true },
          { id: 'model', label: 'Model', type: 'string', required: true },
          { id: 'capacityKg', label: 'Capacity', type: 'numeric', required: true, unit: 'kg' }
        ]
      }),
      dryer: createSchema('dryer', {
        dimensions: [
          { id: 'brand', label: 'Brand', type: 'string', required: true },
          { id: 'model', label: 'Model', type: 'string', required: true },
          { id: 'noiseLevelDb', label: 'Noise', type: 'numeric', required: false, unit: 'dB' }
        ]
      })
    },
    optionsByAppliance: {
      'laundry-set': [
        createOption('set-1', {
          brand: { status: 'known', value: 'BundleCo' },
          bundlePrice: { status: 'known', value: 2000 },
          washer: { status: 'known', value: 'washer-1' },
          dryer: { status: 'known', value: 'dryer-1' }
        })
      ],
      washer: [
        createOption('washer-1', {
          brand: { status: 'known', value: 'WashCo' },
          model: { status: 'known', value: 'W1' },
          capacityKg: { status: 'known', value: 10 }
        })
      ],
      dryer: [
        createOption('dryer-1', {
          brand: { status: 'known', value: 'DryCo' },
          model: { status: 'known', value: 'D1' },
          noiseLevelDb: { status: 'known', value: 61 }
        })
      ]
    },
    presetsByAppliance: {
      'laundry-set': {
        ok: true,
        presets: [
          {
            id: 'preset-1',
            name: 'Delegated preset',
            applianceKey: 'laundry-set',
            dimensionKeys: ['washer.capacityKg', 'washer'],
            effectiveDimensionKeys: ['washer.capacityKg', 'washer']
          }
        ],
        warnings: [],
        failure: null
      }
    },
    savePresetResult: { ok: true, preset: null, warnings: [], validationErrors: [], failure: null },
    deletePresetResult: { ok: true, deletedPresetId: 'unused', warnings: [], failure: null }
  })
  api.listSchemas = async () => ({ schemas: [{ applianceKey: 'laundry-set', displayName: 'Laundry Set' }] })

  const controller = createComparisonWorkspaceController({ apiProvider: () => api })
  await controller.boot()

  assert.deepEqual(controller.getState().comparison.comparedDimensionKeys, ['brand', 'washer', 'dryer'])
  assert.equal(controller.getState().comparison.addableDimensions.some((dimension) => dimension.id.includes('.')), false)

  controller.applyPreset('preset-1')
  assert.deepEqual(controller.getState().comparison.comparedDimensionKeys, ['washer'])
})

test('comparison cell derivation renders known, na, empty, and direct pointer values', async () => {
  const { deriveComparisonCell } = await loadComparisonWorkspaceModule()

  assert.deepEqual(
    deriveComparisonCell(
      { id: 'price', type: 'numeric', unit: 'CNY' },
      { price: { status: 'known', value: 1200 } }
    ),
    { kind: 'known', text: '1200 CNY' }
  )

  assert.deepEqual(
    deriveComparisonCell(
      { id: 'price', type: 'numeric', unit: 'CNY' },
      { price: { status: 'na' } }
    ),
    {
      kind: 'na',
      text: 'N/A',
      className: 'evaluation-token evaluation-token--na',
      dataEvaluationState: 'na'
    }
  )

  assert.deepEqual(
    deriveComparisonCell(
      { id: 'washer', type: 'pointer' },
      { washer: { status: 'known', value: 'washer-1' } }
    ),
    { kind: 'known', text: 'washer-1' }
  )

  assert.deepEqual(
    deriveComparisonCell(
      { id: 'warrantyMonths', type: 'numeric' },
      {}
    ),
    { kind: 'empty', text: '—' }
  )
})

test('filters do not clear selected comparison Option ids and comparison ordering follows canonical rows', async () => {
  const { createComparisonWorkspaceController } = await loadComparisonWorkspaceModule()
  const controller = createComparisonWorkspaceController({
    apiProvider: () => ({
      listSchemas: async () => ({ schemas: [{ applianceKey: 'washer', displayName: 'Washer' }] }),
      loadSchema: async () => ({
        ok: true,
        schema: createSchema('washer')
      }),
      loadOptions: async () => ({
        ok: true,
        options: [
          createOption('washer-b', {
            brand: { status: 'known', value: 'Bravo' },
            model: { status: 'known', value: 'B2' },
            price: { status: 'known', value: 1200 }
          }),
          createOption('washer-a', {
            brand: { status: 'known', value: 'Alpha' },
            model: { status: 'known', value: 'A1' },
            price: { status: 'known', value: 900 }
          })
        ]
      }),
      loadPresets: async () => ({ ok: true, presets: [], warnings: [], failure: null }),
      savePreset: async () => ({ ok: true, preset: null, warnings: [], validationErrors: [], failure: null }),
      deletePreset: async () => ({ ok: true, deletedPresetId: 'unused', warnings: [], failure: null })
    })
  })

  await controller.boot()
  controller.toggleOptionSelection('washer-b')
  controller.toggleOptionSelection('washer-a')

  await controller.updateFilters({ dimensionId: 'brand', patch: { mode: 'exact', value: 'Alpha' } })

  assert.deepEqual(controller.getState().comparison.selectedOptionIds, ['washer-b', 'washer-a'])
  assert.deepEqual(controller.getState().comparison.selectedOptions.map((option) => option.id), ['washer-a', 'washer-b'])
})

test('buildComparisonMatrix preserves incomplete selected laundry-set metadata for rendering', async () => {
  const { buildComparisonMatrix } = await loadComparisonWorkspaceModule()

  const matrix = buildComparisonMatrix({
    availableDimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true }
    ],
    comparedDimensionKeys: ['brand'],
    orderedOptions: [
      {
        id: 'set-1',
        option: createOption('set-1', {
          brand: { status: 'known', value: 'BundleCo' }
        }),
        isIncomplete: true,
        warning: {
          text: 'Warning',
          title: 'Warning: Missing delegated reference for washer.'
        }
      }
    ],
    selectedOptionIds: ['set-1']
  })

  assert.equal(matrix.selectedOptions[0].isIncomplete, true)
  assert.equal(matrix.selectedOptions[0].warning.text, 'Warning')
  assert.equal(matrix.rows[0].cells[0].text, 'BundleCo')
})

test('comparison controller keeps selected incomplete laundry-set entries after reload', async () => {
  const { createComparisonWorkspaceController } = await loadComparisonWorkspaceModule()
  const shellController = createShellControllerStub({
    initialState: {
      navigationItems: [{ key: 'laundry-set', label: 'Laundry Set' }],
      activeKey: 'laundry-set',
      view: {
        status: 'loading',
        message: 'Loading Laundry Set…',
        columns: [],
        rows: []
      }
    },
    bootStateByKey: {
      'laundry-set': {
        navigationItems: [{ key: 'laundry-set', label: 'Laundry Set' }],
        activeKey: 'laundry-set',
        view: {
          status: 'ready',
          message: '',
          columns: [{ id: 'brand', label: 'Brand' }],
          rows: [
            {
              key: 'set-1',
              option: createOption('set-1', {
                brand: { status: 'known', value: 'BundleCo' },
                washer: { status: 'na' },
                dryer: { status: 'known', value: 'dryer-1' }
              }),
              cells: [],
              isIncomplete: true,
              warning: {
                text: 'Warning',
                title: 'Warning: Missing delegated reference for washer.'
              }
            }
          ]
        }
      }
    }
  })

  const controller = createComparisonWorkspaceController({
    apiProvider: () => ({
      loadSchema: async () => ({
        ok: true,
        schema: {
          appliance: 'laundry-set',
          defaultComparisonDimensionIds: ['brand'],
          dimensions: [
            { id: 'brand', label: 'Brand', type: 'string', required: true },
            { id: 'washer', label: 'Washer', type: 'pointer', required: true },
            { id: 'dryer', label: 'Dryer', type: 'pointer', required: true }
          ]
        }
      }),
      loadPresets: async () => ({ ok: true, presets: [], warnings: [], failure: null }),
      savePreset: async () => ({ ok: true, preset: null, warnings: [], validationErrors: [], failure: null }),
      deletePreset: async () => ({ ok: true, deletedPresetId: 'unused', warnings: [], failure: null })
    }),
    shellController
  })

  await controller.boot()
  controller.toggleOptionSelection('set-1')
  await controller.retry()

  assert.deepEqual(controller.getState().comparison.selectedOptionIds, ['set-1'])
  assert.equal(controller.getState().comparison.selectedOptions[0].isIncomplete, true)
  assert.equal(controller.getState().comparison.selectedOptions[0].warning.text, 'Warning')
})
