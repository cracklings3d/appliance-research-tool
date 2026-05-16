const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const { CANONICAL_APPLIANCE_KEYS, WARNING_FAILURE_CODES } = require('./schemaStorage')

const PRESET_CODES = Object.freeze({
  ...WARNING_FAILURE_CODES,
  PRESETS_FILE_UNREADABLE: 'PRESETS_FILE_UNREADABLE',
  PRESETS_JSON_PARSE_FAILED: 'PRESETS_JSON_PARSE_FAILED',
  PRESETS_CONTRACT_INVALID: 'PRESETS_CONTRACT_INVALID',
  PRESET_NOT_FOUND: 'PRESET_NOT_FOUND',
  UNKNOWN_PRESET_ID: 'UNKNOWN_PRESET_ID',
  PRESET_APPLIANCE_KEY_MISMATCH: 'PRESET_APPLIANCE_KEY_MISMATCH',
  INVALID_PRESET_NAME: 'INVALID_PRESET_NAME',
  INVALID_DIMENSION_KEYS: 'INVALID_DIMENSION_KEYS',
  DUPLICATE_DIMENSION_KEY: 'DUPLICATE_DIMENSION_KEY',
  UNKNOWN_DIMENSION_KEY: 'UNKNOWN_DIMENSION_KEY',
  PRESET_DIMENSION_MISSING: 'PRESET_DIMENSION_MISSING'
})

const PRESET_CODE_MESSAGES = Object.freeze({
  [PRESET_CODES.UNKNOWN_APPLIANCE_KEY]: 'Requested Appliance is not supported.',
  [PRESET_CODES.SHIPPED_SCHEMA_SOURCE_MISSING]: 'Shipped schema source is unavailable.',
  [PRESET_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED]: 'Schema bootstrap copy failed.',
  [PRESET_CODES.LOCAL_SCHEMA_NOT_FOUND]: 'Schema file was not found in the active profile.',
  [PRESET_CODES.SCHEMA_FILE_UNREADABLE]: 'Schema file could not be read.',
  [PRESET_CODES.SCHEMA_JSON_PARSE_FAILED]: 'Schema JSON could not be parsed.',
  [PRESET_CODES.SCHEMA_CONTRACT_INVALID]: 'Schema could not be used.',
  [PRESET_CODES.SCHEMA_APPLIANCE_KEY_MISMATCH]: 'Schema Appliance does not match the requested key.',
  [PRESET_CODES.PRESETS_FILE_UNREADABLE]: 'Comparison preset file could not be read or written.',
  [PRESET_CODES.PRESETS_JSON_PARSE_FAILED]: 'Comparison preset JSON could not be parsed.',
  [PRESET_CODES.PRESETS_CONTRACT_INVALID]: 'Comparison preset file could not be used.',
  [PRESET_CODES.PRESET_NOT_FOUND]: 'The requested comparison preset was not found.',
  [PRESET_CODES.UNKNOWN_PRESET_ID]: 'The submitted comparison preset id could not be matched.',
  [PRESET_CODES.PRESET_APPLIANCE_KEY_MISMATCH]: 'The submitted comparison preset Appliance does not match the request.',
  [PRESET_CODES.INVALID_PRESET_NAME]: 'The submitted comparison preset name is invalid.',
  [PRESET_CODES.INVALID_DIMENSION_KEYS]: 'The submitted comparison preset Dimension keys are invalid.',
  [PRESET_CODES.DUPLICATE_DIMENSION_KEY]: 'The submitted comparison preset contains a duplicate Dimension key.',
  [PRESET_CODES.UNKNOWN_DIMENSION_KEY]: 'The submitted comparison preset references an unknown Dimension key.',
  [PRESET_CODES.PRESET_DIMENSION_MISSING]: 'A saved comparison preset references a missing Dimension.'
})

const SUPPORTED_PRESET_CONTRACT_VERSION = '1.0'

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyTrimmedString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isStoredPresetName(value) {
  return typeof value === 'string' && value === value.trim() && value !== ''
}

