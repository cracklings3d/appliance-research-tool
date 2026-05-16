const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')

const {
  OPTION_CODES,
  createOptionStorage,
  resolveOptionFilePath
} = require('../src/main/optionStorage')

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function createDimension(id, type, overrides = {}) {
  return {
    id,
    label: id,
    type,
    required: false,
    ...overrides
  }
}

function createSchema(applianceKey, overrides = {}) {
  const dimensionsByAppliance = {
    washer: [
      createDimension('brand', 'string', { required: true }),
      createDimension('price', 'numeric', { required: true }),
      createDimension('sourceUrl', 'string')
    ],
    dryer: [
      createDimension('brand', 'string', { required: true }),
      createDimension('price', 'numeric', { required: true }),
      createDimension('sourceUrl', 'string')
    ],
    'laundry-set': [
      createDimension('brand', 'string', { required: true }),
      createDimension('bundlePrice', 'numeric', { required: true }),
      createDimension('washer', 'pointer', { required: true, targetAppliance: 'washer' }),
      createDimension('dryer', 'pointer', { required: true, targetAppliance: 'dryer' })
    ]
  }

  const base = {
    appliance: applianceKey,
    dimensions: dimensionsByAppliance[applianceKey],
    requiredDimensionIds: dimensionsByAppliance[applianceKey].filter((dimension) => dimension.required).map((dimension) => dimension.id),
    pointerDimensionsAllowed: applianceKey === 'laundry-set'
  }

  return {
    ...base,
    ...overrides
  }
}

function createLaundrySetSchemaWithInvalidPointerMetadata(variant) {
  const schema = createSchema('laundry-set')

  switch (variant) {
    case 'missing-pointer-dimensions':
      return {
        ...schema,
        dimensions: schema.dimensions.filter((dimension) => dimension.id !== 'washer' && dimension.id !== 'dryer'),
        requiredDimensionIds: schema.requiredDimensionIds.filter((dimensionId) => dimensionId !== 'washer' && dimensionId !== 'dryer')
      }
    case 'duplicated-pointer-dimension':
      return {
        ...schema,
        dimensions: [...schema.dimensions, createDimension('washer', 'pointer', { required: true, targetAppliance: 'washer' })]
      }
    case 'mistyped-pointer-dimension':
      return {
        ...schema,
        dimensions: schema.dimensions.map((dimension) => (
          dimension.id === 'washer'
            ? { ...dimension, type: 'string', targetAppliance: undefined }
            : dimension
        ))
      }
    case 'wrong-target-appliance':
      return {
        ...schema,
        dimensions: schema.dimensions.map((dimension) => (
          dimension.id === 'dryer'
            ? { ...dimension, targetAppliance: 'washer' }
            : dimension
        ))
      }
    default:
      throw new Error(`Unsupported invalid laundry-set schema variant: ${variant}`)
  }
}

function createSchemaStorageMock(schemas, failures = {}) {
  return {
    async loadSchema(applianceKey) {
      if (failures[applianceKey]) {
        return {
          ok: false,
          schema: null,
          warnings: [],
          failure: failures[applianceKey]
        }
      }

      return {
        ok: true,
        schema: schemas[applianceKey],
        warnings: [],
        failure: null
      }
    }
  }
}

async function writeOptionDocument(userDataPath, applianceKey, document) {
  const optionsDir = path.join(userDataPath, 'options')
  await fs.mkdir(optionsDir, { recursive: true })
  await fs.writeFile(resolveOptionFilePath(optionsDir, applianceKey), `${JSON.stringify(document, null, 2)}\n`)
}

async function readOptionDocument(userDataPath, applianceKey) {
  const contents = await fs.readFile(resolveOptionFilePath(path.join(userDataPath, 'options'), applianceKey), 'utf8')
  return JSON.parse(contents)
}

function createFsProxy(overrides = {}) {
  return {
    ...fs,
    mkdir: overrides.mkdir ?? ((...args) => fs.mkdir(...args)),
    writeFile: overrides.writeFile ?? ((...args) => fs.writeFile(...args)),
    rename: overrides.rename ?? ((...args) => fs.rename(...args)),
    unlink: overrides.unlink ?? ((...args) => fs.unlink(...args)),
    readFile: overrides.readFile ?? ((...args) => fs.readFile(...args))
  }
}

test('loadOptions returns empty success for a missing file', async () => {
  const userDataPath = await createTempDir('option-storage-load-missing-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  const result = await storage.loadOptions('washer')

  assert.deepEqual(result, {
    ok: true,
    options: [],
    warnings: [],
    failure: null
  })
})

test('loadOptions maps top-level file failures deterministically', async () => {
  const userDataPath = await createTempDir('option-storage-load-failures-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '2.0',
    appliance: 'washer',
    options: []
  })

  let result = await storage.loadOptions('washer')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_CONTRACT_VERSION_UNSUPPORTED)

  await fs.writeFile(resolveOptionFilePath(path.join(userDataPath, 'options'), 'washer'), '{bad json')
  result = await storage.loadOptions('washer')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_JSON_PARSE_FAILED)

  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'dryer',
    options: []
  })
  result = await storage.loadOptions('washer')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_APPLIANCE_KEY_MISMATCH)

  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [{ id: 'dup', evaluations: {} }, { id: 'dup', evaluations: {} }]
  })
  result = await storage.loadOptions('washer')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_CONTRACT_INVALID)
})

