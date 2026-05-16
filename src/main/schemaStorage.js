const fs = require('fs/promises')
const path = require('path')

const CANONICAL_APPLIANCE_KEYS = Object.freeze(['washer', 'dryer', 'laundry-set'])

const WARNING_FAILURE_CODES = Object.freeze({
  UNKNOWN_APPLIANCE_KEY: 'UNKNOWN_APPLIANCE_KEY',
  SHIPPED_SCHEMA_SOURCE_MISSING: 'SHIPPED_SCHEMA_SOURCE_MISSING',
  SCHEMA_BOOTSTRAP_COPY_FAILED: 'SCHEMA_BOOTSTRAP_COPY_FAILED',
  LOCAL_SCHEMA_NOT_FOUND: 'LOCAL_SCHEMA_NOT_FOUND',
  SCHEMA_FILE_UNREADABLE: 'SCHEMA_FILE_UNREADABLE',
  SCHEMA_JSON_PARSE_FAILED: 'SCHEMA_JSON_PARSE_FAILED',
  SCHEMA_CONTRACT_INVALID: 'SCHEMA_CONTRACT_INVALID',
  SCHEMA_APPLIANCE_KEY_MISMATCH: 'SCHEMA_APPLIANCE_KEY_MISMATCH'
})

const WARNING_FAILURE_MESSAGES = Object.freeze({
  [WARNING_FAILURE_CODES.UNKNOWN_APPLIANCE_KEY]: 'Requested Appliance is not supported.',
  [WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING]: 'Shipped schema source is unavailable.',
  [WARNING_FAILURE_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED]: 'Schema bootstrap copy failed.',
  [WARNING_FAILURE_CODES.LOCAL_SCHEMA_NOT_FOUND]: 'Schema file was not found in the active profile.',
  [WARNING_FAILURE_CODES.SCHEMA_FILE_UNREADABLE]: 'Schema file could not be read.',
  [WARNING_FAILURE_CODES.SCHEMA_JSON_PARSE_FAILED]: 'Schema JSON could not be parsed.',
  [WARNING_FAILURE_CODES.SCHEMA_CONTRACT_INVALID]: 'Schema could not be used.',
  [WARNING_FAILURE_CODES.SCHEMA_APPLIANCE_KEY_MISMATCH]: 'Schema Appliance does not match the requested key.'
})

function createIssue(code, applianceKey) {
  return {
    code,
    message: WARNING_FAILURE_MESSAGES[code],
    applianceKey
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resolveRepoRoot(runtimeDir = __dirname, pathApi = path) {
  return pathApi.resolve(runtimeDir, '../..')
}

function resolveShippedSchemasDir({
  isPackaged = false,
  resourcesPath = process.resourcesPath,
  runtimeDir = __dirname,
  pathApi = path
} = {}) {
  if (isPackaged) {
    return pathApi.join(resourcesPath, 'schemas')
  }

  return pathApi.join(resolveRepoRoot(runtimeDir, pathApi), 'schemas')
}

function resolveLocalSchemasDir(userDataPath, pathApi = path) {
  return pathApi.join(userDataPath, 'schemas')
}

function resolveSchemaFilePath(directoryPath, applianceKey, pathApi = path) {
  return pathApi.join(directoryPath, `${applianceKey}.schema.json`)
}

async function pathExists(fsApi, targetPath) {
  try {
    await fsApi.access(targetPath)
    return { exists: true }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false }
    }

    return {
      exists: true,
      accessError: error
    }
  }
}

function validateSchemaContract(schema, applianceKey) {
  if (!isObjectRecord(schema)) {
    return createIssue(WARNING_FAILURE_CODES.SCHEMA_CONTRACT_INVALID, applianceKey)
  }

  if (!isNonEmptyString(schema.appliance) || !CANONICAL_APPLIANCE_KEYS.includes(schema.appliance)) {
    return createIssue(WARNING_FAILURE_CODES.SCHEMA_CONTRACT_INVALID, applianceKey)
  }

  if (schema.appliance !== applianceKey) {
    return createIssue(WARNING_FAILURE_CODES.SCHEMA_APPLIANCE_KEY_MISMATCH, applianceKey)
  }

  if (!isNonEmptyString(schema.displayName)) {
    return createIssue(WARNING_FAILURE_CODES.SCHEMA_CONTRACT_INVALID, applianceKey)
  }

  if (!isNonEmptyString(schema.schemaVersion)) {
    return createIssue(WARNING_FAILURE_CODES.SCHEMA_CONTRACT_INVALID, applianceKey)
  }

  if (!Array.isArray(schema.dimensions)) {
    return createIssue(WARNING_FAILURE_CODES.SCHEMA_CONTRACT_INVALID, applianceKey)
  }

  return null
}

