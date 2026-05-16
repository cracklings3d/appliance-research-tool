const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')

const {
  PRESET_CODES,
  createPresetStorage,
  resolvePresetFilePath
} = require('../src/main/presetStorage')

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function createSchema(applianceKey, dimensionIds = ['price', 'capacityKg', 'brand']) {
  return {
    appliance: applianceKey,
    dimensions: dimensionIds.map((id) => ({ id }))
  }
}

function createSchemaStorageMock(schemas = {}, failures = {}) {
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

async function writePresetDocument(userDataPath, applianceKey, document) {
  const presetDir = path.join(userDataPath, 'comparison-presets')
  await fs.mkdir(presetDir, { recursive: true })
  await fs.writeFile(resolvePresetFilePath(presetDir, applianceKey), `${JSON.stringify(document, null, 2)}\n`)
}

async function readPresetDocument(userDataPath, applianceKey) {
  const contents = await fs.readFile(resolvePresetFilePath(path.join(userDataPath, 'comparison-presets'), applianceKey), 'utf8')
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

test('loadPresets returns first-run success without creating storage', async () => {
  const userDataPath = await createTempDir('preset-storage-load-missing-')
  const storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  const result = await storage.loadPresets('washer')
  assert.deepEqual(result, {
    ok: true,
    presets: [],
    warnings: [],
    failure: null
  })

  await assert.rejects(
    fs.access(path.join(userDataPath, 'comparison-presets')),
    (error) => error && error.code === 'ENOENT'
  )
})

test('loadPresets maps persisted file failures and ignores extra fields', async () => {
  const userDataPath = await createTempDir('preset-storage-load-failures-')
  const storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: '2.0',
    appliance: 'washer',
    presets: []
  })
  let result = await storage.loadPresets('washer')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_CONTRACT_INVALID)

  await fs.writeFile(resolvePresetFilePath(path.join(userDataPath, 'comparison-presets'), 'washer'), '{bad json')
  result = await storage.loadPresets('washer')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_JSON_PARSE_FAILED)

  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    extra: true,
    presets: [
      {
        id: 'preset-1',
        name: 'Saved preset',
        applianceKey: 'washer',
        dimensionKeys: ['price'],
        ignored: 'field'
      }
    ]
  })

  result = await storage.loadPresets('washer')
  assert.deepEqual(result, {
    ok: true,
    presets: [
      {
        id: 'preset-1',
        name: 'Saved preset',
        applianceKey: 'washer',
        dimensionKeys: ['price'],
        effectiveDimensionKeys: ['price']
      }
    ],
    warnings: [],
    failure: null
  })
})

test('stored preset names must already be trimmed across load, save, and delete', async () => {
  const userDataPath = await createTempDir('preset-storage-trimmed-name-contract-')
  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    presets: [
      {
        id: 'preset-1',
        name: '  My preset  ',
        applianceKey: 'washer',
        dimensionKeys: ['price']
      }
    ]
  })

  const storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  let result = await storage.loadPresets('washer')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_CONTRACT_INVALID)

  result = await storage.savePreset('washer', {
    name: 'Replacement preset',
    dimensionKeys: ['price']
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_CONTRACT_INVALID)
  assert.deepEqual(result.validationErrors, [])

  result = await storage.deletePreset('washer', 'preset-1')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_CONTRACT_INVALID)
})

test('loadPresets reuses schema failures and schema dependency gate', async () => {
  const schemaFailure = {
    code: PRESET_CODES.SCHEMA_FILE_UNREADABLE,
    message: 'Schema file could not be read.',
    applianceKey: 'washer'
  }

  const userDataPath = await createTempDir('preset-storage-schema-failure-')
  const failureStorage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({}, { washer: schemaFailure })
  })

  let result = await failureStorage.loadPresets('washer')
  assert.equal(result.ok, false)
  assert.deepEqual(result.failure, {
    code: PRESET_CODES.SCHEMA_FILE_UNREADABLE,
    message: 'Schema file could not be read.',
    applianceKey: 'washer',
    presetId: null,
    dimensionKey: null
  })

  const dependencyStorage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: { appliance: 'washer', dimensions: [{ id: 'price' }, { id: 'price' }] } })
  })

  result = await dependencyStorage.loadPresets('washer')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.SCHEMA_CONTRACT_INVALID)
})