test('loadOptions returns valid records, strips extra top-level fields, applies safe drops, and blocks unsafe records', async () => {
  const userDataPath = await createTempDir('option-storage-load-migration-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [
      {
        id: 'good-1',
        extra: true,
        evaluations: {
          brand: { status: 'known', value: 'LG' },
          price: { status: 'known', value: 1000 },
          sourceUrl: { status: 'na' }
        }
      },
      {
        id: 'safe-drop',
        evaluations: {
          brand: { status: 'known', value: 'Haier' },
          price: { status: 'known', value: 1300 },
          removedDimension: { status: 'known', value: 'obsolete' }
        }
      },
      {
        id: 'blocked',
        evaluations: {
          brand: { status: 'known', value: 'Midea' },
          price: { status: 'known', value: 'invalid-number' }
        }
      },
      {
        id: 'mixed',
        evaluations: {
          brand: { status: 'known', value: 'Bosch' },
          price: { status: 'known', value: 'invalid-number' },
          removedDimension: { status: 'known', value: 'obsolete' }
        }
      }
    ]
  })

  const result = await storage.loadOptions('washer')

  assert.equal(result.ok, true)
  assert.deepEqual(
    result.options.map((option) => option.id),
    ['good-1', 'safe-drop']
  )
  assert.deepEqual(result.options[0], {
    id: 'good-1',
    evaluations: {
      brand: { status: 'known', value: 'LG' },
      price: { status: 'known', value: 1000 },
      sourceUrl: { status: 'na' }
    }
  })
  assert.deepEqual(result.warnings.map((warning) => [warning.code, warning.optionId, warning.dimensionId]), [
    [OPTION_CODES.OPTION_MIGRATION_APPLIED, 'safe-drop', 'removedDimension'],
    [OPTION_CODES.OPTION_MIGRATION_BLOCKED, 'blocked', 'price'],
    [OPTION_CODES.OPTION_MIGRATION_BLOCKED, 'mixed', 'price']
  ])
})

test('saveOption creates missing files, appends creates, preserves update position, and strips extra top-level fields', async () => {
  const userDataPath = await createTempDir('option-storage-save-create-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    optionIdFactory: (() => {
      let nextId = 0
      return () => `generated-id-${++nextId}`
    })()
  })

  let result = await storage.saveOption('washer', {
    extra: true,
    evaluations: {
      brand: { status: 'known', value: 'LG' },
      price: { status: 'known', value: 2000 }
    }
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.option, {
    id: 'generated-id-1',
    evaluations: {
      brand: { status: 'known', value: 'LG' },
      price: { status: 'known', value: 2000 }
    }
  })

  await storage.saveOption('washer', {
    evaluations: {
      brand: { status: 'known', value: 'Haier' },
      price: { status: 'known', value: 1500 }
    }
  })

  result = await storage.saveOption('washer', {
    id: 'generated-id-1',
    ignored: 'field',
    evaluations: {
      brand: { status: 'known', value: 'LG Updated' },
      price: { status: 'known', value: 2100 }
    }
  })

  assert.equal(result.ok, true)

  const persisted = await readOptionDocument(userDataPath, 'washer')
  assert.deepEqual(persisted.options.map((option) => option.id), ['generated-id-1', 'generated-id-2'])
  assert.deepEqual(persisted.options[0], {
    id: 'generated-id-1',
    evaluations: {
      brand: { status: 'known', value: 'LG Updated' },
      price: { status: 'known', value: 2100 }
    }
  })
})

