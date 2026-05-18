const SUPPORTED_VISIBLE_DIMENSION_TYPES = new Set(['boolean', 'enum', 'numeric', 'string'])
const POINTER_KEYS = ['washer', 'dryer']

export function createLaundrySetResolutionContext(dependencies) {
  if (!dependencies || typeof dependencies !== 'object') {
    return fail('Schema unavailable or invalid')
  }

  const targets = {}

  for (const pointerKey of POINTER_KEYS) {
    const target = dependencies[pointerKey]
    if (!target || typeof target !== 'object') {
      return fail('Schema unavailable or invalid')
    }

    const schemaIndexResult = indexTargetSchema(target.schema)
    if (!schemaIndexResult.ok) {
      return schemaIndexResult
    }

    const optionsIndexResult = indexTargetOptions(target.options)
    if (!optionsIndexResult.ok) {
      return optionsIndexResult
    }

    targets[pointerKey] = {
      dimensionsById: schemaIndexResult.dimensionsById,
      optionsById: optionsIndexResult.optionsById
    }
  }

  return {
    ok: true,
    targets
  }
}

export function resolveLaundrySetColumn(dimension, resolutionContext) {
  const delegatedReference = parseDelegatedDimensionId(dimension.id)

  if (!delegatedReference) {
    return {
      ok: true,
      column: createDirectColumn(dimension)
    }
  }

  const target = resolutionContext.targets[delegatedReference.pointerKey]
  const targetDimension = target.dimensionsById.get(delegatedReference.dimensionId)

  if (!targetDimension || !SUPPORTED_VISIBLE_DIMENSION_TYPES.has(targetDimension.type)) {
    return fail('Schema unavailable or invalid')
  }

  if (targetDimension.type !== dimension.type) {
    return fail('Schema unavailable or invalid')
  }

  return {
    ok: true,
    column: {
      id: dimension.id,
      label: dimension.label,
      type: targetDimension.type,
      required: dimension.required,
      unit: targetDimension.unit,
      delegated: {
        pointerKey: delegatedReference.pointerKey,
        dimensionId: delegatedReference.dimensionId
      }
    }
  }
}

export function deriveLaundrySetRow(option, columns, resolutionContext) {
  if (!option || typeof option !== 'object' || !option.evaluations || typeof option.evaluations !== 'object') {
    return fail('Malformed Option rows')
  }

  const pointerStates = Object.fromEntries(
    POINTER_KEYS.map((pointerKey) => [pointerKey, resolvePointerState(option.evaluations[pointerKey], resolutionContext.targets[pointerKey].optionsById)])
  )
  const unresolvedReferences = POINTER_KEYS.filter((pointerKey) => pointerStates[pointerKey].status !== 'resolved')
  const cells = []

  for (const column of columns) {
    const cellResult = column.delegated
      ? deriveDelegatedCellToken(column, pointerStates[column.delegated.pointerKey])
      : deriveDirectCellToken(column, option.evaluations)

    if (!cellResult.ok) {
      return cellResult
    }

    cells.push({
      columnId: column.id,
      ...cellResult.cell
    })
  }

  return {
    ok: true,
    row: {
      key: typeof option.id === 'string' && option.id.length > 0 ? option.id : null,
      option,
      cells,
      isIncomplete: unresolvedReferences.length > 0,
      warning: unresolvedReferences.length > 0
        ? createIncompleteWarning(unresolvedReferences)
        : null
    }
  }
}

export function parseDelegatedDimensionId(dimensionId) {
  if (typeof dimensionId !== 'string') {
    return null
  }

  const separatorIndex = dimensionId.indexOf('.')
  if (separatorIndex <= 0) {
    return null
  }

  const pointerKey = dimensionId.slice(0, separatorIndex)
  const delegatedDimensionId = dimensionId.slice(separatorIndex + 1)

  if (!POINTER_KEYS.includes(pointerKey) || delegatedDimensionId === '') {
    return null
  }

  return {
    pointerKey,
    dimensionId: delegatedDimensionId
  }
}

function indexTargetSchema(schema) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.dimensions)) {
    return fail('Schema unavailable or invalid')
  }

  const dimensionsById = new Map()

  for (const dimension of schema.dimensions) {
    if (
      !dimension
      || typeof dimension !== 'object'
      || typeof dimension.id !== 'string'
      || typeof dimension.label !== 'string'
      || typeof dimension.type !== 'string'
      || typeof dimension.required !== 'boolean'
      || dimensionsById.has(dimension.id)
    ) {
      return fail('Schema unavailable or invalid')
    }

    dimensionsById.set(dimension.id, {
      id: dimension.id,
      label: dimension.label,
      type: dimension.type,
      required: dimension.required,
      unit: typeof dimension.unit === 'string' ? dimension.unit : undefined
    })
  }

  return {
    ok: true,
    dimensionsById
  }
}

