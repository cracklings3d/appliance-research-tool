const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const { CANONICAL_APPLIANCE_KEYS, WARNING_FAILURE_CODES } = require('./schemaStorage')

const OPTION_CODES = Object.freeze({
  ...WARNING_FAILURE_CODES,
  OPTIONS_FILE_UNREADABLE: 'OPTIONS_FILE_UNREADABLE',
  OPTIONS_JSON_PARSE_FAILED: 'OPTIONS_JSON_PARSE_FAILED',
  OPTIONS_CONTRACT_INVALID: 'OPTIONS_CONTRACT_INVALID',
  OPTIONS_APPLIANCE_KEY_MISMATCH: 'OPTIONS_APPLIANCE_KEY_MISMATCH',
  OPTIONS_CONTRACT_VERSION_UNSUPPORTED: 'OPTIONS_CONTRACT_VERSION_UNSUPPORTED',
  OPTIONS_DIRECTORY_CREATE_FAILED: 'OPTIONS_DIRECTORY_CREATE_FAILED',
  OPTIONS_STAGE_WRITE_FAILED: 'OPTIONS_STAGE_WRITE_FAILED',
  OPTIONS_REPLACE_FAILED: 'OPTIONS_REPLACE_FAILED',
  OPTIONS_ROLLBACK_FAILED: 'OPTIONS_ROLLBACK_FAILED',
  OPTION_MIGRATION_APPLIED: 'OPTION_MIGRATION_APPLIED',
  OPTION_MIGRATION_BLOCKED: 'OPTION_MIGRATION_BLOCKED',
  OPTION_NOT_FOUND: 'OPTION_NOT_FOUND',
  UNKNOWN_OPTION_ID: 'UNKNOWN_OPTION_ID',
  UNKNOWN_DIMENSION_ID: 'UNKNOWN_DIMENSION_ID',
  INVALID_EVALUATION_SHAPE: 'INVALID_EVALUATION_SHAPE',
  REQUIRED_DIMENSION_MISSING: 'REQUIRED_DIMENSION_MISSING',
  POINTER_TARGET_REQUIRED: 'POINTER_TARGET_REQUIRED',
  POINTER_TARGET_NOT_FOUND: 'POINTER_TARGET_NOT_FOUND'
})

const OPTION_CODE_MESSAGES = Object.freeze({
  [OPTION_CODES.UNKNOWN_APPLIANCE_KEY]: 'Requested Appliance is not supported.',
  [OPTION_CODES.SHIPPED_SCHEMA_SOURCE_MISSING]: 'Shipped schema source is unavailable.',
  [OPTION_CODES.SCHEMA_BOOTSTRAP_COPY_FAILED]: 'Schema bootstrap copy failed.',
  [OPTION_CODES.LOCAL_SCHEMA_NOT_FOUND]: 'Schema file was not found in the active profile.',
  [OPTION_CODES.SCHEMA_FILE_UNREADABLE]: 'Schema file could not be read.',
  [OPTION_CODES.SCHEMA_JSON_PARSE_FAILED]: 'Schema JSON could not be parsed.',
  [OPTION_CODES.SCHEMA_CONTRACT_INVALID]: 'Schema could not be used.',
  [OPTION_CODES.SCHEMA_APPLIANCE_KEY_MISMATCH]: 'Schema Appliance does not match the requested key.',
  [OPTION_CODES.OPTIONS_FILE_UNREADABLE]: 'Option file could not be read.',
  [OPTION_CODES.OPTIONS_JSON_PARSE_FAILED]: 'Option JSON could not be parsed.',
  [OPTION_CODES.OPTIONS_CONTRACT_INVALID]: 'Option file could not be used.',
  [OPTION_CODES.OPTIONS_APPLIANCE_KEY_MISMATCH]: 'Option file Appliance does not match the requested key.',
  [OPTION_CODES.OPTIONS_CONTRACT_VERSION_UNSUPPORTED]: 'Option contract version is not supported.',
  [OPTION_CODES.OPTIONS_DIRECTORY_CREATE_FAILED]: 'Option directory could not be created.',
  [OPTION_CODES.OPTIONS_STAGE_WRITE_FAILED]: 'Staged option write failed.',
  [OPTION_CODES.OPTIONS_REPLACE_FAILED]: 'Option file replacement failed after restore.',
  [OPTION_CODES.OPTIONS_ROLLBACK_FAILED]: 'Option file replacement failed and restore could not be confirmed.',
  [OPTION_CODES.OPTION_MIGRATION_APPLIED]: 'A persisted Option Evaluation was safely migrated for the current schema.',
  [OPTION_CODES.OPTION_MIGRATION_BLOCKED]: 'A persisted Option could not be safely migrated for the current schema.',
  [OPTION_CODES.OPTION_NOT_FOUND]: 'The requested Option was not found.',
  [OPTION_CODES.UNKNOWN_OPTION_ID]: 'The submitted Option id could not be matched.',
  [OPTION_CODES.UNKNOWN_DIMENSION_ID]: 'The submitted Dimension id is not defined in the current schema.',
  [OPTION_CODES.INVALID_EVALUATION_SHAPE]: 'The submitted Evaluation does not match the current schema contract.',
  [OPTION_CODES.REQUIRED_DIMENSION_MISSING]: 'A required Dimension is missing from the submitted Option.',
  [OPTION_CODES.POINTER_TARGET_REQUIRED]: 'The Laundry Set pointer target is required.',
  [OPTION_CODES.POINTER_TARGET_NOT_FOUND]: 'The referenced pointer target Option was not found.'
})

