const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')

const {
  CANONICAL_APPLIANCE_KEYS,
  WARNING_FAILURE_CODES,
  createSchemaStorage,
  resolveShippedSchemasDir
} = require('../src/main/schemaStorage')

function createSchemaDocument(applianceKey, overrides = {}) {
  return {
    schemaVersion: '1.0',
    appliance: applianceKey,
    displayName: applianceKey === 'laundry-set' ? 'Laundry Set' : applianceKey[0].toUpperCase() + applianceKey.slice(1),
    dimensions: [],
    ...overrides
  }
}

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2))
}

async function writeShippedSchemas(shippedDir, overrides = {}) {
  await fs.mkdir(shippedDir, { recursive: true })

  for (const applianceKey of CANONICAL_APPLIANCE_KEYS) {
    await writeJson(
      path.join(shippedDir, `${applianceKey}.schema.json`),
      createSchemaDocument(applianceKey, overrides[applianceKey])
    )
  }

  await fs.mkdir(path.join(shippedDir, 'fixtures'), { recursive: true })
  await fs.writeFile(path.join(shippedDir, 'fixtures', 'washer.options.sample.json'), '{}')
  await fs.writeFile(path.join(shippedDir, 'README.md'), '# ignored')
}

test('bootstrap copies only missing schema files and ignores non-schema shipped assets', async () => {
  const workspaceDir = await createTempDir('schema-storage-bootstrap-')
  const userDataPath = path.join(workspaceDir, 'user-data')
  const shippedSchemasDir = path.join(workspaceDir, 'schemas')

  await writeShippedSchemas(shippedSchemasDir)

  const storage = createSchemaStorage({
    userDataPath,
    runtimeDir: path.join(workspaceDir, 'dist', 'main')
  })

  const result = await storage.listSchemas()
  assert.equal(result.warnings.length, 0)
  assert.deepEqual(
    result.schemas.map((schema) => schema.applianceKey),
    CANONICAL_APPLIANCE_KEYS
  )

  const localSchemasDir = path.join(userDataPath, 'schemas')
  const localEntries = (await fs.readdir(localSchemasDir)).sort()
  assert.deepEqual(localEntries, [
    'dryer.schema.json',
    'laundry-set.schema.json',
    'washer.schema.json'
  ])
})

test('bootstrap does not overwrite existing local schemas and leaves unrelated local files untouched', async () => {
  const workspaceDir = await createTempDir('schema-storage-existing-')
  const userDataPath = path.join(workspaceDir, 'user-data')
  const shippedSchemasDir = path.join(workspaceDir, 'schemas')
  const localSchemasDir = path.join(userDataPath, 'schemas')
  const washerPath = path.join(localSchemasDir, 'washer.schema.json')
  const notePath = path.join(localSchemasDir, 'notes.txt')
  const extraSchemaPath = path.join(localSchemasDir, 'custom.schema.json')

  await writeShippedSchemas(shippedSchemasDir, {
    washer: { displayName: 'Washer From Ship' }
  })
  await writeJson(washerPath, createSchemaDocument('washer', { displayName: 'Local Washer' }))
  await fs.writeFile(notePath, 'keep me')
  await writeJson(extraSchemaPath, createSchemaDocument('washer', { displayName: 'Extra Schema' }))

  const storage = createSchemaStorage({
    userDataPath,
    runtimeDir: path.join(workspaceDir, 'dist', 'main')
  })

  const result = await storage.listSchemas()
  assert.equal(result.warnings.length, 0)
  assert.equal(result.schemas[0].displayName, 'Local Washer')
  assert.equal(JSON.parse(await fs.readFile(washerPath, 'utf8')).displayName, 'Local Washer')
  assert.equal(await fs.readFile(notePath, 'utf8'), 'keep me')
  assert.equal(JSON.parse(await fs.readFile(extraSchemaPath, 'utf8')).displayName, 'Extra Schema')
  assert.deepEqual(
    result.schemas.map((schema) => schema.applianceKey),
    CANONICAL_APPLIANCE_KEYS
  )
})

