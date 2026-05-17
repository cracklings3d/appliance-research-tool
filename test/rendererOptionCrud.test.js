const test = require('node:test')
const assert = require('node:assert/strict')

let optionCrudModelPromise

async function loadOptionCrudModel() {
  optionCrudModelPromise ??= import('../src/renderer/src/optionCrudModel.mjs')
  const module = await optionCrudModelPromise
  return module.default
}

test('deriveEditableFields preserves schema order, excludes delegated paths, and keeps pointer dimensions', () => {
  return loadOptionCrudModel().then(({ deriveEditableFields }) => {
  const fields = deriveEditableFields({
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true },
      { id: 'washer.capacityKg', label: 'Delegated Washer Capacity', type: 'numeric', required: false },
      { id: 'bundlePrice', label: 'Bundle Price', type: 'numeric', required: true, unit: 'CNY' },
      { id: 'washer', label: 'Washer', type: 'pointer', required: true, targetAppliance: 'washer' },
      { id: 'unsupported', label: 'Unsupported', type: 'object', required: false },
      { id: 'dryer', label: 'Dryer', type: 'pointer', required: true, targetAppliance: 'dryer' }
    ]
  })

  assert.deepEqual(fields.map((field) => field.id), ['brand', 'bundlePrice', 'washer', 'dryer'])
  assert.equal(fields[2].targetAppliance, 'washer')
  })
})

test('buildOptionPayload omits create ids, preserves edit ids, and maps known and na states', () => {
  return loadOptionCrudModel().then(({ buildOptionPayload, deriveEditableFields }) => {
  const fields = deriveEditableFields({
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true },
      { id: 'price', label: 'Price', type: 'numeric', required: true },
      { id: 'hasInverterMotor', label: 'Has Inverter Motor', type: 'boolean', required: false },
      { id: 'sourceUrl', label: 'Source URL', type: 'string', required: false }
    ]
  })

  const createPayload = buildOptionPayload({
    fields,
    optionId: null,
    draft: {
      brand: { status: 'known', value: 'LG' },
      price: { status: 'known', value: '1999.5' },
      hasInverterMotor: { status: 'known', value: true },
      sourceUrl: { status: 'na', value: '' }
    }
  })

  assert.equal('id' in createPayload, false)
  assert.deepEqual(createPayload.evaluations, {
    brand: { status: 'known', value: 'LG' },
    price: { status: 'known', value: 1999.5 },
    hasInverterMotor: { status: 'known', value: true },
    sourceUrl: { status: 'na' }
  })

  const editPayload = buildOptionPayload({
    fields,
    optionId: 'washer-1',
    draft: {
      brand: { status: 'known', value: 'LG Updated' },
      price: { status: 'known', value: '2100' },
      hasInverterMotor: { status: 'known', value: false },
      sourceUrl: { status: 'known', value: '' }
    }
  })

  assert.equal(editPayload.id, 'washer-1')
  assert.deepEqual(editPayload.evaluations, {
    brand: { status: 'known', value: 'LG Updated' },
    price: { status: 'known', value: 2100 },
    hasInverterMotor: { status: 'known', value: false }
  })
  })
})

test('edit sessions stay isolated from settled rows, cancel clears the session, and settled rows update only after reload', () => {
  return loadOptionCrudModel().then(({
    applyReloadedOptions,
    beginCreateSession,
    beginEditSession,
    cancelSession,
    createCrudViewState,
    deriveEditableFields,
    markSaveSuccessPendingReload,
    updateSessionDraft
  }) => {
  const fields = deriveEditableFields({
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true },
      { id: 'price', label: 'Price', type: 'numeric', required: true }
    ]
  })
  const settledOptions = [
    {
      id: 'washer-1',
      evaluations: {
        brand: { status: 'known', value: 'LG' },
        price: { status: 'known', value: 1000 }
      }
    }
  ]

  let state = createCrudViewState(settledOptions)
  state = beginEditSession(state, fields, settledOptions[0])
  state = updateSessionDraft(state, 'brand', { value: 'Edited Brand' })

  assert.equal(state.session.draft.brand.value, 'Edited Brand')
  assert.equal(state.settledOptions[0].evaluations.brand.value, 'LG')

  const cancelled = cancelSession(state)
  assert.equal(cancelled.session, null)
  assert.equal(cancelled.settledOptions[0].evaluations.brand.value, 'LG')

  let saveState = beginCreateSession(createCrudViewState(settledOptions), fields)
  saveState = markSaveSuccessPendingReload(saveState)
  assert.equal(saveState.isRefreshingAfterSave, true)
  assert.equal(saveState.settledOptions[0].evaluations.brand.value, 'LG')

  const reloaded = applyReloadedOptions(saveState, [
    {
      id: 'washer-1',
      evaluations: {
        brand: { status: 'known', value: 'Reloaded Brand' },
        price: { status: 'known', value: 1000 }
      }
    }
  ])

  assert.equal(reloaded.isRefreshingAfterSave, false)
  assert.equal(reloaded.session, null)
  assert.equal(reloaded.settledOptions[0].evaluations.brand.value, 'Reloaded Brand')
  })
})

test('groupValidationErrors separates field errors from form-level errors', () => {
  return loadOptionCrudModel().then(({ groupValidationErrors }) => {
  const grouped = groupValidationErrors([
    { code: 'REQUIRED_DIMENSION_MISSING', dimensionId: 'brand', message: 'Brand is required.' },
    { code: 'POINTER_TARGET_REQUIRED', dimensionId: 'washer', message: 'Select a washer.' },
    { code: 'UNKNOWN_OPTION_ID', dimensionId: null, message: 'Unknown option id.' }
  ])

  assert.deepEqual(Object.keys(grouped.fieldErrorsByDimensionId).sort(), ['brand', 'washer'])
  assert.equal(grouped.fieldErrorsByDimensionId.brand[0].code, 'REQUIRED_DIMENSION_MISSING')
  assert.equal(grouped.formErrors[0].code, 'UNKNOWN_OPTION_ID')
  })
})

test('getDeleteImpact counts only known matching pointer references', () => {
  return loadOptionCrudModel().then(({ getDeleteImpact }) => {
  const affectedIds = getDeleteImpact('washer', 'washer-1', [
    {
      id: 'set-1',
      evaluations: {
        washer: { status: 'known', value: 'washer-1' },
        dryer: { status: 'known', value: 'dryer-1' }
      }
    },
    {
      id: 'set-2',
      evaluations: {
        washer: { status: 'na' },
        dryer: { status: 'known', value: 'dryer-2' }
      }
    },
    {
      id: 'set-3',
      evaluations: {
        washer: { status: 'known', value: 'washer-2' },
        dryer: { status: 'known', value: 'dryer-3' }
      }
    }
  ])

  assert.deepEqual(affectedIds, ['set-1'])
  })
})

test('createPointerChoices prefers brand plus model and falls back to the full option id', () => {
  return loadOptionCrudModel().then(({ createPointerChoices }) => {
  const choices = createPointerChoices([
    {
      id: 'washer-1',
      evaluations: {
        brand: { status: 'known', value: 'LG' },
        model: { status: 'known', value: 'TurboWash 9000' }
      }
    },
    {
      id: 'washer-2',
      evaluations: {
        brand: { status: 'known', value: 'Only Brand' }
      }
    }
  ])

  assert.deepEqual(choices, [
    { value: 'washer-1', label: 'LG TurboWash 9000' },
    { value: 'washer-2', label: 'washer-2' }
  ])
  })
})