test('saveOption normalizes rewritten persisted records to the canonical top-level shape', async () => {
  const userDataPath = await createTempDir('option-storage-save-normalize-rewritten-')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [
      {
        id: 'washer-1',
        retainedTopLevelField: 'keep-me',
        evaluations: {
          brand: { status: 'known', value: 'LG' },
          price: { status: 'known', value: 1000 }
        }
      },
      {
        id: 'washer-2',
        evaluations: {
          brand: { status: 'known', value: 'Bosch' },
          price: { status: 'known', value: 1500 }
        }
      }
    ]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  const result = await storage.saveOption('washer', {
    id: 'washer-2',
    extra: 'strip-me',
    evaluations: {
      brand: { status: 'known', value: 'Bosch Updated' },
      price: { status: 'known', value: 1750 }
    }
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.option, {
    id: 'washer-2',
    evaluations: {
      brand: { status: 'known', value: 'Bosch Updated' },
      price: { status: 'known', value: 1750 }
    }
  })

  const persisted = await readOptionDocument(userDataPath, 'washer')
  assert.deepEqual(persisted.options, [
    {
      id: 'washer-1',
      evaluations: {
        brand: { status: 'known', value: 'LG' },
        price: { status: 'known', value: 1000 }
      }
    },
    {
      id: 'washer-2',
      evaluations: {
        brand: { status: 'known', value: 'Bosch Updated' },
        price: { status: 'known', value: 1750 }
      }
    }
  ])
})

test('saveOption returns UNKNOWN_OPTION_ID with the required metadata shaping for malformed and unknown ids', async () => {
  const userDataPath = await createTempDir('option-storage-save-id-matrix-')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [
      {
        id: 'washer-1',
        evaluations: {
          brand: { status: 'known', value: 'LG' },
          price: { status: 'known', value: 1000 }
        }
      }
    ]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  const cases = [
    { name: 'null id', payloadId: null, expectedOptionId: null },
    { name: 'undefined id', payloadId: undefined, expectedOptionId: null },
    { name: 'non-string id', payloadId: 42, expectedOptionId: null },
    { name: 'empty string id', payloadId: '', expectedOptionId: '' },
    { name: 'whitespace-only id', payloadId: '   ', expectedOptionId: '   ' },
    { name: 'unknown id', payloadId: 'washer-missing', expectedOptionId: 'washer-missing' }
  ]

  for (const testCase of cases) {
    const result = await storage.saveOption('washer', {
      id: testCase.payloadId,
      evaluations: {
        brand: { status: 'known', value: 'LG' },
        price: { status: 'known', value: 1200 }
      }
    })

    assert.equal(result.ok, false, testCase.name)
    assert.equal(result.failure, null, testCase.name)

    const unknownIdError = result.validationErrors.find((entry) => entry.code === OPTION_CODES.UNKNOWN_OPTION_ID)
    assert.ok(unknownIdError, testCase.name)
    assert.equal(unknownIdError.applianceKey, 'washer', testCase.name)
    assert.equal(unknownIdError.optionId, testCase.expectedOptionId, testCase.name)
    assert.equal(unknownIdError.dimensionId, null, testCase.name)
  }
})

test('saveOption returns REQUIRED_DIMENSION_MISSING for missing required non-pointer dimensions', async () => {
  const userDataPath = await createTempDir('option-storage-save-required-dimension-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  const result = await storage.saveOption('washer', {
    evaluations: {
      brand: { status: 'known', value: 'LG' }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure, null)
  assert.equal(result.validationErrors.some((entry) => (
    entry.code === OPTION_CODES.REQUIRED_DIMENSION_MISSING
    && entry.applianceKey === 'washer'
    && entry.optionId === null
    && entry.dimensionId === 'price'
  )), true)
})

test('saveOption fails with OPTIONS_CONTRACT_INVALID when the existing target file contains malformed persisted ids', async () => {
  const userDataPath = await createTempDir('option-storage-save-malformed-persisted-id-')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [
      {
        id: '   ',
        evaluations: {
          brand: { status: 'known', value: 'LG' },
          price: { status: 'known', value: 1000 }
        }
      }
    ]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  const result = await storage.saveOption('washer', {
    evaluations: {
      brand: { status: 'known', value: 'Bosch' },
      price: { status: 'known', value: 1400 }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_CONTRACT_INVALID)
  assert.equal(result.failure.applianceKey, 'washer')
  assert.deepEqual(result.validationErrors, [])
})

test('saveOption reports validation errors for invalid payloads and stale dimensions without writing', async () => {
  const userDataPath = await createTempDir('option-storage-save-validation-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  let result = await storage.saveOption('washer', null)
  assert.equal(result.ok, false)
  assert.equal(result.validationErrors[0].code, OPTION_CODES.INVALID_EVALUATION_SHAPE)

  result = await storage.saveOption('washer', {
    id: '   ',
    evaluations: []
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.validationErrors.map((entry) => entry.code).sort(), [
    OPTION_CODES.INVALID_EVALUATION_SHAPE,
    OPTION_CODES.UNKNOWN_OPTION_ID
  ])

  result = await storage.saveOption('washer', {
    evaluations: {
      brand: { status: 'known', value: 'LG' },
      price: { status: 'known', value: 2100 },
      removedDimension: { status: 'known', value: 'obsolete' }
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.validationErrors.some((entry) => entry.code === OPTION_CODES.UNKNOWN_DIMENSION_ID), true)

  const optionsDir = path.join(userDataPath, 'options')
  const exists = await fs.stat(optionsDir).then(() => true).catch(() => false)
  assert.equal(exists, false)
})

test('saveOption laundry-set pointer validation uses dependent catalogs and dependent file failures win', async () => {
  const userDataPath = await createTempDir('option-storage-save-pointers-')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [{ id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1 } } }]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    }),
    optionIdFactory: () => 'laundry-id'
  })

  let result = await storage.saveOption('laundry-set', {
    evaluations: {
      brand: { status: 'known', value: 'Combo' },
      bundlePrice: { status: 'known', value: 5000 },
      washer: { status: 'known', value: 'washer-1' }
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.validationErrors.some((entry) => entry.code === OPTION_CODES.POINTER_TARGET_REQUIRED && entry.dimensionId === 'dryer'), true)

  result = await storage.saveOption('laundry-set', {
    evaluations: {
      brand: { status: 'known', value: 'Combo' },
      bundlePrice: { status: 'known', value: 5000 },
      washer: { status: 'known', value: 'washer-1' },
      dryer: { status: 'known', value: 'dryer-missing' }
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.validationErrors.some((entry) => entry.code === OPTION_CODES.POINTER_TARGET_NOT_FOUND && entry.dimensionId === 'dryer'), true)

  await fs.writeFile(resolveOptionFilePath(path.join(userDataPath, 'options'), 'dryer'), '{invalid json')
  result = await storage.saveOption('laundry-set', {
    evaluations: {
      brand: { status: 'known', value: 'Combo' },
      bundlePrice: { status: 'known', value: 5000 },
      washer: { status: 'known', value: 'washer-1' }
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_JSON_PARSE_FAILED)
  assert.equal(result.failure.applianceKey, 'dryer')
  assert.deepEqual(result.validationErrors, [])
})

test('saveOption treats missing referenced washer and dryer catalogs as empty catalogs during laundry-set pointer lookup', async () => {
  const userDataPath = await createTempDir('option-storage-save-missing-pointer-catalogs-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    })
  })

  const result = await storage.saveOption('laundry-set', {
    evaluations: {
      brand: { status: 'known', value: 'Combo' },
      bundlePrice: { status: 'known', value: 5000 },
      washer: { status: 'known', value: 'washer-missing' },
      dryer: { status: 'known', value: 'dryer-missing' }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure, null)
  assert.deepEqual(
    result.validationErrors
      .filter((entry) => entry.code === OPTION_CODES.POINTER_TARGET_NOT_FOUND)
      .map((entry) => entry.dimensionId)
      .sort(),
    ['dryer', 'washer']
  )
})

test('deleteOption repairs affected laundry-set pointers and reports affected ids', async () => {
  const userDataPath = await createTempDir('option-storage-delete-repair-')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [
      { id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } },
      { id: 'washer-2', evaluations: { brand: { status: 'known', value: 'Haier' }, price: { status: 'known', value: 1200 } } }
    ]
  })
  await writeOptionDocument(userDataPath, 'laundry-set', {
    contractVersion: '1.0',
    appliance: 'laundry-set',
    options: [
      {
        id: 'set-1',
        evaluations: {
          brand: { status: 'known', value: 'Combo A' },
          bundlePrice: { status: 'known', value: 5000 },
          washer: { status: 'known', value: 'washer-1' },
          dryer: { status: 'known', value: 'dryer-1' }
        }
      },
      {
        id: 'set-2',
        evaluations: {
          brand: { status: 'known', value: 'Combo B' },
          bundlePrice: { status: 'known', value: 5500 },
          washer: { status: 'known', value: 'washer-2' },
          dryer: { status: 'known', value: 'dryer-2' }
        }
      }
    ]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    })
  })

  const result = await storage.deleteOption('washer', 'washer-1')
  assert.deepEqual(result, {
    ok: true,
    deletedOptionId: 'washer-1',
    affectedLaundrySetOptionIds: ['set-1'],
    repairedLaundrySetOptionIds: ['set-1'],
    warnings: [],
    failure: null
  })

  const washerDocument = await readOptionDocument(userDataPath, 'washer')
  const laundrySetDocument = await readOptionDocument(userDataPath, 'laundry-set')

  assert.deepEqual(washerDocument.options.map((option) => option.id), ['washer-2'])
  assert.deepEqual(laundrySetDocument.options[0].evaluations.washer, { status: 'na' })
})

test('deleteOption preserves untouched source and laundry-set records as-is while repairing only affected pointer evaluations', async () => {
  const userDataPath = await createTempDir('option-storage-delete-preserve-untouched-')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [
      {
        id: 'washer-1',
        extraSourceField: 'delete-me-with-record',
        evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } }
      },
      {
        id: 'washer-2',
        retainedTopLevelField: 'keep-source-record-intact',
        evaluations: { brand: { status: 'known', value: 'Haier' }, price: { status: 'known', value: 1200 } }
      }
    ]
  })
  await writeOptionDocument(userDataPath, 'laundry-set', {
    contractVersion: '1.0',
    appliance: 'laundry-set',
    options: [
      {
        id: 'set-1',
        retainedTopLevelField: 'keep-repaired-record-top-level',
        evaluations: {
          brand: { status: 'known', value: 'Combo A' },
          bundlePrice: { status: 'known', value: 5000 },
          washer: { status: 'known', value: 'washer-1' },
          dryer: { status: 'known', value: 'dryer-1' }
        }
      },
      {
        id: 'set-2',
        retainedTopLevelField: 'keep-unaffected-record-intact',
        evaluations: {
          brand: { status: 'known', value: 'Combo B' },
          bundlePrice: { status: 'known', value: 5500 },
          washer: { status: 'known', value: 'washer-2' },
          dryer: { status: 'known', value: 'dryer-2' }
        }
      }
    ]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    })
  })

  const result = await storage.deleteOption('washer', 'washer-1')
  assert.equal(result.ok, true)

  const washerDocument = await readOptionDocument(userDataPath, 'washer')
  const laundrySetDocument = await readOptionDocument(userDataPath, 'laundry-set')

  assert.deepEqual(washerDocument.options, [
    {
      id: 'washer-2',
      retainedTopLevelField: 'keep-source-record-intact',
      evaluations: { brand: { status: 'known', value: 'Haier' }, price: { status: 'known', value: 1200 } }
    }
  ])
  assert.deepEqual(laundrySetDocument.options, [
    {
      id: 'set-1',
      retainedTopLevelField: 'keep-repaired-record-top-level',
      evaluations: {
        brand: { status: 'known', value: 'Combo A' },
        bundlePrice: { status: 'known', value: 5000 },
        washer: { status: 'na' },
        dryer: { status: 'known', value: 'dryer-1' }
      }
    },
    {
      id: 'set-2',
      retainedTopLevelField: 'keep-unaffected-record-intact',
      evaluations: {
        brand: { status: 'known', value: 'Combo B' },
        bundlePrice: { status: 'known', value: 5500 },
        washer: { status: 'known', value: 'washer-2' },
        dryer: { status: 'known', value: 'dryer-2' }
      }
    }
  ])
})