test('listSchemas returns valid summaries plus deterministic warnings', async () => {
  const workspaceDir = await createTempDir('schema-storage-list-')
  const userDataPath = path.join(workspaceDir, 'user-data')
  const localSchemasDir = path.join(userDataPath, 'schemas')

  await writeJson(path.join(localSchemasDir, 'washer.schema.json'), createSchemaDocument('washer'))
  await writeJson(path.join(localSchemasDir, 'dryer.schema.json'), createSchemaDocument('dryer', { displayName: '' }))

  const storage = createSchemaStorage({
    userDataPath,
    runtimeDir: path.join(workspaceDir, 'dist', 'main')
  })

  const result = await storage.listSchemas()

  assert.deepEqual(result.schemas, [
    {
      applianceKey: 'washer',
      displayName: 'Washer',
      schemaVersion: '1.0'
    }
  ])
  assert.deepEqual(result.warnings, [
    {
      code: WARNING_FAILURE_CODES.SCHEMA_CONTRACT_INVALID,
      message: 'Schema could not be used.',
      applianceKey: 'dryer'
    },
    {
      code: WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING,
      message: 'Shipped schema source is unavailable.',
      applianceKey: 'laundry-set'
    }
  ])
})

test('existing local schemas remain available when shipped source is missing', async () => {
  const workspaceDir = await createTempDir('schema-storage-local-authority-')
  const userDataPath = path.join(workspaceDir, 'user-data')
  const localSchemasDir = path.join(userDataPath, 'schemas')

  await writeJson(path.join(localSchemasDir, 'washer.schema.json'), createSchemaDocument('washer'))

  const storage = createSchemaStorage({
    userDataPath,
    runtimeDir: path.join(workspaceDir, 'dist', 'main')
  })

  const listed = await storage.listSchemas()
  assert.deepEqual(listed.schemas, [
    {
      applianceKey: 'washer',
      displayName: 'Washer',
      schemaVersion: '1.0'
    }
  ])
  assert.deepEqual(
    listed.warnings.map((warning) => [warning.applianceKey, warning.code]),
    [
      ['dryer', WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING],
      ['laundry-set', WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING]
    ]
  )

  const loaded = await storage.loadSchema('washer')
  assert.equal(loaded.ok, true)
  assert.equal(loaded.failure, null)
  assert.deepEqual(loaded.warnings, [])
  assert.equal(loaded.schema.appliance, 'washer')
})

test('loadSchema succeeds after bootstrapping a missing local schema', async () => {
  const workspaceDir = await createTempDir('schema-storage-load-success-')
  const userDataPath = path.join(workspaceDir, 'user-data')
  const shippedSchemasDir = path.join(workspaceDir, 'schemas')

  await writeShippedSchemas(shippedSchemasDir)

  const storage = createSchemaStorage({
    userDataPath,
    runtimeDir: path.join(workspaceDir, 'dist', 'main')
  })

  const result = await storage.loadSchema('dryer')
  assert.equal(result.ok, true)
  assert.equal(result.failure, null)
  assert.deepEqual(result.warnings, [])
  assert.equal(result.schema.appliance, 'dryer')
  assert.equal(
    JSON.parse(await fs.readFile(path.join(userDataPath, 'schemas', 'dryer.schema.json'), 'utf8')).appliance,
    'dryer'
  )
})

test('shipped-source and bootstrap failures apply only to keys that still need bootstrap', async () => {
  const workspaceDir = await createTempDir('schema-storage-failures-')
  const userDataPath = path.join(workspaceDir, 'user-data')
  const localSchemasDir = path.join(userDataPath, 'schemas')

  await writeJson(path.join(localSchemasDir, 'washer.schema.json'), createSchemaDocument('washer'))

  const storage = createSchemaStorage({
    userDataPath,
    runtimeDir: path.join(workspaceDir, 'dist', 'main')
  })

  const listed = await storage.listSchemas()
  assert.deepEqual(
    listed.schemas.map((schema) => schema.applianceKey),
    ['washer']
  )
  assert.deepEqual(
    listed.warnings.map((warning) => [warning.applianceKey, warning.code]),
    [
      ['dryer', WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING],
      ['laundry-set', WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING]
    ]
  )

  const success = await storage.loadSchema('washer')
  assert.equal(success.ok, true)

  const failure = await storage.loadSchema('dryer')
  assert.equal(failure.ok, false)
  assert.equal(failure.failure.code, WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING)
  assert.equal(failure.failure.applianceKey, 'dryer')
  assert.deepEqual(failure.warnings, [])
})

