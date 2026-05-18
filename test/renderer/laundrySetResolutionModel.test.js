const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadModule() {
  return import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'shell', 'laundrySetResolutionModel.mjs')).href)
}

function createTargetSchema(dimensions) {
  return { dimensions }
}

function createOption(id, evaluations) {
  return { id, evaluations }
}

test('createLaundrySetResolutionContext indexes referenced schemas and catalogs', async () => {
  const { createLaundrySetResolutionContext } = await loadModule()

  const result = createLaundrySetResolutionContext({
    washer: {
      schema: createTargetSchema([
        { id: 'capacityKg', label: 'Capacity', type: 'numeric', required: true, unit: 'kg' }
      ]),
      options: [createOption('washer-1', { capacityKg: { status: 'known', value: 10 } })]
    },
    dryer: {
      schema: createTargetSchema([
        { id: 'noiseLevelDb', label: 'Noise', type: 'numeric', required: false, unit: 'dB' }
      ]),
      options: [createOption('dryer-1', { noiseLevelDb: { status: 'known', value: 62 } })]
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.targets.washer.optionsById.get('washer-1').id, 'washer-1')
  assert.equal(result.targets.dryer.dimensionsById.get('noiseLevelDb').type, 'numeric')
})

test('resolveLaundrySetColumn validates delegated dimension compatibility against target schema', async () => {
  const { createLaundrySetResolutionContext, resolveLaundrySetColumn } = await loadModule()

  const context = createLaundrySetResolutionContext({
    washer: {
      schema: createTargetSchema([
        { id: 'capacityKg', label: 'Capacity', type: 'numeric', required: true, unit: 'kg' }
      ]),
      options: [createOption('washer-1', {})]
    },
    dryer: {
      schema: createTargetSchema([
        { id: 'noiseLevelDb', label: 'Noise', type: 'numeric', required: false, unit: 'dB' }
      ]),
      options: [createOption('dryer-1', {})]
    }
  })

  const delegated = resolveLaundrySetColumn({
    id: 'washer.capacityKg',
    label: 'Washer Capacity',
    type: 'numeric',
    required: false
  }, context)

  assert.equal(delegated.ok, true)
  assert.deepEqual(delegated.column.delegated, { pointerKey: 'washer', dimensionId: 'capacityKg' })
  assert.equal(delegated.column.unit, 'kg')

  const mismatch = resolveLaundrySetColumn({
    id: 'dryer.noiseLevelDb',
    label: 'Noise',
    type: 'string',
    required: false
  }, context)

  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.category, 'Schema unavailable or invalid')
})

test('deriveLaundrySetRow resolves delegated values and keeps delegated na values non-incomplete', async () => {
  const { createLaundrySetResolutionContext, deriveLaundrySetRow, resolveLaundrySetColumn } = await loadModule()

  const context = createLaundrySetResolutionContext({
    washer: {
      schema: createTargetSchema([
        { id: 'capacityKg', label: 'Capacity', type: 'numeric', required: true, unit: 'kg' }
      ]),
      options: [createOption('washer-1', { capacityKg: { status: 'known', value: 11 } })]
    },
    dryer: {
      schema: createTargetSchema([
        { id: 'noiseLevelDb', label: 'Noise', type: 'numeric', required: false, unit: 'dB' }
      ]),
      options: [createOption('dryer-1', { noiseLevelDb: { status: 'na' } })]
    }
  })

  const washerColumn = resolveLaundrySetColumn({ id: 'washer.capacityKg', label: 'Washer Capacity', type: 'numeric', required: false }, context).column
  const dryerColumn = resolveLaundrySetColumn({ id: 'dryer.noiseLevelDb', label: 'Dryer Noise', type: 'numeric', required: false }, context).column

  const result = deriveLaundrySetRow(createOption('set-1', {
    brand: { status: 'known', value: 'Bundle' },
    washer: { status: 'known', value: 'washer-1' },
    dryer: { status: 'known', value: 'dryer-1' }
  }), [
    { id: 'brand', label: 'Brand', type: 'string', required: true, delegated: null },
    washerColumn,
    dryerColumn
  ], context)

  assert.equal(result.ok, true)
  assert.equal(result.row.isIncomplete, false)
  assert.equal(result.row.cells[1].text, '11 kg')
  assert.equal(result.row.cells[2].text, 'N/A')
})

test('deriveLaundrySetRow marks unresolved pointer states incomplete with visible Warning metadata', async () => {
  const { createLaundrySetResolutionContext, deriveLaundrySetRow, resolveLaundrySetColumn } = await loadModule()

  const context = createLaundrySetResolutionContext({
    washer: {
      schema: createTargetSchema([
        { id: 'capacityKg', label: 'Capacity', type: 'numeric', required: true, unit: 'kg' }
      ]),
      options: [createOption('washer-1', { capacityKg: { status: 'known', value: 10 } })]
    },
    dryer: {
      schema: createTargetSchema([
        { id: 'noiseLevelDb', label: 'Noise', type: 'numeric', required: false, unit: 'dB' }
      ]),
      options: [createOption('dryer-1', { noiseLevelDb: { status: 'known', value: 60 } })]
    }
  })

  const washerColumn = resolveLaundrySetColumn({ id: 'washer.capacityKg', label: 'Washer Capacity', type: 'numeric', required: false }, context).column

  const unresolved = deriveLaundrySetRow(createOption('set-2', {
    brand: { status: 'known', value: 'Bundle' },
    washer: { status: 'na' },
    dryer: { status: 'known', value: 'missing-dryer' }
  }), [
    { id: 'brand', label: 'Brand', type: 'string', required: true, delegated: null },
    washerColumn
  ], context)

  assert.equal(unresolved.ok, true)
  assert.equal(unresolved.row.isIncomplete, true)
  assert.equal(unresolved.row.cells[1].text, 'N/A')
  assert.deepEqual(unresolved.row.warning.missingReferences, ['washer', 'dryer'])
  assert.match(unresolved.row.warning.title, /washer and dryer/)
})

test('createLaundrySetResolutionContext tolerates unavailable supporting schemas and marks delegated references unresolved', async () => {
  const { createLaundrySetResolutionContext, deriveLaundrySetRow, resolveLaundrySetColumn } = await loadModule()

  const context = createLaundrySetResolutionContext({
    washer: {
      schemaAvailable: false,
      schema: null,
      optionsAvailable: false,
      options: []
    },
    dryer: {
      schema: createTargetSchema([
        { id: 'noiseLevelDb', label: 'Noise', type: 'numeric', required: false, unit: 'dB' }
      ]),
      options: [createOption('dryer-1', { noiseLevelDb: { status: 'known', value: 60 } })]
    }
  })

  assert.equal(context.ok, true)
  assert.equal(context.targets.washer.available, false)
  assert.equal(context.targets.dryer.available, true)

  const washerColumn = resolveLaundrySetColumn({ id: 'washer.capacityKg', label: 'Washer Capacity', type: 'numeric', required: false }, context).column

  const result = deriveLaundrySetRow(createOption('set-3', {
    brand: { status: 'known', value: 'Bundle' },
    washer: { status: 'known', value: 'washer-1' },
    dryer: { status: 'known', value: 'dryer-1' }
  }), [
    { id: 'brand', label: 'Brand', type: 'string', required: true, delegated: null },
    washerColumn
  ], context)

  assert.equal(result.ok, true)
  assert.equal(result.row.isIncomplete, true)
  assert.equal(result.row.cells[1].text, 'N/A')
  assert.deepEqual(result.row.warning.missingReferences, ['washer'])
 })