test('deleteOption respects precedence for invalid keys, malformed ids, and dependent failures', async () => {
  const userDataPath = await createTempDir('option-storage-delete-precedence-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    })
  })

  let result = await storage.deleteOption('unknown', null)
  assert.equal(result.failure.code, OPTION_CODES.UNKNOWN_APPLIANCE_KEY)

  result = await storage.deleteOption('washer', '   ')
  assert.equal(result.failure.code, OPTION_CODES.OPTION_NOT_FOUND)
  assert.equal(result.failure.optionId, '   ')

  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: []
  })
  await fs.writeFile(resolveOptionFilePath(path.join(userDataPath, 'options'), 'laundry-set'), '{bad json')

  result = await storage.deleteOption('washer', 'missing-id')
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_JSON_PARSE_FAILED)
  assert.equal(result.failure.applianceKey, 'laundry-set')
})

test('deleteOption returns OPTION_NOT_FOUND for missing source file and does not create files', async () => {
  const userDataPath = await createTempDir('option-storage-delete-missing-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    })
  })

  const result = await storage.deleteOption('laundry-set', 'missing-id')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTION_NOT_FOUND)

  const optionsDirExists = await fs.stat(path.join(userDataPath, 'options')).then(() => true).catch(() => false)
  assert.equal(optionsDirExists, false)
})

test('deleteOption succeeds for laundry-set self-delete with empty affected and repaired arrays', async () => {
  const userDataPath = await createTempDir('option-storage-delete-laundry-self-')
  await writeOptionDocument(userDataPath, 'laundry-set', {
    contractVersion: '1.0',
    appliance: 'laundry-set',
    options: [
      {
        id: 'set-1',
        evaluations: {
          brand: { status: 'known', value: 'Combo A' },
          bundlePrice: { status: 'known', value: 5000 },
          washer: { status: 'known', value: 'washer-1' },
          dryer: { status: 'known', value: 'dryer-1' }
        }
      }
    ]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ 'laundry-set': createSchema('laundry-set') })
  })

  const result = await storage.deleteOption('laundry-set', 'set-1')
  assert.deepEqual(result, {
    ok: true,
    deletedOptionId: 'set-1',
    affectedLaundrySetOptionIds: [],
    repairedLaundrySetOptionIds: [],
    warnings: [],
    failure: null
  })

  const laundrySetDocument = await readOptionDocument(userDataPath, 'laundry-set')
  assert.deepEqual(laundrySetDocument.options, [])
})

test('deleteOption succeeds for washer delete when no dependent laundry-set file exists', async () => {
  const userDataPath = await createTempDir('option-storage-delete-no-dependent-file-')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [
      { id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }
    ]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      'laundry-set': createSchema('laundry-set')
    })
  })

  const result = await storage.deleteOption('washer', 'washer-1')
  assert.deepEqual(result, {
    ok: true,
    deletedOptionId: 'washer-1',
    affectedLaundrySetOptionIds: [],
    repairedLaundrySetOptionIds: [],
    warnings: [],
    failure: null
  })
})

test('deleteOption returns requested source-file failure before dependent laundry-set failure', async () => {
  const userDataPath = await createTempDir('option-storage-delete-source-failure-precedence-')
  await fs.mkdir(path.join(userDataPath, 'options'), { recursive: true })
  await fs.writeFile(resolveOptionFilePath(path.join(userDataPath, 'options'), 'washer'), '{bad washer json')
  await fs.writeFile(resolveOptionFilePath(path.join(userDataPath, 'options'), 'laundry-set'), '{bad laundry-set json')

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      'laundry-set': createSchema('laundry-set')
    })
  })

  const result = await storage.deleteOption('washer', 'washer-1')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_JSON_PARSE_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')
})

