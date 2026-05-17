const SUPPORTED_APPLIANCE_KEYS = ['washer', 'dryer', 'laundry-set']
const SUPPORTED_DIMENSION_TYPES = new Set(['boolean', 'enum', 'numeric', 'pointer', 'string'])

function deriveEditableFields(schema) {
  const dimensions = Array.isArray(schema?.dimensions) ? schema.dimensions : []

  return dimensions
    .filter((dimension) => (
      dimension
      && typeof dimension.id === 'string'
      && !dimension.id.includes('.')
      && SUPPORTED_DIMENSION_TYPES.has(dimension.type)
    ))
    .map((dimension) => ({
      id: dimension.id,
      label: typeof dimension.label === 'string' && dimension.label.trim().length ? dimension.label : dimension.id,
      type: dimension.type,
      required: Boolean(dimension.required),
      allowedValues: Array.isArray(dimension.allowedValues) ? [...dimension.allowedValues] : [],
      unit: typeof dimension.unit === 'string' ? dimension.unit : null,
      targetAppliance: typeof dimension.targetAppliance === 'string' ? dimension.targetAppliance : null
    }))
}

function createCrudViewState(options = []) {
  return {
    settledOptions: cloneValue(options) ?? [],
    session: null,
    isRefreshingAfterSave: false
  }
}

function beginCreateSession(state, fields) {
  return {
    ...state,
    session: {
      mode: 'create',
      optionId: null,
      draft: createEmptyDraft(fields)
    },
    isRefreshingAfterSave: false
  }
}

function beginEditSession(state, fields, option) {
  return {
    ...state,
    session: {
      mode: 'edit',
      optionId: option?.id ?? null,
      draft: createDraftFromOption(fields, option)
    },
    isRefreshingAfterSave: false
  }
}

function cancelSession(state) {
  return {
    ...state,
    session: null,
    isRefreshingAfterSave: false
  }
}

function updateSessionDraft(state, dimensionId, patch) {
  if (!state?.session || !dimensionId || !patch) {
    return state
  }

  const nextDraft = cloneValue(state.session.draft) ?? {}
  const currentEntry = nextDraft[dimensionId] ?? { status: 'known', value: '' }
  nextDraft[dimensionId] = {
    ...currentEntry,
    ...patch
  }

  return {
    ...state,
    session: {
      ...state.session,
      draft: nextDraft
    }
  }
}

function markSaveSuccessPendingReload(state) {
  return {
    ...state,
    isRefreshingAfterSave: true
  }
}

function applyReloadedOptions(state, options) {
  return {
    ...state,
    settledOptions: cloneValue(options) ?? [],
    session: null,
    isRefreshingAfterSave: false
  }
}

function createEmptyDraft(fields) {
  return Object.fromEntries((fields ?? []).map((field) => [field.id, createEmptyDraftEntry(field)]))
}

function createDraftFromOption(fields, option) {
  const draft = createEmptyDraft(fields)
  const evaluations = option?.evaluations ?? {}

  for (const field of fields ?? []) {
    const evaluation = evaluations[field.id]

    if (!evaluation || typeof evaluation !== 'object') {
      continue
    }

    if (evaluation.status === 'na' && field.type !== 'pointer') {
      draft[field.id] = {
        status: 'na',
        value: createEmptyDraftEntry(field).value
      }
      continue
    }

    if (evaluation.status === 'known') {
      draft[field.id] = {
        status: 'known',
        value: formatDraftValue(field, evaluation.value)
      }
    }
  }

  return draft
}

function buildOptionPayload({ fields, draft, optionId }) {
  const payload = {
    evaluations: {}
  }

  if (typeof optionId === 'string' && optionId.length) {
    payload.id = optionId
  }

  for (const field of fields ?? []) {
    const entry = draft?.[field.id] ?? createEmptyDraftEntry(field)
    const evaluation = createEvaluationFromDraft(field, entry)

    if (evaluation) {
      payload.evaluations[field.id] = evaluation
    }
  }

  return payload
}

function groupValidationErrors(entries) {
  const fieldErrorsByDimensionId = {}
  const formErrors = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry?.dimensionId === 'string' && entry.dimensionId.length) {
      if (!fieldErrorsByDimensionId[entry.dimensionId]) {
        fieldErrorsByDimensionId[entry.dimensionId] = []
      }

      fieldErrorsByDimensionId[entry.dimensionId].push(entry)
      continue
    }

    formErrors.push(entry)
  }

  return {
    fieldErrorsByDimensionId,
    formErrors
  }
}