function createIssue(code, applianceKey, presetId = null, dimensionKey = null) {
  return {
    code,
    message: PRESET_CODE_MESSAGES[code] ?? 'Operation failed.',
    applianceKey,
    presetId,
    dimensionKey
  }
}

function cloneIssue(issue, overrides = {}) {
  return {
    code: overrides.code ?? issue.code,
    message: overrides.message ?? issue.message ?? PRESET_CODE_MESSAGES[issue.code] ?? 'Operation failed.',
    applianceKey: Object.prototype.hasOwnProperty.call(overrides, 'applianceKey') ? overrides.applianceKey : issue.applianceKey ?? null,
    presetId: Object.prototype.hasOwnProperty.call(overrides, 'presetId') ? overrides.presetId : issue.presetId ?? null,
    dimensionKey: Object.prototype.hasOwnProperty.call(overrides, 'dimensionKey') ? overrides.dimensionKey : issue.dimensionKey ?? null
  }
}

function normalizeUnknownApplianceKey(applianceKey) {
  return typeof applianceKey === 'string' ? applianceKey : null
}

function normalizePresetId(value) {
  return typeof value === 'string' ? value : null
}

function normalizeDimensionKey(value) {
  return typeof value === 'string' ? value : null
}

function validateCanonicalApplianceKey(applianceKey) {
  if (!CANONICAL_APPLIANCE_KEYS.includes(applianceKey)) {
    return createIssue(PRESET_CODES.UNKNOWN_APPLIANCE_KEY, normalizeUnknownApplianceKey(applianceKey))
  }

  return null
}

function createEmptyPresetDocument(applianceKey) {
  return {
    contractVersion: SUPPORTED_PRESET_CONTRACT_VERSION,
    appliance: applianceKey,
    presets: []
  }
}

function resolveLocalPresetDir(userDataPath, pathApi = path) {
  return pathApi.join(userDataPath, 'comparison-presets')
}

function resolvePresetFilePath(presetDir, applianceKey, pathApi = path) {
  return pathApi.join(presetDir, `${applianceKey}.comparison-presets.json`)
}

function serializePresetDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`
}

function normalizePersistedPresetRecord(record) {
  return {
    id: record.id,
    name: record.name,
    applianceKey: record.applianceKey,
    dimensionKeys: [...record.dimensionKeys]
  }
}

function normalizeReturnedPresetRecord(record, effectiveDimensionKeys) {
  return {
    id: record.id,
    name: record.name,
    applianceKey: record.applianceKey,
    dimensionKeys: [...record.dimensionKeys],
    effectiveDimensionKeys
  }
}

function validatePresetFileDocument(document, requestedApplianceKey) {
  if (!isObjectRecord(document)) {
    return createIssue(PRESET_CODES.PRESETS_CONTRACT_INVALID, requestedApplianceKey)
  }

  if (document.contractVersion !== SUPPORTED_PRESET_CONTRACT_VERSION) {
    return createIssue(PRESET_CODES.PRESETS_CONTRACT_INVALID, requestedApplianceKey)
  }

  if (!isNonEmptyTrimmedString(document.appliance) || !CANONICAL_APPLIANCE_KEYS.includes(document.appliance)) {
    return createIssue(PRESET_CODES.PRESETS_CONTRACT_INVALID, requestedApplianceKey)
  }

  if (document.appliance !== requestedApplianceKey) {
    return createIssue(PRESET_CODES.PRESETS_CONTRACT_INVALID, requestedApplianceKey)
  }

  if (!Array.isArray(document.presets)) {
    return createIssue(PRESET_CODES.PRESETS_CONTRACT_INVALID, requestedApplianceKey)
  }

  const presetIds = new Set()
  for (const preset of document.presets) {
    if (!isObjectRecord(preset)) {
      return createIssue(PRESET_CODES.PRESETS_CONTRACT_INVALID, requestedApplianceKey)
    }

    if (
      !isNonEmptyTrimmedString(preset.id) ||
      !isStoredPresetName(preset.name) ||
      !isNonEmptyTrimmedString(preset.applianceKey) ||
      !Array.isArray(preset.dimensionKeys)
    ) {
      return createIssue(PRESET_CODES.PRESETS_CONTRACT_INVALID, requestedApplianceKey)
    }

    if (preset.applianceKey !== requestedApplianceKey || presetIds.has(preset.id)) {
      return createIssue(PRESET_CODES.PRESETS_CONTRACT_INVALID, requestedApplianceKey)
    }

    const dimensionKeys = new Set()
    for (const dimensionKey of preset.dimensionKeys) {
      if (!isNonEmptyTrimmedString(dimensionKey) || dimensionKeys.has(dimensionKey)) {
        return createIssue(PRESET_CODES.PRESETS_CONTRACT_INVALID, requestedApplianceKey)
      }

      dimensionKeys.add(dimensionKey)
    }

    presetIds.add(preset.id)
  }

  return null
}

function validateSchemaDimensionDependencies(schema, applianceKey) {
  if (!isObjectRecord(schema) || !Array.isArray(schema.dimensions)) {
    return { ok: false, issue: createIssue(PRESET_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
  }

  const dimensionIds = new Set()
  for (const dimension of schema.dimensions) {
    if (!isObjectRecord(dimension) || !isNonEmptyTrimmedString(dimension.id) || dimensionIds.has(dimension.id)) {
      return { ok: false, issue: createIssue(PRESET_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
    }

    dimensionIds.add(dimension.id)
  }

  return { ok: true, dimensionIds }
}

async function readPresetFile({ applianceKey, presetDir, fsApi, pathApi }) {
  const filePath = resolvePresetFilePath(presetDir, applianceKey, pathApi)
  let rawContents

  try {
    rawContents = await fsApi.readFile(filePath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        ok: true,
        missing: true,
        filePath,
        document: createEmptyPresetDocument(applianceKey)
      }
    }

    return {
      ok: false,
      failure: createIssue(PRESET_CODES.PRESETS_FILE_UNREADABLE, applianceKey)
    }
  }

  let document
  try {
    document = JSON.parse(rawContents)
  } catch {
    return {
      ok: false,
      failure: createIssue(PRESET_CODES.PRESETS_JSON_PARSE_FAILED, applianceKey)
    }
  }

  const validationFailure = validatePresetFileDocument(document, applianceKey)
  if (validationFailure) {
    return {
      ok: false,
      failure: validationFailure
    }
  }

  return {
    ok: true,
    missing: false,
    filePath,
    document
  }
}

async function removeFileIfExists(fsApi, filePath) {
  try {
    await fsApi.unlink(filePath)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error
    }
  }
}

async function writeCanonicalDocument({
  applianceKey,
  document,
  filePath,
  presetDir,
  fsApi,
  pathApi,
  tempFileIdFactory,
  createDirectory,
  allowMissingOriginal
}) {
  if (createDirectory) {
    try {
      await fsApi.mkdir(presetDir, { recursive: true })
    } catch {
      return {
        ok: false,
        failure: createIssue(PRESET_CODES.PRESETS_FILE_UNREADABLE, applianceKey)
      }
    }
  }

  const stagedPath = pathApi.join(presetDir, `${pathApi.basename(filePath)}.${tempFileIdFactory()}.tmp`)
  const backupPath = pathApi.join(presetDir, `${pathApi.basename(filePath)}.${tempFileIdFactory()}.bak`)

  try {
    await fsApi.writeFile(stagedPath, serializePresetDocument(document))
  } catch {
    await Promise.allSettled([removeFileIfExists(fsApi, stagedPath)])
    return {
      ok: false,
      failure: createIssue(PRESET_CODES.PRESETS_FILE_UNREADABLE, applianceKey)
    }
  }

  let originalDisplaced = false
  let committed = false

  try {
    try {
      await fsApi.rename(filePath, backupPath)
      originalDisplaced = true
    } catch (error) {
      if (!error || error.code !== 'ENOENT' || !allowMissingOriginal) {
        throw error
      }
    }

    await fsApi.rename(stagedPath, filePath)
    committed = true
  } catch {
    try {
      await removeFileIfExists(fsApi, stagedPath)

      if (committed) {
        await removeFileIfExists(fsApi, filePath)
      }

      if (originalDisplaced) {
        await fsApi.rename(backupPath, filePath)
      }
    } catch {
      return {
        ok: false,
        failure: createIssue(PRESET_CODES.PRESETS_FILE_UNREADABLE, applianceKey)
      }
    }

    return {
      ok: false,
      failure: createIssue(PRESET_CODES.PRESETS_FILE_UNREADABLE, applianceKey)
    }
  }

  await Promise.allSettled([
    removeFileIfExists(fsApi, stagedPath),
    originalDisplaced ? removeFileIfExists(fsApi, backupPath) : Promise.resolve()
  ])

  return { ok: true }
}

function createLoadFailure(failure) {
  return {
    ok: false,
    presets: [],
    warnings: [],
    failure
  }
}

function createSaveFailure(failure) {
  return {
    ok: false,
    preset: null,
    warnings: [],
    validationErrors: [],
    failure
  }
}

function createDeleteFailure(failure) {
  return {
    ok: false,
    deletedPresetId: null,
    warnings: [],
    failure
  }
}

function createValidationFailure(validationErrors) {
  return {
    ok: false,
    preset: null,
    warnings: [],
    validationErrors,
    failure: null
  }
}

function deriveLoadedPresets(document, applianceKey, dimensionIds) {
  const warnings = []
  const presets = document.presets.map((preset) => {
    const effectiveDimensionKeys = []

    for (const dimensionKey of preset.dimensionKeys) {
      if (dimensionIds.has(dimensionKey)) {
        effectiveDimensionKeys.push(dimensionKey)
        continue
      }

      warnings.push(createIssue(PRESET_CODES.PRESET_DIMENSION_MISSING, applianceKey, preset.id, dimensionKey))
    }

    return normalizeReturnedPresetRecord(preset, effectiveDimensionKeys)
  })

  return { presets, warnings }
}

function validateSavePayload({ applianceKey, presetPayload, existingPresets, dimensionIds }) {
  if (!isObjectRecord(presetPayload)) {
    return createValidationFailure([
      createIssue(PRESET_CODES.INVALID_PRESET_NAME, applianceKey),
      createIssue(PRESET_CODES.INVALID_DIMENSION_KEYS, applianceKey)
    ])
  }

  const validationErrors = []
  const payloadHasId = Object.prototype.hasOwnProperty.call(presetPayload, 'id')
  const normalizedPresetId = payloadHasId ? normalizePresetId(presetPayload.id) : null

  let updateIndex = -1
  if (payloadHasId) {
    if (!isNonEmptyTrimmedString(presetPayload.id)) {
      validationErrors.push(
        createIssue(PRESET_CODES.UNKNOWN_PRESET_ID, applianceKey, normalizePresetId(presetPayload.id), null)
      )
    } else {
      updateIndex = existingPresets.findIndex((preset) => preset.id === presetPayload.id)
      if (updateIndex === -1) {
        validationErrors.push(createIssue(PRESET_CODES.UNKNOWN_PRESET_ID, applianceKey, presetPayload.id, null))
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(presetPayload, 'applianceKey') &&
    presetPayload.applianceKey !== applianceKey
  ) {
    validationErrors.push(
      createIssue(PRESET_CODES.PRESET_APPLIANCE_KEY_MISMATCH, applianceKey, normalizedPresetId, null)
    )
  }

  const trimmedName = typeof presetPayload.name === 'string' ? presetPayload.name.trim() : null
  if (trimmedName === null || trimmedName === '') {
    validationErrors.push(createIssue(PRESET_CODES.INVALID_PRESET_NAME, applianceKey, normalizedPresetId, null))
  }

  if (!Array.isArray(presetPayload.dimensionKeys)) {
    validationErrors.push(createIssue(PRESET_CODES.INVALID_DIMENSION_KEYS, applianceKey, normalizedPresetId, null))
  } else {
    const seenDimensionKeys = new Set()

    for (const dimensionKey of presetPayload.dimensionKeys) {
      if (!isNonEmptyTrimmedString(dimensionKey)) {
        validationErrors.push(
          createIssue(
            PRESET_CODES.INVALID_DIMENSION_KEYS,
            applianceKey,
            normalizedPresetId,
            normalizeDimensionKey(dimensionKey)
          )
        )
        continue
      }

      if (seenDimensionKeys.has(dimensionKey)) {
        validationErrors.push(
          createIssue(PRESET_CODES.DUPLICATE_DIMENSION_KEY, applianceKey, normalizedPresetId, dimensionKey)
        )
        continue
      }

      seenDimensionKeys.add(dimensionKey)

      if (!dimensionIds.has(dimensionKey)) {
        validationErrors.push(
          createIssue(PRESET_CODES.UNKNOWN_DIMENSION_KEY, applianceKey, normalizedPresetId, dimensionKey)
        )
      }
    }
  }

  if (validationErrors.length > 0) {
    return createValidationFailure(validationErrors)
  }

  return {
    ok: true,
    normalizedPreset: {
      id: payloadHasId ? presetPayload.id : null,
      name: trimmedName,
      applianceKey,
      dimensionKeys: [...presetPayload.dimensionKeys]
    },
    updateIndex,
    isCreate: !payloadHasId
  }
}

function createPresetStorage({
  userDataPath,
  schemaStorage,
  fsApi = fs,
  pathApi = path,
  presetIdFactory = () => crypto.randomUUID(),
  tempFileIdFactory = () => crypto.randomUUID()
}) {
  if (!isNonEmptyTrimmedString(userDataPath)) {
    throw new Error('userDataPath is required to create preset storage')
  }

  if (!schemaStorage || typeof schemaStorage.loadSchema !== 'function') {
    throw new Error('schemaStorage.loadSchema is required to create preset storage')
  }

  const presetDir = resolveLocalPresetDir(userDataPath, pathApi)

  async function loadValidatedSchemaDimensions(applianceKey) {
    const schemaResult = await schemaStorage.loadSchema(applianceKey)
    if (!schemaResult.ok) {
      return {
        ok: false,
        failure: cloneIssue(schemaResult.failure, { presetId: null, dimensionKey: null })
      }
    }

    const dependencyResult = validateSchemaDimensionDependencies(schemaResult.schema, applianceKey)
    if (!dependencyResult.ok) {
      return {
        ok: false,
        failure: dependencyResult.issue
      }
    }

    return {
      ok: true,
      dimensionIds: dependencyResult.dimensionIds
    }
  }

  async function loadPresets(applianceKey) {
    const applianceFailure = validateCanonicalApplianceKey(applianceKey)
    if (applianceFailure) {
      return createLoadFailure(applianceFailure)
    }

    const schemaResult = await loadValidatedSchemaDimensions(applianceKey)
    if (!schemaResult.ok) {
      return createLoadFailure(schemaResult.failure)
    }

    const presetFileResult = await readPresetFile({ applianceKey, presetDir, fsApi, pathApi })
    if (!presetFileResult.ok) {
      return createLoadFailure(presetFileResult.failure)
    }

    if (presetFileResult.missing) {
      return {
        ok: true,
        presets: [],
        warnings: [],
        failure: null
      }
    }

    const derived = deriveLoadedPresets(presetFileResult.document, applianceKey, schemaResult.dimensionIds)
    return {
      ok: true,
      presets: derived.presets,
      warnings: derived.warnings,
      failure: null
    }
  }

  async function savePreset(applianceKey, presetPayload) {
    const applianceFailure = validateCanonicalApplianceKey(applianceKey)
    if (applianceFailure) {
      return createSaveFailure(applianceFailure)
    }

    const schemaResult = await loadValidatedSchemaDimensions(applianceKey)
    if (!schemaResult.ok) {
      return createSaveFailure(schemaResult.failure)
    }

    const presetFileResult = await readPresetFile({ applianceKey, presetDir, fsApi, pathApi })
    if (!presetFileResult.ok) {
      return createSaveFailure(presetFileResult.failure)
    }

    const validationResult = validateSavePayload({
      applianceKey,
      presetPayload,
      existingPresets: presetFileResult.document.presets,
      dimensionIds: schemaResult.dimensionIds
    })

    if (!validationResult.ok) {
      return validationResult
    }

    const nextPresets = presetFileResult.document.presets.map((preset) => normalizePersistedPresetRecord(preset))
    let savedPreset

    if (validationResult.isCreate) {
      const existingIds = new Set(nextPresets.map((preset) => preset.id))
      let createdId
      do {
        createdId = presetIdFactory()
      } while (!isNonEmptyTrimmedString(createdId) || existingIds.has(createdId))

      savedPreset = {
        ...validationResult.normalizedPreset,
        id: createdId
      }
      nextPresets.push(savedPreset)
    } else {
      savedPreset = validationResult.normalizedPreset
      nextPresets.splice(validationResult.updateIndex, 1, savedPreset)
    }

    const writeResult = await writeCanonicalDocument({
      applianceKey,
      document: {
        contractVersion: SUPPORTED_PRESET_CONTRACT_VERSION,
        appliance: applianceKey,
        presets: nextPresets
      },
      filePath: presetFileResult.filePath,
      presetDir,
      fsApi,
      pathApi,
      tempFileIdFactory,
      createDirectory: true,
      allowMissingOriginal: true
    })

    if (!writeResult.ok) {
      return createSaveFailure(writeResult.failure)
    }

    return {
      ok: true,
      preset: normalizeReturnedPresetRecord(savedPreset, [...savedPreset.dimensionKeys]),
      warnings: [],
      validationErrors: [],
      failure: null
    }
  }

  async function deletePreset(applianceKey, presetId) {
    const applianceFailure = validateCanonicalApplianceKey(applianceKey)
    if (applianceFailure) {
      return createDeleteFailure(applianceFailure)
    }

    if (!isNonEmptyTrimmedString(presetId)) {
      return createDeleteFailure(
        createIssue(PRESET_CODES.PRESET_NOT_FOUND, applianceKey, normalizePresetId(presetId), null)
      )
    }

    const presetFileResult = await readPresetFile({ applianceKey, presetDir, fsApi, pathApi })
    if (!presetFileResult.ok) {
      return createDeleteFailure(presetFileResult.failure)
    }

    if (presetFileResult.missing) {
      return createDeleteFailure(createIssue(PRESET_CODES.PRESET_NOT_FOUND, applianceKey, presetId, null))
    }

    const presetIndex = presetFileResult.document.presets.findIndex((preset) => preset.id === presetId)
    if (presetIndex === -1) {
      return createDeleteFailure(createIssue(PRESET_CODES.PRESET_NOT_FOUND, applianceKey, presetId, null))
    }

    const nextPresets = presetFileResult.document.presets
      .filter((preset) => preset.id !== presetId)
      .map((preset) => normalizePersistedPresetRecord(preset))

    const writeResult = await writeCanonicalDocument({
      applianceKey,
      document: {
        contractVersion: SUPPORTED_PRESET_CONTRACT_VERSION,
        appliance: applianceKey,
        presets: nextPresets
      },
      filePath: presetFileResult.filePath,
      presetDir,
      fsApi,
      pathApi,
      tempFileIdFactory,
      createDirectory: false,
      allowMissingOriginal: false
    })

    if (!writeResult.ok) {
      return createDeleteFailure(writeResult.failure)
    }

    return {
      ok: true,
      deletedPresetId: presetId,
      warnings: [],
      failure: null
    }
  }

  return {
    loadPresets,
    savePreset,
    deletePreset,
    paths: {
      presetDir
    }
  }
}

module.exports = {
  PRESET_CODES,
  SUPPORTED_PRESET_CONTRACT_VERSION,
  createPresetStorage,
  resolveLocalPresetDir,
  resolvePresetFilePath,
  validatePresetFileDocument,
  validateSchemaDimensionDependencies
}