test('schema dependency gate returns SCHEMA_CONTRACT_INVALID for inconsistent required metadata', async () => {
  const userDataPath = await createTempDir('option-storage-schema-gate-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer', { requiredDimensionIds: ['brand'] })
    })
  })

  const result = await storage.loadOptions('washer')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.SCHEMA_CONTRACT_INVALID)
})

test('reused schema failures from issue #10 surface as top-level failures across loadOptions, saveOption, and deleteOption', async () => {
  const schemaFailureCodes = [
    OPTION_CODES.SHIPPED_SCHEMA_SOURCE_MISSING,
    OPTION_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED,
    OPTION_CODES.LOCAL_SCHEMA_NOT_FOUND,
    OPTION_CODES.SCHEMA_FILE_UNREADABLE,
    OPTION_CODES.SCHEMA_JSON_PARSE_FAILED,
    OPTION_CODES.SCHEMA_CONTRACT_INVALID,
    OPTION_CODES.SCHEMA_APPLIANCE_KEY_MISMATCH
  ]

  for (const code of schemaFailureCodes) {
    const userDataPath = await createTempDir(`option-storage-schema-failure-${code.toLowerCase()}-`)
    const failure = {
      code,
      message: `${code} message`,
      applianceKey: 'washer',
      optionId: 'ignored-by-option-storage',
      dimensionId: 'ignored-by-option-storage'
    }

    const storage = createOptionStorage({
      userDataPath,
      schemaStorage: createSchemaStorageMock({}, { washer: failure })
    })

    const loadResult = await storage.loadOptions('washer')
    assert.equal(loadResult.ok, false, `load ${code}`)
    assert.equal(loadResult.failure.code, code, `load ${code}`)
    assert.equal(loadResult.failure.applianceKey, 'washer', `load ${code}`)
    assert.equal(loadResult.failure.optionId, null, `load ${code}`)
    assert.equal(loadResult.failure.dimensionId, null, `load ${code}`)

    const saveResult = await storage.saveOption('washer', { evaluations: {} })
    assert.equal(saveResult.ok, false, `save ${code}`)
    assert.equal(saveResult.failure.code, code, `save ${code}`)
    assert.equal(saveResult.failure.applianceKey, 'washer', `save ${code}`)
    assert.equal(saveResult.failure.optionId, null, `save ${code}`)
    assert.equal(saveResult.failure.dimensionId, null, `save ${code}`)
    assert.deepEqual(saveResult.validationErrors, [], `save ${code}`)

    const deleteResult = await storage.deleteOption('washer', 'washer-1')
    assert.equal(deleteResult.ok, false, `delete ${code}`)
    assert.equal(deleteResult.failure.code, code, `delete ${code}`)
    assert.equal(deleteResult.failure.applianceKey, 'washer', `delete ${code}`)
    assert.equal(deleteResult.failure.optionId, null, `delete ${code}`)
    assert.equal(deleteResult.failure.dimensionId, null, `delete ${code}`)
  }
})

test('unknown appliance failures echo the raw caller input string and normalize non-strings to null', async () => {
  const userDataPath = await createTempDir('option-storage-unknown-appliance-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  const loadFailure = await storage.loadOptions('unknown-appliance')
  assert.equal(loadFailure.failure.code, OPTION_CODES.UNKNOWN_APPLIANCE_KEY)
  assert.equal(loadFailure.failure.applianceKey, 'unknown-appliance')

  const saveFailure = await storage.saveOption('unknown-appliance', { evaluations: {} })
  assert.equal(saveFailure.failure.code, OPTION_CODES.UNKNOWN_APPLIANCE_KEY)
  assert.equal(saveFailure.failure.applianceKey, 'unknown-appliance')

  const deleteFailure = await storage.deleteOption(null, 'option-1')
  assert.equal(deleteFailure.failure.code, OPTION_CODES.UNKNOWN_APPLIANCE_KEY)
  assert.equal(deleteFailure.failure.applianceKey, null)
})

test('loadOptions covers the remaining top-level option-file invariant branches', async () => {
  const userDataPath = await createTempDir('option-storage-load-invariants-')
  const optionsDir = path.join(userDataPath, 'options')

  const unreadableStorage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      async readFile(filePath, ...args) {
        if (path.normalize(filePath) === path.normalize(resolveOptionFilePath(optionsDir, 'washer'))) {
          const error = new Error('unreadable')
          error.code = 'EACCES'
          throw error
        }

        return fs.readFile(filePath, ...args)
      }
    })
  })

  let result = await unreadableStorage.loadOptions('washer')
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_FILE_UNREADABLE)

  const matrix = [
    {
      name: 'parsed root is not an object',
      document: [],
      expectedCode: OPTION_CODES.OPTIONS_CONTRACT_INVALID
    },
    {
      name: 'missing appliance',
      document: { contractVersion: '1.0', options: [] },
      expectedCode: OPTION_CODES.OPTIONS_CONTRACT_INVALID
    },
    {
      name: 'non-canonical appliance',
      document: { contractVersion: '1.0', appliance: 'fridge', options: [] },
      expectedCode: OPTION_CODES.OPTIONS_CONTRACT_INVALID
    },
    {
      name: 'options is not an array',
      document: { contractVersion: '1.0', appliance: 'washer', options: {} },
      expectedCode: OPTION_CODES.OPTIONS_CONTRACT_INVALID
    },
    {
      name: 'missing persisted id',
      document: { contractVersion: '1.0', appliance: 'washer', options: [{ evaluations: {} }] },
      expectedCode: OPTION_CODES.OPTIONS_CONTRACT_INVALID
    },
    {
      name: 'empty persisted id',
      document: { contractVersion: '1.0', appliance: 'washer', options: [{ id: '   ', evaluations: {} }] },
      expectedCode: OPTION_CODES.OPTIONS_CONTRACT_INVALID
    },
    {
      name: 'non-string persisted id',
      document: { contractVersion: '1.0', appliance: 'washer', options: [{ id: 42, evaluations: {} }] },
      expectedCode: OPTION_CODES.OPTIONS_CONTRACT_INVALID
    }
  ]

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  for (const testCase of matrix) {
    if (typeof testCase.document === 'string') {
      await fs.writeFile(resolveOptionFilePath(optionsDir, 'washer'), testCase.document)
    } else {
      await writeOptionDocument(userDataPath, 'washer', testCase.document)
    }

    result = await storage.loadOptions('washer')
    assert.equal(result.ok, false, testCase.name)
    assert.equal(result.failure.code, testCase.expectedCode, testCase.name)
  }
})