test('loadPresets derives effectiveDimensionKeys and missing dimension warnings without rewriting storage', async () => {
  const userDataPath = await createTempDir('preset-storage-load-derived-')
  const storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer', ['price', 'brand']) })
  })

  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    presets: [
      {
        id: 'preset-1',
        name: 'Preset One',
        applianceKey: 'washer',
        dimensionKeys: ['price', 'missing-a', 'brand']
      },
      {
        id: 'preset-2',
        name: 'Preset Two',
        applianceKey: 'washer',
        dimensionKeys: ['missing-b']
      }
    ]
  })

  const before = await readPresetDocument(userDataPath, 'washer')
  const result = await storage.loadPresets('washer')
  const after = await readPresetDocument(userDataPath, 'washer')

  assert.equal(result.ok, true)
  assert.deepEqual(result.presets, [
    {
      id: 'preset-1',
      name: 'Preset One',
      applianceKey: 'washer',
      dimensionKeys: ['price', 'missing-a', 'brand'],
      effectiveDimensionKeys: ['price', 'brand']
    },
    {
      id: 'preset-2',
      name: 'Preset Two',
      applianceKey: 'washer',
      dimensionKeys: ['missing-b'],
      effectiveDimensionKeys: []
    }
  ])
  assert.deepEqual(result.warnings.map((warning) => [warning.code, warning.presetId, warning.dimensionKey]), [
    [PRESET_CODES.PRESET_DIMENSION_MISSING, 'preset-1', 'missing-a'],
    [PRESET_CODES.PRESET_DIMENSION_MISSING, 'preset-2', 'missing-b']
  ])
  assert.deepEqual(after, before)
})

test('savePreset creates files, trims name, strips extra fields, appends creates, and preserves update position', async () => {
  const userDataPath = await createTempDir('preset-storage-save-success-')
  const storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    presetIdFactory: (() => {
      let nextId = 0
      return () => `preset-${++nextId}`
    })(),
    tempFileIdFactory: (() => {
      let nextId = 0
      return () => `tmp-${++nextId}`
    })()
  })

  let result = await storage.savePreset('washer', {
    name: '  My preset  ',
    dimensionKeys: ['price', 'capacityKg'],
    ignored: true
  })

  assert.deepEqual(result, {
    ok: true,
    preset: {
      id: 'preset-1',
      name: 'My preset',
      applianceKey: 'washer',
      dimensionKeys: ['price', 'capacityKg'],
      effectiveDimensionKeys: ['price', 'capacityKg']
    },
    warnings: [],
    validationErrors: [],
    failure: null
  })

  await storage.savePreset('washer', {
    name: 'Second preset',
    dimensionKeys: []
  })

  result = await storage.savePreset('washer', {
    id: 'preset-1',
    applianceKey: 'washer',
    name: ' Updated preset ',
    dimensionKeys: ['brand'],
    extra: 'ignored'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.preset, {
    id: 'preset-1',
    name: 'Updated preset',
    applianceKey: 'washer',
    dimensionKeys: ['brand'],
    effectiveDimensionKeys: ['brand']
  })

  const persisted = await readPresetDocument(userDataPath, 'washer')
  assert.deepEqual(persisted, {
    contractVersion: '1.0',
    appliance: 'washer',
    presets: [
      {
        id: 'preset-1',
        name: 'Updated preset',
        applianceKey: 'washer',
        dimensionKeys: ['brand']
      },
      {
        id: 'preset-2',
        name: 'Second preset',
        applianceKey: 'washer',
        dimensionKeys: []
      }
    ]
  })
})