test('schema directory creation failure returns structured results instead of rejecting', async () => {
  const workspaceDir = await createTempDir('schema-storage-mkdir-failure-')
  const userDataPath = path.join(workspaceDir, 'user-data')

  const storage = createSchemaStorage({
    userDataPath,
    runtimeDir: path.join(workspaceDir, 'dist', 'main'),
    fsApi: {
      access: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      mkdir: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      },
      copyFile: async () => {},
      readFile: async () => '{}'
    }
  })

  const listed = await storage.listSchemas()
  assert.deepEqual(
    listed.warnings.map((warning) => [warning.applianceKey, warning.code]),
    [
      ['washer', WARNING_FAILURE_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED],
      ['dryer', WARNING_FAILURE_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED],
      ['laundry-set', WARNING_FAILURE_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED]
    ]
  )
  assert.deepEqual(listed.schemas, [])

  const loaded = await storage.loadSchema('washer')
  assert.deepEqual(loaded, {
    ok: false,
    schema: null,
    warnings: [],
    failure: {
      code: WARNING_FAILURE_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED,
      message: 'Schema bootstrap copy failed.',
      applianceKey: 'washer'
    }
  })
})

test('existing unreadable local schema is treated as local source of truth and returns unreadable error', async () => {
  const workspaceDir = await createTempDir('schema-storage-unreadable-local-')
  const userDataPath = path.join(workspaceDir, 'user-data')

  const storage = createSchemaStorage({
    userDataPath,
    runtimeDir: path.join(workspaceDir, 'dist', 'main'),
    fsApi: {
      access: async (targetPath) => {
        if (targetPath.endsWith(path.join('user-data', 'schemas', 'washer.schema.json'))) {
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
        }

        if (targetPath.endsWith(path.join('schemas', 'dryer.schema.json')) || targetPath.endsWith(path.join('schemas', 'laundry-set.schema.json'))) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }

        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      mkdir: async () => {},
      copyFile: async () => {
        throw new Error('copy should not run when shipped schema is missing')
      },
      readFile: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
    }
  })

  const listed = await storage.listSchemas()
  assert.deepEqual(listed.schemas, [])
  assert.deepEqual(listed.warnings[0], {
    code: WARNING_FAILURE_CODES.SCHEMA_FILE_UNREADABLE,
    message: 'Schema file could not be read.',
    applianceKey: 'washer'
  })
  assert.deepEqual(
    listed.warnings.slice(1).map((warning) => [warning.applianceKey, warning.code]),
    [
      ['dryer', WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING],
      ['laundry-set', WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING]
    ]
  )

  const loaded = await storage.loadSchema('washer')
  assert.deepEqual(loaded, {
    ok: false,
    schema: null,
    warnings: [],
    failure: {
      code: WARNING_FAILURE_CODES.SCHEMA_FILE_UNREADABLE,
      message: 'Schema file could not be read.',
      applianceKey: 'washer'
    }
  })
})