for (const variant of [
  'missing-pointer-dimensions',
  'duplicated-pointer-dimension',
  'mistyped-pointer-dimension',
  'wrong-target-appliance'
]) {
  test(`loadOptions fails for laundry-set schema with ${variant}`, async () => {
    const userDataPath = await createTempDir(`option-storage-load-laundry-schema-${variant}-`)
    const storage = createOptionStorage({
      userDataPath,
      schemaStorage: createSchemaStorageMock({
        'laundry-set': createLaundrySetSchemaWithInvalidPointerMetadata(variant)
      })
    })

    const result = await storage.loadOptions('laundry-set')

    assert.equal(result.ok, false)
    assert.equal(result.failure.code, OPTION_CODES.SCHEMA_CONTRACT_INVALID)
    assert.equal(result.failure.applianceKey, 'laundry-set')
    assert.deepEqual(result.options, [])
    assert.deepEqual(result.warnings, [])
  })

  test(`saveOption fails for laundry-set schema with ${variant}`, async () => {
    const userDataPath = await createTempDir(`option-storage-save-laundry-schema-${variant}-`)
    const storage = createOptionStorage({
      userDataPath,
      schemaStorage: createSchemaStorageMock({
        washer: createSchema('washer'),
        dryer: createSchema('dryer'),
        'laundry-set': createLaundrySetSchemaWithInvalidPointerMetadata(variant)
      })
    })

    const result = await storage.saveOption('laundry-set', {
      evaluations: {
        brand: { status: 'known', value: 'Combo' },
        bundlePrice: { status: 'known', value: 5000 },
        washer: { status: 'known', value: 'washer-1' },
        dryer: { status: 'known', value: 'dryer-1' }
      }
    })

    assert.equal(result.ok, false)
    assert.equal(result.failure.code, OPTION_CODES.SCHEMA_CONTRACT_INVALID)
    assert.equal(result.failure.applianceKey, 'laundry-set')
    assert.deepEqual(result.validationErrors, [])
    assert.equal(result.option, null)
  })

  test(`deleteOption fails for laundry-set schema dependency with ${variant}`, async () => {
    const userDataPath = await createTempDir(`option-storage-delete-laundry-schema-${variant}-`)
    await writeOptionDocument(userDataPath, 'washer', {
      contractVersion: '1.0',
      appliance: 'washer',
      options: [{ id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }]
    })

    const storage = createOptionStorage({
      userDataPath,
      schemaStorage: createSchemaStorageMock({
        washer: createSchema('washer'),
        'laundry-set': createLaundrySetSchemaWithInvalidPointerMetadata(variant)
      })
    })

    const result = await storage.deleteOption('washer', 'washer-1')

    assert.equal(result.ok, false)
    assert.equal(result.failure.code, OPTION_CODES.SCHEMA_CONTRACT_INVALID)
    assert.equal(result.failure.applianceKey, 'laundry-set')
    assert.equal(result.failure.optionId, null)

    const washerDocument = await readOptionDocument(userDataPath, 'washer')
    assert.deepEqual(washerDocument.options.map((option) => option.id), ['washer-1'])
  })
}