function createSchemaStorage({
  userDataPath,
  isPackaged = false,
  resourcesPath = process.resourcesPath,
  runtimeDir = __dirname,
  fsApi = fs,
  pathApi = path
}) {
  if (!isNonEmptyString(userDataPath)) {
    throw new Error('userDataPath is required to create schema storage')
  }

  const localSchemasDir = resolveLocalSchemasDir(userDataPath, pathApi)
  const shippedSchemasDir = resolveShippedSchemasDir({
    isPackaged,
    resourcesPath,
    runtimeDir,
    pathApi
  })

  async function ensureLocalSchema(applianceKey) {
    const localSchemaPath = resolveSchemaFilePath(localSchemasDir, applianceKey, pathApi)
    const localSchemaStatus = await pathExists(fsApi, localSchemaPath)

    if (localSchemaStatus.exists) {
      return { ok: true, schemaPath: localSchemaPath }
    }

    try {
      await fsApi.mkdir(localSchemasDir, { recursive: true })
    } catch {
      return {
        ok: false,
        issue: createIssue(WARNING_FAILURE_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED, applianceKey)
      }
    }

    const shippedSchemaPath = resolveSchemaFilePath(shippedSchemasDir, applianceKey, pathApi)
    const shippedSchemaStatus = await pathExists(fsApi, shippedSchemaPath)

    if (!shippedSchemaStatus.exists) {
      return {
        ok: false,
        issue: createIssue(WARNING_FAILURE_CODES.SHIPPED_SCHEMA_SOURCE_MISSING, applianceKey)
      }
    }

    try {
      await fsApi.copyFile(shippedSchemaPath, localSchemaPath)
    } catch {
      return {
        ok: false,
        issue: createIssue(WARNING_FAILURE_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED, applianceKey)
      }
    }

    if (!(await pathExists(fsApi, localSchemaPath)).exists) {
      return {
        ok: false,
        issue: createIssue(WARNING_FAILURE_CODES.LOCAL_SCHEMA_NOT_FOUND, applianceKey)
      }
    }

    return { ok: true, schemaPath: localSchemaPath }
  }

  async function readSchemaFile(schemaPath, applianceKey) {
    let rawSchema

    try {
      rawSchema = await fsApi.readFile(schemaPath, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return {
          ok: false,
          issue: createIssue(WARNING_FAILURE_CODES.LOCAL_SCHEMA_NOT_FOUND, applianceKey)
        }
      }

      return {
        ok: false,
        issue: createIssue(WARNING_FAILURE_CODES.SCHEMA_FILE_UNREADABLE, applianceKey)
      }
    }

    let parsedSchema
    try {
      parsedSchema = JSON.parse(rawSchema)
    } catch {
      return {
        ok: false,
        issue: createIssue(WARNING_FAILURE_CODES.SCHEMA_JSON_PARSE_FAILED, applianceKey)
      }
    }

    const validationIssue = validateSchemaContract(parsedSchema, applianceKey)
    if (validationIssue) {
      return { ok: false, issue: validationIssue }
    }

    return { ok: true, schema: parsedSchema }
  }

  async function listSchemas() {
    const schemas = []
    const warnings = []

    for (const applianceKey of CANONICAL_APPLIANCE_KEYS) {
      const localSchemaResult = await ensureLocalSchema(applianceKey)
      if (!localSchemaResult.ok) {
        warnings.push(localSchemaResult.issue)
        continue
      }

      const schemaResult = await readSchemaFile(localSchemaResult.schemaPath, applianceKey)
      if (!schemaResult.ok) {
        warnings.push(schemaResult.issue)
        continue
      }

      schemas.push({
        applianceKey,
        displayName: schemaResult.schema.displayName,
        schemaVersion: schemaResult.schema.schemaVersion
      })
    }

    return { schemas, warnings }
  }

  async function loadSchema(applianceKey) {
    if (!CANONICAL_APPLIANCE_KEYS.includes(applianceKey)) {
      return {
        ok: false,
        schema: null,
        warnings: [],
        failure: createIssue(WARNING_FAILURE_CODES.UNKNOWN_APPLIANCE_KEY, applianceKey)
      }
    }

    const localSchemaResult = await ensureLocalSchema(applianceKey)
    if (!localSchemaResult.ok) {
      return {
        ok: false,
        schema: null,
        warnings: [],
        failure: localSchemaResult.issue
      }
    }

    const schemaResult = await readSchemaFile(localSchemaResult.schemaPath, applianceKey)
    if (!schemaResult.ok) {
      return {
        ok: false,
        schema: null,
        warnings: [],
        failure: schemaResult.issue
      }
    }

    return {
      ok: true,
      schema: schemaResult.schema,
      warnings: [],
      failure: null
    }
  }

  return {
    listSchemas,
    loadSchema,
    paths: {
      localSchemasDir,
      shippedSchemasDir
    }
  }
}

module.exports = {
  CANONICAL_APPLIANCE_KEYS,
  WARNING_FAILURE_CODES,
  createSchemaStorage,
  resolveLocalSchemasDir,
  resolveRepoRoot,
  resolveSchemaFilePath,
  resolveShippedSchemasDir
}