function indexTargetOptions(options) {
  if (!Array.isArray(options)) {
    return fail('Option data unavailable or invalid')
  }

  const optionsById = new Map()

  for (const option of options) {
    if (
      !option
      || typeof option !== 'object'
      || typeof option.id !== 'string'
      || option.id === ''
      || !option.evaluations
      || typeof option.evaluations !== 'object'
      || optionsById.has(option.id)
    ) {
      return fail('Option data unavailable or invalid')
    }

    optionsById.set(option.id, option)
  }

  return {
    ok: true,
    optionsById
  }
}

function resolvePointerState(evaluation, optionsById) {
  if (!evaluation || typeof evaluation !== 'object') {
    return { status: 'unresolved' }
  }

  if (evaluation.status === 'na') {
    return { status: 'unresolved' }
  }

  if (evaluation.status !== 'known' || typeof evaluation.value !== 'string' || evaluation.value === '') {
    return { status: 'unresolved' }
  }

  const targetOption = optionsById.get(evaluation.value)

  if (!targetOption) {
    return { status: 'unresolved' }
  }

  return {
    status: 'resolved',
    option: targetOption
  }
}

function deriveDirectCellToken(column, evaluations) {
  if (!Object.prototype.hasOwnProperty.call(evaluations, column.id)) {
    if (column.required) {
      return fail('Missing required visible Evaluation data')
    }

    return {
      ok: true,
      cell: createNaCell()
    }
  }

  return deriveEvaluationCellToken(column, evaluations[column.id])
}

function deriveDelegatedCellToken(column, pointerState) {
  if (pointerState.status !== 'resolved') {
    return {
      ok: true,
      cell: createNaCell()
    }
  }

  const targetEvaluations = pointerState.option.evaluations

  if (!Object.prototype.hasOwnProperty.call(targetEvaluations, column.delegated.dimensionId)) {
    return {
      ok: true,
      cell: createNaCell()
    }
  }

  return deriveEvaluationCellToken(column, targetEvaluations[column.delegated.dimensionId], { allowMissingKnown: true })
}

function deriveEvaluationCellToken(column, evaluation) {
  if (!evaluation || typeof evaluation !== 'object') {
    return fail('Malformed visible Evaluation data')
  }

  if (evaluation.status === 'na') {
    return {
      ok: true,
      cell: createNaCell()
    }
  }

  if (evaluation.status !== 'known') {
    return fail('Malformed visible Evaluation data')
  }

  if (!isKnownValueValid(column.type, evaluation.value)) {
    return fail('Malformed visible Evaluation data')
  }

  return {
    ok: true,
    cell: createKnownCell(column, evaluation.value)
  }
}

function createDirectColumn(dimension) {
  return {
    id: dimension.id,
    label: dimension.label,
    type: dimension.type,
    required: dimension.required,
    unit: typeof dimension.unit === 'string' ? dimension.unit : undefined,
    delegated: null
  }
}

function createIncompleteWarning(unresolvedReferences) {
  const label = unresolvedReferences.join(' and ')

  return {
    text: 'Warning',
    title: `Warning: Missing delegated reference for ${label}.`,
    missingReferences: [...unresolvedReferences]
  }
}

function createNaCell() {
  return {
    kind: 'na',
    text: 'N/A',
    dataEvaluationState: 'na',
    className: 'evaluation-token evaluation-token--na',
    sortValue: null
  }
}

function createKnownCell(column, value) {
  return {
    kind: 'known',
    text: renderKnownValue(column, value),
    sortValue: value
  }
}

function renderKnownValue(column, value) {
  if (column.type === 'boolean') {
    return value ? 'True' : 'False'
  }

  if (column.type === 'numeric') {
    return column.unit ? `${value} ${column.unit}` : String(value)
  }

  return value
}

function isKnownValueValid(type, value) {
  if (type === 'numeric') {
    return typeof value === 'number' && Number.isFinite(value)
  }

  if (type === 'boolean') {
    return typeof value === 'boolean'
  }

  if (type === 'string' || type === 'enum') {
    return typeof value === 'string'
  }

  return false
}

function fail(category) {
  return {
    ok: false,
    category
  }
}