test('loadSchema returns structured failures for invalid schema outcomes', async () => {
  const workspaceDir = await createTempDir('schema-storage-invalid-')
  const userDataPath = path.join(workspaceDir, 'user-data')
  const localSchemasDir = path.join(userDataPath, 'schemas')

  const storage = createSchemaStorage({
    userDataPath,
    runtimeDir: path.join(workspaceDir, 'dist', 'main')
  })

  const cases = [
    {
      name: 'unknown appliance key',
      applianceKey: 'dishwasher',
      expectedCode: WARNING_FAILURE_CODES.UNKNOWN_APPLIANCE_KEY,
      setup: async () => {}
    },
    {
      name: 'invalid JSON',
      applianceKey: 'washer',
      expectedCode: WARNING_FAILURE_CODES.SCHEMA_JSON_PARSE_FAILED,
      setup: async () => {
        await fs.mkdir(localSchemasDir, { recursive: true })
        await fs.writeFile(path.join(localSchemasDir, 'washer.schema.json'), '{not-json')
      }
    },
    {
      name: 'parseable non-object root',
      applianceKey: 'washer',
      expectedCode: WARNING_FAILURE_CODES.SCHEMA_CONTRACT_INVALID,
      setup: async () => {
        await writeJson(path.join(localSchemasDir, 'washer.schema.json'), [])
      }
    },
    {
      name: 'missing local after bootstrap attempt',
      applianceKey: 'washer',
      expectedCode: WARNING_FAILURE_CODES.LOCAL_SCHEMA_NOT_FOUND,
      setup: async () => {
        await writeJson(path.join(localSchemasDir, 'washer.schema.json'), createSchemaDocument('washer'))
        await fs.rm(path.join(localSchemasDir, 'washer.schema.json'))
      },
      injectedFs: {
        access: async (targetPath) => {
          if (targetPath.endsWith('washer.schema.json')) {
            return undefined
          }

          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
        mkdir: async () => {},
        copyFile: async () => {},
        readFile: async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
      }
    },
    {
      name: 'missing required fields',
      applianceKey: 'washer',
      expectedCode: WARNING_FAILURE_CODES.SCHEMA_CONTRACT_INVALID,
      setup: async () => {
        await writeJson(path.join(localSchemasDir, 'washer.schema.json'), {
          schemaVersion: '1.0',
          appliance: 'washer',
          dimensions: []
        })
      }
    },
    {
      name: 'appliance mismatch',
      applianceKey: 'washer',
      expectedCode: WARNING_FAILURE_CODES.SCHEMA_APPLIANCE_KEY_MISMATCH,
      setup: async () => {
        await writeJson(path.join(localSchemasDir, 'washer.schema.json'), createSchemaDocument('dryer'))
      }
    },
    {
      name: 'unreadable file',
      applianceKey: 'washer',
      expectedCode: WARNING_FAILURE_CODES.SCHEMA_FILE_UNREADABLE,
      setup: async () => {
        await writeJson(path.join(localSchemasDir, 'washer.schema.json'), createSchemaDocument('washer'))
      },
      injectedFs: {
        access: async () => undefined,
        mkdir: async () => {},
        copyFile: async () => {},
        readFile: async () => {
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
        }
      }
    },
    {
      name: 'bootstrap copy failed',
      applianceKey: 'washer',
      expectedCode: WARNING_FAILURE_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED,
      setup: async () => {},
      injectedFs: {
        access: async (targetPath) => {
          if (targetPath.includes(path.join('schemas', 'washer.schema.json')) && !targetPath.includes(path.join('user-data', 'schemas'))) {
            return undefined
          }

          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
        mkdir: async () => {},
        copyFile: async () => {
          throw new Error('copy failed')
        },
        readFile: async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
      }
    }
  ]

  for (const testCase of cases) {
    await fs.rm(localSchemasDir, { recursive: true, force: true })
    await testCase.setup()

    const caseStorage = testCase.injectedFs
      ? createSchemaStorage({
          userDataPath,
          runtimeDir: path.join(workspaceDir, 'dist', 'main'),
          fsApi: testCase.injectedFs
        })
      : storage

    const result = await caseStorage.loadSchema(testCase.applianceKey)
    assert.equal(result.ok, false, testCase.name)
    assert.deepEqual(result.warnings, [], testCase.name)
    assert.equal(result.failure.code, testCase.expectedCode, testCase.name)
    assert.equal(
      result.failure.applianceKey,
      testCase.applianceKey,
      `${testCase.name} applianceKey`
    )
    assert.equal(result.schema, null, testCase.name)
  }
})

test('runtime path resolution supports built dev output and packaged resources', () => {
  const devPath = resolveShippedSchemasDir({
    runtimeDir: path.join('E:', 'repo', 'dist', 'main')
  })
  const packagedPath = resolveShippedSchemasDir({
    isPackaged: true,
    resourcesPath: path.join('C:', 'Program Files', 'ApplianceResearchTool', 'resources')
  })

  assert.equal(devPath, path.join('E:', 'repo', 'schemas'))
  assert.equal(
    packagedPath,
    path.join('C:', 'Program Files', 'ApplianceResearchTool', 'resources', 'schemas')
  )
})