test('savePreset returns contract-shaped validation errors per approved precedence', async () => {
  const userDataPath = await createTempDir('preset-storage-save-validation-')
  const storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer', ['price']) })
  })

  let result = await storage.savePreset('invalid-key', { name: 'Preset', dimensionKeys: [] })
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.UNKNOWN_APPLIANCE_KEY)
  assert.equal(result.failure.applianceKey, 'invalid-key')

  result = await storage.savePreset('washer', null)
  assert.deepEqual(result.validationErrors.map((error) => error.code), [
    PRESET_CODES.INVALID_PRESET_NAME,
    PRESET_CODES.INVALID_DIMENSION_KEYS
  ])

  result = await storage.savePreset('washer', {
    id: 'missing-id',
    applianceKey: 'dryer',
    name: '   ',
    dimensionKeys: [' ', 'price', 'price', 'missing']
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure, null)
  assert.deepEqual(result.validationErrors.map((error) => [error.code, error.presetId, error.dimensionKey]), [
    [PRESET_CODES.UNKNOWN_PRESET_ID, 'missing-id', null],
    [PRESET_CODES.PRESET_APPLIANCE_KEY_MISMATCH, 'missing-id', null],
    [PRESET_CODES.INVALID_PRESET_NAME, 'missing-id', null],
    [PRESET_CODES.INVALID_DIMENSION_KEYS, 'missing-id', ' '],
    [PRESET_CODES.DUPLICATE_DIMENSION_KEY, 'missing-id', 'price'],
    [PRESET_CODES.UNKNOWN_DIMENSION_KEY, 'missing-id', 'missing']
  ])

  await assert.rejects(
    fs.access(path.join(userDataPath, 'comparison-presets')),
    (error) => error && error.code === 'ENOENT'
  )
})

test('top-level schema and preset file failures win before save validation', async () => {
  const userDataPath = await createTempDir('preset-storage-save-precedence-')
  const schemaFailureStorage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({}, {
      washer: {
        code: PRESET_CODES.LOCAL_SCHEMA_NOT_FOUND,
        message: 'Schema file was not found in the active profile.',
        applianceKey: 'washer'
      }
    })
  })

  let result = await schemaFailureStorage.savePreset('washer', { name: '', dimensionKeys: 'bad' })
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.LOCAL_SCHEMA_NOT_FOUND)
  assert.deepEqual(result.validationErrors, [])

  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: 'bad',
    appliance: 'washer',
    presets: []
  })

  const storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })

  result = await storage.savePreset('washer', { name: '', dimensionKeys: 'bad' })
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_CONTRACT_INVALID)
  assert.deepEqual(result.validationErrors, [])
})

test('savePreset maps expected mutation failures to PRESETS_FILE_UNREADABLE', async () => {
  const userDataPath = await createTempDir('preset-storage-save-mutation-failure-')
  const storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      mkdir: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
    })
  })

  const result = await storage.savePreset('washer', { name: 'Preset', dimensionKeys: [] })
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_FILE_UNREADABLE)
})

test('savePreset maps staged write, replace, and rollback failures to PRESETS_FILE_UNREADABLE', async () => {
  const userDataPath = await createTempDir('preset-storage-save-mutation-paths-')

  let storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      writeFile: async (targetPath, contents) => {
        if (targetPath.endsWith('.tmp')) {
          throw Object.assign(new Error('staged write failed'), { code: 'EACCES' })
        }

        return fs.writeFile(targetPath, contents)
      }
    }),
    tempFileIdFactory: (() => {
      let nextId = 0
      return () => `tmp-${++nextId}`
    })()
  })

  let result = await storage.savePreset('washer', { name: 'Preset', dimensionKeys: [] })
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_FILE_UNREADABLE)

  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    presets: [{ id: 'preset-1', name: 'Preset', applianceKey: 'washer', dimensionKeys: [] }]
  })

  storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      rename: async (fromPath, toPath) => {
        if (fromPath.endsWith('.tmp') && toPath.endsWith('washer.comparison-presets.json')) {
          throw Object.assign(new Error('replace failed'), { code: 'EACCES' })
        }

        return fs.rename(fromPath, toPath)
      }
    }),
    tempFileIdFactory: (() => {
      let nextId = 0
      return () => `tmp-${++nextId}`
    })()
  })

  result = await storage.savePreset('washer', {
    id: 'preset-1',
    name: 'Updated preset',
    dimensionKeys: []
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_FILE_UNREADABLE)

  storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      rename: async (fromPath, toPath) => {
        if (toPath.endsWith('.bak')) {
          return fs.rename(fromPath, toPath)
        }

        if (fromPath.endsWith('.tmp') && toPath.endsWith('washer.comparison-presets.json')) {
          throw Object.assign(new Error('replace failed'), { code: 'EACCES' })
        }

        if (fromPath.endsWith('.bak') && toPath.endsWith('washer.comparison-presets.json')) {
          throw Object.assign(new Error('rollback failed'), { code: 'EACCES' })
        }

        return fs.rename(fromPath, toPath)
      }
    }),
    tempFileIdFactory: (() => {
      let nextId = 0
      return () => `tmp-${++nextId}`
    })()
  })

  result = await storage.savePreset('washer', {
    id: 'preset-1',
    name: 'Updated again',
    dimensionKeys: []
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_FILE_UNREADABLE)
})