function getDeleteImpact(applianceKey, optionId, laundrySetOptions) {
  if ((applianceKey !== 'washer' && applianceKey !== 'dryer') || typeof optionId !== 'string' || !optionId.length) {
    return []
  }

  return (Array.isArray(laundrySetOptions) ? laundrySetOptions : [])
    .filter((option) => option?.evaluations?.[applianceKey]?.status === 'known' && option.evaluations[applianceKey].value === optionId)
    .map((option) => option.id)
}

function buildDeleteConfirmationMessage({ applianceKey, optionLabel, affectedLaundrySetOptionIds }) {
  const label = optionLabel || 'this Option'

  if (applianceKey === 'laundry-set') {
    return `Delete ${label}? Only the selected Laundry Set Option will be removed. No Washer or Dryer Options will be deleted or modified.`
  }

  const affectedCount = Array.isArray(affectedLaundrySetOptionIds) ? affectedLaundrySetOptionIds.length : 0
  const applianceLabel = applianceKey === 'washer' ? 'Washer' : 'Dryer'

  if (!affectedCount) {
    return `Delete ${label}? This removes only the selected ${applianceLabel} Option.`
  }

  return `Delete ${label}? ${affectedCount} Laundry Set Option${affectedCount === 1 ? '' : 's'} still reference this ${applianceLabel.toLowerCase()}. Their ${applianceLabel.toLowerCase()} pointer will be cleared and those Laundry Set Options will become incomplete.`
}

function getOptionDisplayLabel(option) {
  const brand = getKnownStringValue(option, 'brand')
  const model = getKnownStringValue(option, 'model')

  if (brand && model) {
    return `${brand} ${model}`
  }

  return option?.id ?? 'Unknown Option'
}

function createPointerChoices(options) {
  return (Array.isArray(options) ? options : []).map((option) => ({
    value: option.id,
    label: getOptionDisplayLabel(option)
  }))
}

function createEmptyDraftEntry(field) {
  switch (field?.type) {
    case 'boolean':
      return { status: 'known', value: null }
    default:
      return { status: 'known', value: '' }
  }
}

function formatDraftValue(field, value) {
  switch (field?.type) {
    case 'boolean':
      return value === true || value === false ? value : null
    case 'numeric':
      return value === null || value === undefined ? '' : String(value)
    case 'enum':
    case 'pointer':
    case 'string':
    default:
      return value === null || value === undefined ? '' : String(value)
  }
}

function createEvaluationFromDraft(field, entry) {
  if (field?.type !== 'pointer' && entry?.status === 'na') {
    return { status: 'na' }
  }

  switch (field?.type) {
    case 'numeric': {
      const rawValue = typeof entry?.value === 'string' ? entry.value.trim() : ''

      if (!rawValue.length) {
        return null
      }

      const numericValue = Number(rawValue)
      return {
        status: 'known',
        value: Number.isFinite(numericValue) ? numericValue : entry.value
      }
    }
    case 'boolean':
      if (entry?.value !== true && entry?.value !== false) {
        return null
      }

      return {
        status: 'known',
        value: entry.value
      }
    case 'enum':
    case 'pointer':
    case 'string': {
      const rawValue = typeof entry?.value === 'string' ? entry.value.trim() : ''

      if (!rawValue.length) {
        return null
      }

      return {
        status: 'known',
        value: rawValue
      }
    }
    default:
      return null
  }
}

function getKnownStringValue(option, dimensionId) {
  const evaluation = option?.evaluations?.[dimensionId]

  if (evaluation?.status !== 'known' || typeof evaluation.value !== 'string') {
    return null
  }

  const trimmedValue = evaluation.value.trim()
  return trimmedValue.length ? trimmedValue : null
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined
  }

  return JSON.parse(JSON.stringify(value))
}

export default {
  SUPPORTED_APPLIANCE_KEYS,
  applyReloadedOptions,
  beginCreateSession,
  beginEditSession,
  buildDeleteConfirmationMessage,
  buildOptionPayload,
  cancelSession,
  createCrudViewState,
  createPointerChoices,
  deriveEditableFields,
  getDeleteImpact,
  getOptionDisplayLabel,
  groupValidationErrors,
  markSaveSuccessPendingReload,
  updateSessionDraft
}