test('saveOption returns OPTIONS_DIRECTORY_CREATE_FAILED when first-save directory creation fails', async () => {
  const userDataPath = await createTempDir('option-storage-save-mkdir-failure-')
  const optionsDir = path.join(userDataPath, 'options')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      async mkdir(targetPath) {
        if (path.normalize(targetPath) === path.normalize(optionsDir)) {
          throw new Error('mkdir failed')
        }

        return fs.mkdir(targetPath, { recursive: true })
      }
    })
  })

  const result = await storage.saveOption('washer', {
    evaluations: {
      brand: { status: 'known', value: 'LG' },
      price: { status: 'known', value: 2000 }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_DIRECTORY_CREATE_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')

  const optionsDirExists = await fs.stat(optionsDir).then(() => true).catch(() => false)
  assert.equal(optionsDirExists, false)
})

test('saveOption returns OPTIONS_STAGE_WRITE_FAILED when staging the canonical file fails', async () => {
  const userDataPath = await createTempDir('option-storage-save-stage-failure-')
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      async writeFile(filePath, ...args) {
        if (filePath.endsWith('.tmp')) {
          throw new Error('stage write failed')
        }

        return fs.writeFile(filePath, ...args)
      }
    })
  })

  const result = await storage.saveOption('washer', {
    evaluations: {
      brand: { status: 'known', value: 'LG' },
      price: { status: 'known', value: 2000 }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_STAGE_WRITE_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')

  const optionsDirExists = await fs.stat(path.join(userDataPath, 'options')).then(() => true).catch(() => false)
  assert.equal(optionsDirExists, true)
  const washerFileExists = await fs.stat(resolveOptionFilePath(path.join(userDataPath, 'options'), 'washer')).then(() => true).catch(() => false)
  assert.equal(washerFileExists, false)
})

test('saveOption returns OPTIONS_REPLACE_FAILED and restores the original file when the current replace target is mutated before failure', async () => {
  const userDataPath = await createTempDir('option-storage-save-replace-failure-')
  const washerFilePath = resolveOptionFilePath(path.join(userDataPath, 'options'), 'washer')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [{ id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }]
  })

  let replaceFailed = false
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      async rename(sourcePath, destinationPath) {
        if (!replaceFailed && sourcePath.endsWith('.tmp') && path.normalize(destinationPath) === path.normalize(washerFilePath)) {
          replaceFailed = true
          await fs.writeFile(destinationPath, '{"corrupted":true}\n')
          throw new Error('replace failed after mutating current target')
        }

        return fs.rename(sourcePath, destinationPath)
      }
    })
  })

  const result = await storage.saveOption('washer', {
    id: 'washer-1',
    evaluations: {
      brand: { status: 'known', value: 'LG Updated' },
      price: { status: 'known', value: 1100 }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_REPLACE_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')
  assert.equal(result.failure.optionId, 'washer-1')

  const washerDocument = await readOptionDocument(userDataPath, 'washer')
  assert.deepEqual(washerDocument.options, [
    { id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }
  ])
})

test('saveOption returns OPTIONS_REPLACE_FAILED and removes the canonical file when first-save replace cleanup is confirmed', async () => {
  const userDataPath = await createTempDir('option-storage-save-create-replace-failure-')
  const washerFilePath = resolveOptionFilePath(path.join(userDataPath, 'options'), 'washer')

  let replaceFailed = false
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    optionIdFactory: () => 'generated-id-1',
    fsApi: createFsProxy({
      async rename(sourcePath, destinationPath) {
        if (!replaceFailed && sourcePath.endsWith('.tmp') && path.normalize(destinationPath) === path.normalize(washerFilePath)) {
          replaceFailed = true
          await fs.writeFile(destinationPath, '{"partial":true}\n')
          throw new Error('replace failed after creating canonical target')
        }

        return fs.rename(sourcePath, destinationPath)
      }
    })
  })

  const result = await storage.saveOption('washer', {
    evaluations: {
      brand: { status: 'known', value: 'LG' },
      price: { status: 'known', value: 2000 }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_REPLACE_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')
  assert.equal(result.failure.optionId, 'generated-id-1')

  const washerFileExists = await fs.stat(washerFilePath).then(() => true).catch(() => false)
  assert.equal(washerFileExists, false)

  const directoryEntries = await fs.readdir(path.join(userDataPath, 'options'))
  assert.equal(directoryEntries.some((entry) => entry.endsWith('.tmp')), false)
  assert.equal(directoryEntries.some((entry) => entry.endsWith('.bak')), false)
})

test('saveOption preserves the canonical file when backup creation fails before any displacement', async () => {
  const userDataPath = await createTempDir('option-storage-save-pre-backup-failure-')
  const washerFilePath = resolveOptionFilePath(path.join(userDataPath, 'options'), 'washer')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [{ id: 'washer-1', extraTopLevelField: 'preserve-me', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      async rename(sourcePath, destinationPath) {
        if (path.normalize(sourcePath) === path.normalize(washerFilePath) && destinationPath.endsWith('.bak')) {
          const error = new Error('backup creation failed')
          error.code = 'EPERM'
          throw error
        }

        return fs.rename(sourcePath, destinationPath)
      }
    }),
    tempFileIdFactory: (() => {
      let index = 0
      return () => `tmp-${++index}`
    })()
  })

  const result = await storage.saveOption('washer', {
    id: 'washer-1',
    evaluations: {
      brand: { status: 'known', value: 'LG Updated' },
      price: { status: 'known', value: 1100 }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_REPLACE_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')
  assert.equal(result.failure.optionId, 'washer-1')

  const washerDocument = await readOptionDocument(userDataPath, 'washer')
  assert.deepEqual(washerDocument.options, [
    { id: 'washer-1', extraTopLevelField: 'preserve-me', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }
  ])

  const tmpFiles = await fs.readdir(path.join(userDataPath, 'options'))
  assert.equal(tmpFiles.some((entry) => entry.endsWith('.tmp')), false)
})

test('saveOption returns OPTIONS_ROLLBACK_FAILED when restoring the mutated current target cannot be confirmed', async () => {
  const userDataPath = await createTempDir('option-storage-save-rollback-failure-')
  const washerFilePath = resolveOptionFilePath(path.join(userDataPath, 'options'), 'washer')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [{ id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }]
  })

  let replaceFailed = false
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      async rename(sourcePath, destinationPath) {
        if (!replaceFailed && sourcePath.endsWith('.tmp') && path.normalize(destinationPath) === path.normalize(washerFilePath)) {
          replaceFailed = true
          await fs.writeFile(destinationPath, '{"corrupted":true}\n')
          throw new Error('replace failed after mutating current target')
        }

        if (replaceFailed && sourcePath.endsWith('.bak') && path.normalize(destinationPath) === path.normalize(washerFilePath)) {
          throw new Error('rollback restore failed')
        }

        return fs.rename(sourcePath, destinationPath)
      }
    })
  })

  const result = await storage.saveOption('washer', {
    id: 'washer-1',
    evaluations: {
      brand: { status: 'known', value: 'LG Updated' },
      price: { status: 'known', value: 1100 }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_ROLLBACK_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')
  assert.equal(result.failure.optionId, 'washer-1')

  const washerFileExists = await fs.stat(washerFilePath).then(() => true).catch(() => false)
  assert.equal(washerFileExists, false)
})

test('saveOption returns OPTIONS_ROLLBACK_FAILED when first-save replace cleanup cannot be confirmed', async () => {
  const userDataPath = await createTempDir('option-storage-save-create-rollback-failure-')
  const washerFilePath = resolveOptionFilePath(path.join(userDataPath, 'options'), 'washer')

  let replaceFailed = false
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    optionIdFactory: () => 'generated-id-1',
    fsApi: createFsProxy({
      async rename(sourcePath, destinationPath) {
        if (!replaceFailed && sourcePath.endsWith('.tmp') && path.normalize(destinationPath) === path.normalize(washerFilePath)) {
          replaceFailed = true
          await fs.writeFile(destinationPath, '{"partial":true}\n')
          throw new Error('replace failed after creating canonical target')
        }

        return fs.rename(sourcePath, destinationPath)
      },
      async unlink(filePath) {
        if (replaceFailed && path.normalize(filePath) === path.normalize(washerFilePath)) {
          throw new Error('cleanup failed')
        }

        return fs.unlink(filePath)
      }
    })
  })

  const result = await storage.saveOption('washer', {
    evaluations: {
      brand: { status: 'known', value: 'LG' },
      price: { status: 'known', value: 2000 }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_ROLLBACK_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')
  assert.equal(result.failure.optionId, 'generated-id-1')

  const persistedContents = await fs.readFile(washerFilePath, 'utf8')
  assert.equal(persistedContents, '{"partial":true}\n')
})

test('deleteOption returns OPTIONS_DIRECTORY_CREATE_FAILED before mutating files when commit setup cannot create the options directory', async () => {
  const userDataPath = await createTempDir('option-storage-delete-mkdir-failure-')
  const optionsDir = path.join(userDataPath, 'options')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [{ id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    }),
    fsApi: createFsProxy({
      async mkdir(targetPath) {
        if (path.normalize(targetPath) === path.normalize(optionsDir)) {
          throw new Error('mkdir failed')
        }

        return fs.mkdir(targetPath, { recursive: true })
      }
    })
  })

  const result = await storage.deleteOption('washer', 'washer-1')

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_DIRECTORY_CREATE_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')
  assert.equal(result.failure.optionId, 'washer-1')

  const washerDocument = await readOptionDocument(userDataPath, 'washer')
  assert.deepEqual(washerDocument.options.map((option) => option.id), ['washer-1'])
})