test('deletePreset stays schema-independent and respects missing/invalid target semantics', async () => {
  const userDataPath = await createTempDir('preset-storage-delete-semantics-')
  const storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({}, {
      washer: {
        code: PRESET_CODES.SCHEMA_FILE_UNREADABLE,
        message: 'Schema file could not be read.',
        applianceKey: 'washer'
      }
    }),
    tempFileIdFactory: (() => {
      let nextId = 0
      return () => `tmp-${++nextId}`
    })()
  })

  let result = await storage.deletePreset('washer', null)
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESET_NOT_FOUND)
  assert.equal(result.failure.presetId, null)

  result = await storage.deletePreset('washer', '   ')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESET_NOT_FOUND)
  assert.equal(result.failure.presetId, '   ')

  result = await storage.deletePreset('washer', 'missing')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESET_NOT_FOUND)

  await assert.rejects(
    fs.access(path.join(userDataPath, 'comparison-presets')),
    (error) => error && error.code === 'ENOENT'
  )

  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    presets: [
      {
        id: 'preset-1',
        name: 'Preset one',
        applianceKey: 'washer',
        dimensionKeys: ['price']
      },
      {
        id: 'preset-2',
        name: 'Preset two',
        applianceKey: 'washer',
        dimensionKeys: []
      }
    ]
  })

  result = await storage.deletePreset('washer', 'preset-1')
  assert.deepEqual(result, {
    ok: true,
    deletedPresetId: 'preset-1',
    warnings: [],
    failure: null
  })

  let persisted = await readPresetDocument(userDataPath, 'washer')
  assert.deepEqual(persisted.presets.map((preset) => preset.id), ['preset-2'])

  result = await storage.deletePreset('washer', 'preset-2')
  assert.equal(result.ok, true)
  persisted = await readPresetDocument(userDataPath, 'washer')
  assert.deepEqual(persisted, {
    contractVersion: '1.0',
    appliance: 'washer',
    presets: []
  })
})

test('deletePreset maps read and mutation failures into approved contract codes', async () => {
  const userDataPath = await createTempDir('preset-storage-delete-failures-')
  const presetDir = path.join(userDataPath, 'comparison-presets')

  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    presets: [{ id: 'preset-1', name: 'Preset', applianceKey: 'washer', dimensionKeys: [] }]
  })

  let storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      readFile: async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      }
    })
  })

  let result = await storage.deletePreset('washer', 'preset-1')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_FILE_UNREADABLE)

  await fs.writeFile(resolvePresetFilePath(presetDir, 'washer'), '{bad json')
  storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') })
  })
  result = await storage.deletePreset('washer', 'preset-1')
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_JSON_PARSE_FAILED)

  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: 'bad',
    appliance: 'washer',
    presets: []
  })
  result = await storage.deletePreset('washer', 'preset-1')
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_CONTRACT_INVALID)

  await writePresetDocument(userDataPath, 'washer', {
    contractVersion: '1.0',
    appliance: 'washer',
    presets: [{ id: 'preset-1', name: 'Preset', applianceKey: 'washer', dimensionKeys: [] }]
  })
  storage = createPresetStorage({
    userDataPath,
    schemaStorage: createSchemaStorageMock({ washer: createSchema('washer') }),
    fsApi: createFsProxy({
      rename: async (fromPath, toPath) => {
        if (fromPath.endsWith('.tmp')) {
          throw Object.assign(new Error('rename failed'), { code: 'EACCES' })
        }

        return fs.rename(fromPath, toPath)
      }
    }),
    tempFileIdFactory: (() => {
      let nextId = 0
      return () => `tmp-${++nextId}`
    })()
  })

  result = await storage.deletePreset('washer', 'preset-1')
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, PRESET_CODES.PRESETS_FILE_UNREADABLE)
})