const SUPPORTED_OPTION_CONTRACT_VERSION = '1.0'
const VALID_DIMENSION_TYPES = new Set(['boolean', 'enum', 'numeric', 'string', 'pointer'])

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function cloneIssue(issue, overrides = {}) {
  return {
    code: overrides.code ?? issue.code,
    message: overrides.message ?? issue.message ?? OPTION_CODE_MESSAGES[issue.code] ?? 'Operation failed.',
    applianceKey: Object.prototype.hasOwnProperty.call(overrides, 'applianceKey') ? overrides.applianceKey : issue.applianceKey ?? null,
    optionId: Object.prototype.hasOwnProperty.call(overrides, 'optionId') ? overrides.optionId : issue.optionId ?? null,
    dimensionId: Object.prototype.hasOwnProperty.call(overrides, 'dimensionId') ? overrides.dimensionId : issue.dimensionId ?? null
  }
}

function createIssue(code, applianceKey, optionId = null, dimensionId = null) {
  return {
    code,
    message: OPTION_CODE_MESSAGES[code] ?? 'Operation failed.',
    applianceKey,
    optionId,
    dimensionId
  }
}

function normalizeUnknownApplianceKey(applianceKey) {
  return typeof applianceKey === 'string' ? applianceKey : null
}

function normalizeSaveOptionId(value) {
  return typeof value === 'string' ? value : null
}

function normalizeDeleteOptionId(value) {
  return typeof value === 'string' ? value : null
}

function normalizeOptionRecordTopLevel(record) {
  const normalized = {
    evaluations: record.evaluations
  }

  if (Object.prototype.hasOwnProperty.call(record, 'id')) {
    normalized.id = record.id
  }

  return normalized
}

function normalizeOptionRecordsTopLevel(records) {
  return records.map((record) => normalizeOptionRecordTopLevel(record))
}

function createEmptyOptionDocument(applianceKey) {
  return {
    contractVersion: SUPPORTED_OPTION_CONTRACT_VERSION,
    appliance: applianceKey,
    options: []
  }
}

function resolveLocalOptionsDir(userDataPath, pathApi = path) {
  return pathApi.join(userDataPath, 'options')
}

function resolveOptionFilePath(optionsDir, applianceKey, pathApi = path) {
  return pathApi.join(optionsDir, `${applianceKey}.options.json`)
}

function serializeOptionDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`
}

function validateCanonicalApplianceKey(applianceKey) {
  if (!CANONICAL_APPLIANCE_KEYS.includes(applianceKey)) {
    return createIssue(OPTION_CODES.UNKNOWN_APPLIANCE_KEY, normalizeUnknownApplianceKey(applianceKey))
  }

  return null
}

function validateSchemaDependencies(schema, applianceKey, { requireLaundryPointerMetadata = false } = {}) {
  if (!isObjectRecord(schema) || !Array.isArray(schema.dimensions) || !Array.isArray(schema.requiredDimensionIds)) {
    return { ok: false, issue: createIssue(OPTION_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
  }

  const dimensionsById = new Map()
  for (const dimension of schema.dimensions) {
    if (!isObjectRecord(dimension)) {
      return { ok: false, issue: createIssue(OPTION_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
    }

    if (!isNonEmptyString(dimension.id) || dimensionsById.has(dimension.id)) {
      return { ok: false, issue: createIssue(OPTION_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
    }

    if (typeof dimension.required !== 'boolean' || !VALID_DIMENSION_TYPES.has(dimension.type)) {
      return { ok: false, issue: createIssue(OPTION_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
    }

    dimensionsById.set(dimension.id, dimension)
  }

  const requiredDimensionIds = new Set()
  for (const requiredId of schema.requiredDimensionIds) {
    if (!isNonEmptyString(requiredId) || requiredDimensionIds.has(requiredId) || !dimensionsById.has(requiredId)) {
      return { ok: false, issue: createIssue(OPTION_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
    }

    requiredDimensionIds.add(requiredId)
  }

  for (const [dimensionId, dimension] of dimensionsById.entries()) {
    if (requiredDimensionIds.has(dimensionId) !== dimension.required) {
      return { ok: false, issue: createIssue(OPTION_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
    }
  }

  const pointerDimensions = schema.dimensions.filter((dimension) => dimension.type === 'pointer')

  if (applianceKey !== 'laundry-set' && pointerDimensions.length > 0) {
    return { ok: false, issue: createIssue(OPTION_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
  }

  let pointerMetadata = null
  if (applianceKey === 'laundry-set') {
    if (pointerDimensions.length > 0 && schema.pointerDimensionsAllowed !== true) {
      return { ok: false, issue: createIssue(OPTION_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
    }

    const washerDimension = dimensionsById.get('washer')
    const dryerDimension = dimensionsById.get('dryer')

    if (
      schema.pointerDimensionsAllowed !== true ||
      !washerDimension ||
      !dryerDimension ||
      washerDimension.type !== 'pointer' ||
      dryerDimension.type !== 'pointer' ||
      !isNonEmptyString(washerDimension.targetAppliance) ||
      !isNonEmptyString(dryerDimension.targetAppliance) ||
      washerDimension.targetAppliance !== 'washer' ||
      dryerDimension.targetAppliance !== 'dryer'
    ) {
      return { ok: false, issue: createIssue(OPTION_CODES.SCHEMA_CONTRACT_INVALID, applianceKey) }
    }

    pointerMetadata = {
      washer: washerDimension,
      dryer: dryerDimension
    }
  }

  return {
    ok: true,
    schemaInfo: {
      applianceKey,
      schema,
      dimensionsById,
      requiredDimensionIds,
      pointerMetadata
    }
  }
}

function validateOptionFileDocument(document, requestedApplianceKey) {
  if (!isObjectRecord(document)) {
    return createIssue(OPTION_CODES.OPTIONS_CONTRACT_INVALID, requestedApplianceKey)
  }

  if (document.contractVersion !== SUPPORTED_OPTION_CONTRACT_VERSION) {
    return createIssue(OPTION_CODES.OPTIONS_CONTRACT_VERSION_UNSUPPORTED, requestedApplianceKey)
  }

  if (!isNonEmptyString(document.appliance) || !CANONICAL_APPLIANCE_KEYS.includes(document.appliance)) {
    return createIssue(OPTION_CODES.OPTIONS_CONTRACT_INVALID, requestedApplianceKey)
  }

  if (document.appliance !== requestedApplianceKey) {
    return createIssue(OPTION_CODES.OPTIONS_APPLIANCE_KEY_MISMATCH, requestedApplianceKey)
  }

  if (!Array.isArray(document.options)) {
    return createIssue(OPTION_CODES.OPTIONS_CONTRACT_INVALID, requestedApplianceKey)
  }

  const optionIds = new Set()
  for (const option of document.options) {
    if (!isObjectRecord(option) || !isNonEmptyString(option.id)) {
      return createIssue(OPTION_CODES.OPTIONS_CONTRACT_INVALID, requestedApplianceKey)
    }

    if (optionIds.has(option.id)) {
      return createIssue(OPTION_CODES.OPTIONS_CONTRACT_INVALID, requestedApplianceKey)
    }

    optionIds.add(option.id)
  }

  return null
}

function isValidEvaluationShape(evaluation, dimension) {
  if (!isObjectRecord(evaluation)) {
    return false
  }

  if (evaluation.status === 'na') {
    return true
  }

  if (evaluation.status !== 'known') {
    return false
  }

  switch (dimension.type) {
    case 'boolean':
      return typeof evaluation.value === 'boolean'
    case 'numeric':
      return typeof evaluation.value === 'number' && Number.isFinite(evaluation.value)
    case 'string':
      return typeof evaluation.value === 'string'
    case 'enum':
      if (typeof evaluation.value !== 'string') {
        return false
      }

      if (Array.isArray(dimension.allowedValues)) {
        return dimension.allowedValues.includes(evaluation.value)
      }

      return true
    case 'pointer':
      return isNonEmptyString(evaluation.value)
    default:
      return false
  }
}

function isKnownPointerTargetEvaluation(evaluation) {
  return isObjectRecord(evaluation) && evaluation.status === 'known' && isNonEmptyString(evaluation.value)
}

function migratePersistedOptionRecord(record, schemaInfo, applianceKey) {
  const normalizedRecord = normalizeOptionRecordTopLevel(record)
  const safeWarnings = []
  const blockedWarnings = []

  if (!isObjectRecord(normalizedRecord.evaluations)) {
    blockedWarnings.push(createIssue(OPTION_CODES.OPTION_MIGRATION_BLOCKED, applianceKey, record.id, null))
    return { included: false, warnings: blockedWarnings }
  }

  const normalizedEvaluations = {}

  for (const [dimensionId, evaluation] of Object.entries(normalizedRecord.evaluations)) {
    const dimension = schemaInfo.dimensionsById.get(dimensionId)

    if (!dimension) {
      safeWarnings.push(createIssue(OPTION_CODES.OPTION_MIGRATION_APPLIED, applianceKey, record.id, dimensionId))
      continue
    }

    if (!isValidEvaluationShape(evaluation, dimension)) {
      blockedWarnings.push(createIssue(OPTION_CODES.OPTION_MIGRATION_BLOCKED, applianceKey, record.id, dimensionId))
      continue
    }

    normalizedEvaluations[dimensionId] = evaluation
  }

  for (const dimensionId of schemaInfo.requiredDimensionIds) {
    if (!Object.prototype.hasOwnProperty.call(normalizedRecord.evaluations, dimensionId)) {
      blockedWarnings.push(createIssue(OPTION_CODES.OPTION_MIGRATION_BLOCKED, applianceKey, record.id, dimensionId))
    }
  }

  if (blockedWarnings.length > 0) {
    return { included: false, warnings: blockedWarnings }
  }

  return {
    included: true,
    option: {
      id: record.id,
      evaluations: normalizedEvaluations
    },
    warnings: safeWarnings
  }
}

async function readOptionFile({ applianceKey, optionsDir, fsApi, pathApi }) {
  const filePath = resolveOptionFilePath(optionsDir, applianceKey, pathApi)
  let rawContents

  try {
    rawContents = await fsApi.readFile(filePath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        ok: true,
        missing: true,
        filePath,
        document: createEmptyOptionDocument(applianceKey)
      }
    }

    return {
      ok: false,
      failure: createIssue(OPTION_CODES.OPTIONS_FILE_UNREADABLE, applianceKey)
    }
  }

  let document
  try {
    document = JSON.parse(rawContents)
  } catch {
    return {
      ok: false,
      failure: createIssue(OPTION_CODES.OPTIONS_JSON_PARSE_FAILED, applianceKey)
    }
  }

  const validationFailure = validateOptionFileDocument(document, applianceKey)
  if (validationFailure) {
    return { ok: false, failure: validationFailure }
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

async function cleanupPaths(fsApi, filePaths) {
  await Promise.allSettled(
    filePaths.map((filePath) => removeFileIfExists(fsApi, filePath))
  )
}

async function rollbackCommittedEntries(fsApi, committedEntries) {
  for (const entry of [...committedEntries].reverse()) {
    if (entry.originalDisplaced) {
      await removeFileIfExists(fsApi, entry.filePath)
      await fsApi.rename(entry.backupPath, entry.filePath)
      continue
    }

    if (entry.replaceAttempted) {
      await removeFileIfExists(fsApi, entry.filePath)
    }
  }
}

async function writeAtomically({
  updates,
  optionsDir,
  fsApi,
  pathApi,
  tempFileIdFactory,
  failureOptionId,
  mkdirFailureApplianceKey
}) {
  try {
    await fsApi.mkdir(optionsDir, { recursive: true })
  } catch {
    return {
      ok: false,
      failure: createIssue(OPTION_CODES.OPTIONS_DIRECTORY_CREATE_FAILED, mkdirFailureApplianceKey, failureOptionId, null)
    }
  }

  const stagedEntries = []
  for (const update of updates) {
    const stagedPath = pathApi.join(optionsDir, `${pathApi.basename(update.filePath)}.${tempFileIdFactory()}.tmp`)

    try {
      await fsApi.writeFile(stagedPath, serializeOptionDocument(update.document))
    } catch {
      await cleanupPaths(fsApi, stagedEntries.map((entry) => entry.stagedPath).concat(stagedPath))
      return {
        ok: false,
        failure: createIssue(OPTION_CODES.OPTIONS_STAGE_WRITE_FAILED, update.applianceKey, failureOptionId, null)
      }
    }

    stagedEntries.push({ ...update, stagedPath })
  }

  const replacedEntries = []

  for (const entry of stagedEntries) {
    const backupPath = pathApi.join(optionsDir, `${pathApi.basename(entry.filePath)}.${tempFileIdFactory()}.bak`)
    let originalDisplaced = false
    let replaceAttempted = false

    try {
      try {
        await fsApi.rename(entry.filePath, backupPath)
        originalDisplaced = true
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error
        }
      }

      replaceAttempted = true
      await fsApi.rename(entry.stagedPath, entry.filePath)
      replacedEntries.push({ ...entry, backupPath, originalDisplaced, replaceAttempted })
    } catch {
      const entriesToRollback = [...replacedEntries]

      if (originalDisplaced || replaceAttempted) {
        entriesToRollback.push({ ...entry, backupPath, originalDisplaced, replaceAttempted })
      }

      let rollbackSucceeded = true
      try {
        await rollbackCommittedEntries(fsApi, entriesToRollback)
      } catch {
        rollbackSucceeded = false
      }

      await cleanupPaths(fsApi, stagedEntries.map((stagedEntry) => stagedEntry.stagedPath))

      if (rollbackSucceeded) {
        await cleanupPaths(fsApi, entriesToRollback.map((rollbackEntry) => rollbackEntry.backupPath))
      }

      return {
        ok: false,
        failure: createIssue(
          rollbackSucceeded ? OPTION_CODES.OPTIONS_REPLACE_FAILED : OPTION_CODES.OPTIONS_ROLLBACK_FAILED,
          entry.applianceKey,
          failureOptionId,
          null
        )
      }
    }
  }

  await cleanupPaths(fsApi, replacedEntries.filter((entry) => entry.originalDisplaced).map((entry) => entry.backupPath))

  return { ok: true }
}

function createLoadFailure(failure) {
  return {
    ok: false,
    options: [],
    warnings: [],
    failure
  }
}

function createSaveFailure(failure) {
  return {
    ok: false,
    option: null,
    warnings: [],
    validationErrors: [],
    failure
  }
}

function createDeleteFailure(failure) {
  return {
    ok: false,
    deletedOptionId: null,
    affectedLaundrySetOptionIds: [],
    repairedLaundrySetOptionIds: [],
    warnings: [],
    failure
  }
}

function createOptionStorage({
  userDataPath,
  schemaStorage,
  fsApi = fs,
  pathApi = path,
  optionIdFactory = () => crypto.randomUUID(),
  tempFileIdFactory = () => crypto.randomUUID()
}) {
  if (!isNonEmptyString(userDataPath)) {
    throw new Error('userDataPath is required to create option storage')
  }

  if (!schemaStorage || typeof schemaStorage.loadSchema !== 'function') {
    throw new Error('schemaStorage.loadSchema is required to create option storage')
  }

  const optionsDir = resolveLocalOptionsDir(userDataPath, pathApi)

  async function loadGatedSchema(applianceKey, options = {}) {
    const schemaResult = await schemaStorage.loadSchema(applianceKey)
    if (!schemaResult.ok) {
      return {
        ok: false,
        failure: cloneIssue(schemaResult.failure, { optionId: null, dimensionId: null })
      }
    }

    const dependencyCheck = validateSchemaDependencies(schemaResult.schema, applianceKey, options)
    if (!dependencyCheck.ok) {
      return {
        ok: false,
        failure: dependencyCheck.issue
      }
    }

    return {
      ok: true,
      schemaInfo: dependencyCheck.schemaInfo
    }
  }

  async function readExistingCatalog(applianceKey) {
    return readOptionFile({ applianceKey, optionsDir, fsApi, pathApi })
  }

  async function loadOptions(applianceKey) {
    const applianceFailure = validateCanonicalApplianceKey(applianceKey)
    if (applianceFailure) {
      return createLoadFailure(applianceFailure)
    }

    const schemaResult = await loadGatedSchema(applianceKey)
    if (!schemaResult.ok) {
      return createLoadFailure(schemaResult.failure)
    }

    const optionsResult = await readExistingCatalog(applianceKey)
    if (!optionsResult.ok) {
      return createLoadFailure(optionsResult.failure)
    }

    if (optionsResult.missing) {
      return {
        ok: true,
        options: [],
        warnings: [],
        failure: null
      }
    }

    const options = []
    const warnings = []

    for (const persistedOption of optionsResult.document.options) {
      const migrationResult = migratePersistedOptionRecord(persistedOption, schemaResult.schemaInfo, applianceKey)
      warnings.push(...migrationResult.warnings)

      if (migrationResult.included) {
        options.push(migrationResult.option)
      }
    }

    return {
      ok: true,
      options,
      warnings,
      failure: null
    }
  }

  async function saveOption(applianceKey, optionPayload) {
    const applianceFailure = validateCanonicalApplianceKey(applianceKey)
    if (applianceFailure) {
      return createSaveFailure(applianceFailure)
    }

    const schemaResult = await loadGatedSchema(applianceKey)
    if (!schemaResult.ok) {
      return createSaveFailure(schemaResult.failure)
    }

    const existingOptionsResult = await readExistingCatalog(applianceKey)
    if (!existingOptionsResult.ok) {
      return createSaveFailure(existingOptionsResult.failure)
    }

    let washerCatalogIds = null
    let dryerCatalogIds = null

    if (applianceKey === 'laundry-set') {
      const washerCatalogResult = await readExistingCatalog('washer')
      if (!washerCatalogResult.ok) {
        return createSaveFailure(cloneIssue(washerCatalogResult.failure, { optionId: null, dimensionId: null }))
      }

      const dryerCatalogResult = await readExistingCatalog('dryer')
      if (!dryerCatalogResult.ok) {
        return createSaveFailure(cloneIssue(dryerCatalogResult.failure, { optionId: null, dimensionId: null }))
      }

      washerCatalogIds = new Set(washerCatalogResult.document.options.map((option) => option.id))
      dryerCatalogIds = new Set(dryerCatalogResult.document.options.map((option) => option.id))
    }

    if (!isObjectRecord(optionPayload)) {
      return {
        ok: false,
        option: null,
        warnings: [],
        validationErrors: [createIssue(OPTION_CODES.INVALID_EVALUATION_SHAPE, applianceKey, null, null)],
        failure: null
      }
    }

    const normalizedPayload = normalizeOptionRecordTopLevel(optionPayload)
    const payloadHasId = Object.prototype.hasOwnProperty.call(optionPayload, 'id')
    const validationErrors = []
    const optionIdForShapeErrors = payloadHasId ? normalizeSaveOptionId(optionPayload.id) : null

    let updateIndex = -1
    let normalizedOptionId = null

    if (payloadHasId) {
      if (!isNonEmptyString(optionPayload.id)) {
        validationErrors.push(
          createIssue(OPTION_CODES.UNKNOWN_OPTION_ID, applianceKey, normalizeSaveOptionId(optionPayload.id), null)
        )
      } else {
        normalizedOptionId = optionPayload.id
        updateIndex = existingOptionsResult.document.options.findIndex((option) => option.id === normalizedOptionId)

        if (updateIndex === -1) {
          validationErrors.push(createIssue(OPTION_CODES.UNKNOWN_OPTION_ID, applianceKey, optionPayload.id, null))
        }
      }
    }

    if (!isObjectRecord(normalizedPayload.evaluations)) {
      validationErrors.push(createIssue(OPTION_CODES.INVALID_EVALUATION_SHAPE, applianceKey, optionIdForShapeErrors, null))
    } else {
      for (const [dimensionId, evaluation] of Object.entries(normalizedPayload.evaluations)) {
        const dimension = schemaResult.schemaInfo.dimensionsById.get(dimensionId)

        if (!dimension) {
          validationErrors.push(createIssue(OPTION_CODES.UNKNOWN_DIMENSION_ID, applianceKey, optionIdForShapeErrors, dimensionId))
          continue
        }

        const isLaundryPointer = applianceKey === 'laundry-set' && (dimensionId === 'washer' || dimensionId === 'dryer')
        if (isLaundryPointer) {
          if (!isKnownPointerTargetEvaluation(evaluation)) {
            validationErrors.push(createIssue(OPTION_CODES.POINTER_TARGET_REQUIRED, applianceKey, optionIdForShapeErrors, dimensionId))
            continue
          }

          const targetCatalogIds = dimensionId === 'washer' ? washerCatalogIds : dryerCatalogIds
          if (!targetCatalogIds.has(evaluation.value)) {
            validationErrors.push(createIssue(OPTION_CODES.POINTER_TARGET_NOT_FOUND, applianceKey, optionIdForShapeErrors, dimensionId))
          }

          continue
        }

        if (!isValidEvaluationShape(evaluation, dimension)) {
          validationErrors.push(createIssue(OPTION_CODES.INVALID_EVALUATION_SHAPE, applianceKey, optionIdForShapeErrors, dimensionId))
        }
      }

      for (const dimensionId of schemaResult.schemaInfo.requiredDimensionIds) {
        if (Object.prototype.hasOwnProperty.call(normalizedPayload.evaluations, dimensionId)) {
          continue
        }

        if (applianceKey === 'laundry-set' && (dimensionId === 'washer' || dimensionId === 'dryer')) {
          validationErrors.push(createIssue(OPTION_CODES.POINTER_TARGET_REQUIRED, applianceKey, optionIdForShapeErrors, dimensionId))
          continue
        }

        validationErrors.push(createIssue(OPTION_CODES.REQUIRED_DIMENSION_MISSING, applianceKey, optionIdForShapeErrors, dimensionId))
      }
    }

    if (validationErrors.length > 0) {
      return {
        ok: false,
        option: null,
        warnings: [],
        validationErrors,
        failure: null
      }
    }

    const existingOptionIds = new Set(existingOptionsResult.document.options.map((option) => option.id))
    let createdOptionId = null

    if (!payloadHasId) {
      do {
        createdOptionId = optionIdFactory()
      } while (!isNonEmptyString(createdOptionId) || existingOptionIds.has(createdOptionId))
    }

    const savedOption = {
      id: payloadHasId ? normalizedOptionId : createdOptionId,
      evaluations: normalizedPayload.evaluations
    }

    const nextOptions = normalizeOptionRecordsTopLevel(existingOptionsResult.document.options)
    if (payloadHasId) {
      nextOptions.splice(updateIndex, 1, savedOption)
    } else {
      nextOptions.push(savedOption)
    }

    const writeResult = await writeAtomically({
      updates: [
        {
          applianceKey,
          filePath: existingOptionsResult.filePath,
          document: {
            contractVersion: SUPPORTED_OPTION_CONTRACT_VERSION,
            appliance: applianceKey,
            options: nextOptions
          }
        }
      ],
      optionsDir,
      fsApi,
      pathApi,
      tempFileIdFactory,
      failureOptionId: savedOption.id,
      mkdirFailureApplianceKey: applianceKey
    })

    if (!writeResult.ok) {
      return createSaveFailure(writeResult.failure)
    }

    return {
      ok: true,
      option: savedOption,
      warnings: [],
      validationErrors: [],
      failure: null
    }
  }

  async function deleteOption(applianceKey, optionId) {
    const applianceFailure = validateCanonicalApplianceKey(applianceKey)
    if (applianceFailure) {
      return createDeleteFailure(applianceFailure)
    }

    if (!isNonEmptyString(optionId)) {
      return createDeleteFailure(
        createIssue(OPTION_CODES.OPTION_NOT_FOUND, applianceKey, normalizeDeleteOptionId(optionId), null)
      )
    }

    const requestedSchemaResult = await loadGatedSchema(applianceKey)
    if (!requestedSchemaResult.ok) {
      return createDeleteFailure(requestedSchemaResult.failure)
    }

    const sourceCatalogResult = await readExistingCatalog(applianceKey)
    if (!sourceCatalogResult.ok) {
      return createDeleteFailure(sourceCatalogResult.failure)
    }

    let dependentLaundrySetCatalog = null
    if (applianceKey === 'washer' || applianceKey === 'dryer') {
      const laundrySetSchemaResult = await loadGatedSchema('laundry-set', { requireLaundryPointerMetadata: true })
      if (!laundrySetSchemaResult.ok) {
        return createDeleteFailure(laundrySetSchemaResult.failure)
      }

      const laundrySetCatalogResult = await readExistingCatalog('laundry-set')
      if (!laundrySetCatalogResult.ok) {
        return createDeleteFailure(laundrySetCatalogResult.failure)
      }

      dependentLaundrySetCatalog = laundrySetCatalogResult
    }

    if (sourceCatalogResult.missing) {
      return createDeleteFailure(createIssue(OPTION_CODES.OPTION_NOT_FOUND, applianceKey, optionId, null))
    }

    const sourceOptionIndex = sourceCatalogResult.document.options.findIndex((option) => option.id === optionId)
    if (sourceOptionIndex === -1) {
      return createDeleteFailure(createIssue(OPTION_CODES.OPTION_NOT_FOUND, applianceKey, optionId, null))
    }

    const nextSourceOptions = sourceCatalogResult.document.options.filter((option) => option.id !== optionId)

    const affectedLaundrySetOptionIds = []
    let repairedLaundrySetOptions = null

    if (dependentLaundrySetCatalog && !dependentLaundrySetCatalog.missing) {
      repairedLaundrySetOptions = dependentLaundrySetCatalog.document.options.map((option) => {
        const targetEvaluation = isObjectRecord(option.evaluations)
          ? option.evaluations[applianceKey]
          : undefined

        if (isKnownPointerTargetEvaluation(targetEvaluation) && targetEvaluation.value === optionId) {
          affectedLaundrySetOptionIds.push(option.id)
          return {
            ...option,
            evaluations: {
              ...option.evaluations,
              [applianceKey]: { status: 'na' }
            }
          }
        }

        return option
      })
    }

    const updates = [
      {
        applianceKey,
        filePath: sourceCatalogResult.filePath,
        document: {
          contractVersion: SUPPORTED_OPTION_CONTRACT_VERSION,
          appliance: applianceKey,
          options: nextSourceOptions
        }
      }
    ]

    if (dependentLaundrySetCatalog && repairedLaundrySetOptions) {
      updates.push({
        applianceKey: 'laundry-set',
        filePath: dependentLaundrySetCatalog.filePath,
        document: {
          contractVersion: SUPPORTED_OPTION_CONTRACT_VERSION,
          appliance: 'laundry-set',
          options: repairedLaundrySetOptions
        }
      })
    }

    const writeResult = await writeAtomically({
      updates,
      optionsDir,
      fsApi,
      pathApi,
      tempFileIdFactory,
      failureOptionId: optionId,
      mkdirFailureApplianceKey: applianceKey
    })

    if (!writeResult.ok) {
      return createDeleteFailure(writeResult.failure)
    }

    return {
      ok: true,
      deletedOptionId: optionId,
      affectedLaundrySetOptionIds,
      repairedLaundrySetOptionIds: [...affectedLaundrySetOptionIds],
      warnings: [],
      failure: null
    }
  }

  return {
    loadOptions,
    saveOption,
    deleteOption,
    paths: {
      optionsDir
    }
  }
}

module.exports = {
  OPTION_CODES,
  SUPPORTED_OPTION_CONTRACT_VERSION,
  createOptionStorage,
  resolveLocalOptionsDir,
  resolveOptionFilePath,
  validateOptionFileDocument,
  validateSchemaDependencies
}