test('deleteOption returns OPTIONS_STAGE_WRITE_FAILED and leaves all canonical files unchanged when staging fails', async () => {
  const userDataPath = await createTempDir('option-storage-delete-stage-failure-')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [{ id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }]
  })
  await writeOptionDocument(userDataPath, 'laundry-set', {
    contractVersion: '1.0',
    appliance: 'laundry-set',
    options: [
      {
        id: 'set-1',
        evaluations: {
          brand: { status: 'known', value: 'Combo' },
          bundlePrice: { status: 'known', value: 5000 },
          washer: { status: 'known', value: 'washer-1' },
          dryer: { status: 'known', value: 'dryer-1' }
        }
      }
    ]
  })

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    }),
    fsApi: createFsProxy({
      async writeFile(filePath, ...args) {
        if (filePath.endsWith('.tmp')) {
          throw new Error('stage write failed')
        }

        return fs.writeFile(filePath, ...args)
      }
    })
  })

  const result = await storage.deleteOption('washer', 'washer-1')

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_STAGE_WRITE_FAILED)
  assert.equal(result.failure.applianceKey, 'washer')
  assert.equal(result.failure.optionId, 'washer-1')

  const washerDocument = await readOptionDocument(userDataPath, 'washer')
  const laundrySetDocument = await readOptionDocument(userDataPath, 'laundry-set')
  assert.deepEqual(washerDocument.options.map((option) => option.id), ['washer-1'])
  assert.equal(laundrySetDocument.options[0].evaluations.washer.value, 'washer-1')
})

test('deleteOption preserves on-disk state when the currently replacing dependent file is mutated before replace failure', async () => {
  const userDataPath = await createTempDir('option-storage-delete-rollback-')
  const laundrySetFilePath = resolveOptionFilePath(path.join(userDataPath, 'options'), 'laundry-set')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [{ id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }]
  })
  await writeOptionDocument(userDataPath, 'laundry-set', {
    contractVersion: '1.0',
    appliance: 'laundry-set',
    options: [
      {
        id: 'set-1',
        evaluations: {
          brand: { status: 'known', value: 'Combo' },
          bundlePrice: { status: 'known', value: 5000 },
          washer: { status: 'known', value: 'washer-1' },
          dryer: { status: 'known', value: 'dryer-1' }
        }
      }
    ]
  })

  let replaceFailed = false

  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    }),
    fsApi: createFsProxy({
      async rename(sourcePath, destinationPath) {
        if (!replaceFailed && sourcePath.endsWith('.tmp') && path.normalize(destinationPath) === path.normalize(laundrySetFilePath)) {
          replaceFailed = true
          await fs.writeFile(destinationPath, '{"corrupted":true}\n')
          throw new Error('replace failed after mutating current target')
        }

        return fs.rename(sourcePath, destinationPath)
      }
    }),
    tempFileIdFactory: (() => {
      let index = 0
      return () => `tmp-${++index}`
    })()
  })

  const result = await storage.deleteOption('washer', 'washer-1')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_REPLACE_FAILED)
  assert.equal(result.failure.applianceKey, 'laundry-set')
  assert.equal(result.failure.optionId, 'washer-1')

  const washerDocument = await readOptionDocument(userDataPath, 'washer')
  const laundrySetDocument = await readOptionDocument(userDataPath, 'laundry-set')

  assert.deepEqual(washerDocument.options.map((option) => option.id), ['washer-1'])
  assert.equal(laundrySetDocument.options[0].evaluations.washer.value, 'washer-1')
})

test('deleteOption returns OPTIONS_ROLLBACK_FAILED when restoring the currently replacing dependent file cannot be confirmed', async () => {
  const userDataPath = await createTempDir('option-storage-delete-rollback-failure-')
  const laundrySetFilePath = resolveOptionFilePath(path.join(userDataPath, 'options'), 'laundry-set')
  await writeOptionDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    options: [{ id: 'washer-1', evaluations: { brand: { status: 'known', value: 'LG' }, price: { status: 'known', value: 1000 } } }]
  })
  await writeOptionDocument(userDataPath, 'laundry-set', {
    contractVersion: '1.0',
    appliance: 'laundry-set',
    options: [
      {
        id: 'set-1',
        evaluations: {
          brand: { status: 'known', value: 'Combo' },
          bundlePrice: { status: 'known', value: 5000 },
          washer: { status: 'known', value: 'washer-1' },
          dryer: { status: 'known', value: 'dryer-1' }
        }
      }
    ]
  })

  let replaceFailed = false
  const storage = createOptionStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({
      washer: createSchema('washer'),
      dryer: createSchema('dryer'),
      'laundry-set': createSchema('laundry-set')
    }),
    fsApi: createFsProxy({
      async rename(sourcePath, destinationPath) {
        if (!replaceFailed && sourcePath.endsWith('.tmp') && path.normalize(destinationPath) === path.normalize(laundrySetFilePath)) {
          replaceFailed = true
          await fs.writeFile(destinationPath, '{"corrupted":true}\n')
          throw new Error('replace failed after mutating current target')
        }

        if (replaceFailed && sourcePath.endsWith('.bak') && path.normalize(destinationPath) === path.normalize(laundrySetFilePath)) {
          throw new Error('rollback restore failed')
        }

        return fs.rename(sourcePath, destinationPath)
      }
    }),
    tempFileIdFactory: (() => {
      let index = 0
      return () => `tmp-${++index}`
    })()
  })

  const result = await storage.deleteOption('washer', 'washer-1')

  assert.equal(result.ok, false)
  assert.equal(result.failure.code, OPTION_CODES.OPTIONS_ROLLBACK_FAILED)
  assert.equal(result.failure.applianceKey, 'laundry-set')
  assert.equal(result.failure.optionId, 'washer-1')

  const laundrySetFileExists = await fs.stat(laundrySetFilePath).then(() => true).catch(() => false)
  assert.equal(laundrySetFileExists, false)
})
