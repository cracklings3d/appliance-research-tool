export const CANONICAL_APPLIANCE_KEYS = ['washer', 'dryer', 'laundry-set']

export const FALLBACK_NAVIGATION_LABELS = {
  washer: 'Washer',
  dryer: 'Dryer',
  'laundry-set': 'Laundry Set'
}

export const NA_TOKEN_CLASS_NAME = 'evaluation-token evaluation-token--na'
export const FILTER_MATCH_KIND_COMPLETE = 'complete-match'
export const FILTER_MATCH_KIND_WARNING = 'na-warning'

const VISIBLE_DIMENSION_TYPES = new Set(['boolean', 'enum', 'numeric', 'string'])

export function createNavigationItems(labels = FALLBACK_NAVIGATION_LABELS) {
  return CANONICAL_APPLIANCE_KEYS.map((key) => ({
    key,
    label: labels[key] || FALLBACK_NAVIGATION_LABELS[key]
  }))
}

export function validateElectronApi(electronApi, methodNames) {
  if (!electronApi || typeof electronApi !== 'object') {
    return {
      ok: false,
      category: 'Integration unavailable'
    }
  }

  for (const methodName of methodNames) {
    if (typeof electronApi[methodName] !== 'function') {
      return {
        ok: false,
        category: 'Integration unavailable'
      }
    }
  }

  return { ok: true }
}

export function resolveBootNavigation(discoveryEnvelope) {
  if (!discoveryEnvelope || typeof discoveryEnvelope !== 'object' || !Array.isArray(discoveryEnvelope.schemas)) {
    return {
      ok: false,
      activeKey: 'washer',
      labels: { ...FALLBACK_NAVIGATION_LABELS },
      category: 'Schema discovery unavailable'
    }
  }

  const labels = { ...FALLBACK_NAVIGATION_LABELS }
  const seenKeys = new Set()
  const discoveredKeys = new Set()

  for (const entry of discoveryEnvelope.schemas) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const { applianceKey, displayName } = entry

    if (typeof applianceKey !== 'string') {
      continue
    }

    if (!CANONICAL_APPLIANCE_KEYS.includes(applianceKey) || seenKeys.has(applianceKey)) {
      continue
    }

    seenKeys.add(applianceKey)
    discoveredKeys.add(applianceKey)

    if (typeof displayName === 'string' && displayName.trim() !== '') {
      labels[applianceKey] = displayName
    }
  }

  const activeKey = CANONICAL_APPLIANCE_KEYS.find((key) => discoveredKeys.has(key)) || 'washer'

  return {
    ok: true,
    activeKey,
    labels
  }
}

export function deriveVisibleColumns(applianceKey, schema) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.dimensions)) {
    return fail('Schema unavailable or invalid')
  }

  const seenIds = new Set()
  const columns = []

  for (const dimension of schema.dimensions) {
    if (!dimension || typeof dimension !== 'object') {
      return fail('Schema unavailable or invalid')
    }

    if (typeof dimension.id !== 'string') {
      return fail('Schema unavailable or invalid')
    }

    if (seenIds.has(dimension.id)) {
      return fail('Schema unavailable or invalid')
    }

    seenIds.add(dimension.id)

    if (isExcludedDimension(applianceKey, dimension)) {
      continue
    }

    if (typeof dimension.label !== 'string' || typeof dimension.type !== 'string' || typeof dimension.required !== 'boolean') {
      return fail('Schema unavailable or invalid')
    }

    if (!VISIBLE_DIMENSION_TYPES.has(dimension.type)) {
      return fail('Schema unavailable or invalid')
    }

    const allowedValues = deriveAllowedValues(dimension)
    if (dimension.type === 'enum' && !allowedValues) {
      return fail('Schema unavailable or invalid')
    }

    columns.push({
      id: dimension.id,
      label: dimension.label,
      type: dimension.type,
      required: dimension.required,
      unit: typeof dimension.unit === 'string' ? dimension.unit : undefined,
      allowedValues
    })
  }

  return {
    ok: true,
    columns
  }
}

export function deriveConsumableDefaultListOrder(schema, columns) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.defaultListOrder)) {
    return fail('Default list ordering unusable')
  }

  const columnsById = new Map(columns.map((column) => [column.id, column]))
  const rules = []

  for (const entry of schema.defaultListOrder) {
    if (!entry || typeof entry !== 'object') {
      return fail('Default list ordering unusable')
    }

    const { dimensionId, direction } = entry

    if (typeof dimensionId !== 'string' || (direction !== 'asc' && direction !== 'desc')) {
      return fail('Default list ordering unusable')
    }

    const column = columnsById.get(dimensionId)

    if (!column) {
      return fail('Default list ordering unusable')
    }

    rules.push({
      dimensionId,
      direction,
      type: column.type
    })
  }

  return {
    ok: true,
    rules
  }
}

export function deriveCellToken(column, evaluations) {
  if (!evaluations || typeof evaluations !== 'object') {
    return fail('Malformed Option rows')
  }

  if (!Object.prototype.hasOwnProperty.call(evaluations, column.id)) {
    if (column.required) {
      return fail('Missing required visible Evaluation data')
    }

    return {
      ok: true,
      cell: createNaCell()
    }
  }

  const evaluation = evaluations[column.id]

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

export function deriveOrderedRows(options, columns, defaultListOrder) {
  if (!Array.isArray(options)) {
    return fail('Option data unavailable or invalid')
  }

  const rows = []

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]

    if (!option || typeof option !== 'object' || !option.evaluations || typeof option.evaluations !== 'object') {
      return fail('Malformed Option rows')
    }

    const cells = columns.map((column) => {
      const result = deriveCellToken(column, option.evaluations)
      if (!result.ok) {
        return result
      }

      return {
        ok: true,
        value: {
          columnId: column.id,
          ...result.cell
        }
      }
    })

    const failure = cells.find((cellResult) => !cellResult.ok)
    if (failure) {
      return failure
    }

    rows.push({
      key: typeof option.id === 'string' && option.id.length > 0 ? option.id : `row-${index}`,
      option,
      sourceIndex: index,
      cells: cells.map((cellResult) => cellResult.value)
    })
  }

  const cellsByRowKey = new Map(
    rows.map((row) => [
      row.key,
      new Map(row.cells.map((cell) => [cell.columnId, cell]))
    ])
  )

  rows.sort((left, right) => {
    for (const rule of defaultListOrder) {
      const leftCell = cellsByRowKey.get(left.key).get(rule.dimensionId)
      const rightCell = cellsByRowKey.get(right.key).get(rule.dimensionId)
      const bucketComparison = compareBuckets(leftCell, rightCell)

      if (bucketComparison !== 0) {
        return bucketComparison
      }

      if (leftCell.kind === 'na' && rightCell.kind === 'na') {
        continue
      }

      const valueComparison = compareKnownValues(rule.type, leftCell.sortValue, rightCell.sortValue)
      if (valueComparison !== 0) {
        return rule.direction === 'asc' ? valueComparison : valueComparison * -1
      }
    }

    return left.sourceIndex - right.sourceIndex
  })

  return {
    ok: true,
    rows
  }
}

export function buildLoadSuccessView(schema, options, applianceKey) {
  const columnsResult = deriveVisibleColumns(applianceKey, schema)
  if (!columnsResult.ok) {
    return columnsResult
  }

  const orderResult = deriveConsumableDefaultListOrder(schema, columnsResult.columns)
  if (!orderResult.ok) {
    return orderResult
  }

  const rowsResult = deriveOrderedRows(options, columnsResult.columns, orderResult.rules)
  if (!rowsResult.ok) {
    return rowsResult
  }

  return {
    ok: true,
    columns: columnsResult.columns,
    rows: rowsResult.rows,
    status: rowsResult.rows.length === 0 ? 'empty' : 'ready'
  }
}

export function deriveListFilters(columns, existingFilters = []) {
  const previousById = new Map(
    (Array.isArray(existingFilters) ? existingFilters : [])
      .filter((filter) => filter && typeof filter.id === 'string')
      .map((filter) => [filter.id, filter])
  )

  return (Array.isArray(columns) ? columns : []).map((column) => createListFilter(column, previousById.get(column.id)?.draft))
}

export function patchListFilters(columns, existingFilters, update) {
  if (!update || typeof update !== 'object' || typeof update.dimensionId !== 'string') {
    return deriveListFilters(columns, existingFilters)
  }

  return deriveListFilters(columns, existingFilters).map((filter) => {
    if (filter.id !== update.dimensionId) {
      return filter
    }

    return createListFilter(resolveColumnById(columns, filter.id), {
      ...filter.draft,
      ...(update.patch && typeof update.patch === 'object' ? update.patch : {})
    })
  })
}

export function clearListFilters(columns) {
  return deriveListFilters(columns)
}

export function classifyRowAgainstFilters(row, filters) {
  const activeFilters = (Array.isArray(filters) ? filters : []).filter((filter) => filter?.isActive)

  if (activeFilters.length === 0) {
    return {
      matchKind: FILTER_MATCH_KIND_COMPLETE,
      filterWarningDimensionIds: [],
      filterWarningDimensionLabels: []
    }
  }

  const warningDimensionIds = []
  const warningDimensionLabels = []

  for (const filter of activeFilters) {
    const matchKind = classifyEvaluationAgainstFilter(row?.option?.evaluations, filter)

    if (matchKind === 'reject') {
      return {
        matchKind: 'reject',
        filterWarningDimensionIds: [],
        filterWarningDimensionLabels: []
      }
    }

    if (matchKind === 'na-keep') {
      warningDimensionIds.push(filter.id)
      warningDimensionLabels.push(filter.label)
    }
  }

  return {
    matchKind: warningDimensionIds.length > 0 ? FILTER_MATCH_KIND_WARNING : FILTER_MATCH_KIND_COMPLETE,
    filterWarningDimensionIds: warningDimensionIds,
    filterWarningDimensionLabels: warningDimensionLabels
  }
}

export function deriveVisibleRows(canonicalRows, filters) {
  const normalizedRows = Array.isArray(canonicalRows) ? canonicalRows : []
  const activeFilters = (Array.isArray(filters) ? filters : []).filter((filter) => filter?.isActive)

  if (activeFilters.length === 0) {
    return {
      rows: normalizedRows,
      hasActiveFilters: false
    }
  }

  const completeMatches = []
  const warningRows = []

  for (const row of normalizedRows) {
    const classification = classifyRowAgainstFilters(row, activeFilters)

    if (classification.matchKind === 'reject') {
      continue
    }

    const nextRow = {
      ...row,
      filterMatchKind: classification.matchKind,
      filterWarningDimensionIds: classification.filterWarningDimensionIds,
      filterWarningDimensionLabels: classification.filterWarningDimensionLabels
    }

    if (classification.matchKind === FILTER_MATCH_KIND_WARNING) {
      warningRows.push(nextRow)
      continue
    }

    completeMatches.push(nextRow)
  }

  return {
    rows: [...completeMatches, ...warningRows],
    hasActiveFilters: true
  }
}

export function isListFilterActive(filter) {
  if (!filter || typeof filter !== 'object' || typeof filter.type !== 'string') {
    return false
  }

  return isFilterDraftActive(filter.type, filter.draft)
}

function isExcludedDimension(applianceKey, dimension) {
  if (dimension.type === 'pointer') {
    return true
  }

  if (applianceKey !== 'laundry-set') {
    return false
  }

  return dimension.id === 'washer'
    || dimension.id === 'dryer'
    || dimension.id.startsWith('washer.')
    || dimension.id.startsWith('dryer.')
}

function deriveAllowedValues(dimension) {
  if (dimension.type !== 'enum') {
    return undefined
  }

  if (!Array.isArray(dimension.allowedValues) || dimension.allowedValues.length === 0) {
    return null
  }

  const seenValues = new Set()
  const allowedValues = []

  for (const value of dimension.allowedValues) {
    if (typeof value !== 'string' || seenValues.has(value)) {
      return null
    }

    seenValues.add(value)
    allowedValues.push(value)
  }

  return allowedValues
}

function createListFilter(column, draft) {
  return {
    id: column.id,
    label: column.label,
    type: column.type,
    required: column.required,
    unit: column.unit,
    allowedValues: Array.isArray(column.allowedValues) ? [...column.allowedValues] : undefined,
    draft: normalizeFilterDraft(column, draft),
    isActive: isFilterDraftActive(column.type, normalizeFilterDraft(column, draft))
  }
}

function normalizeFilterDraft(column, draft) {
  if (column.type === 'string') {
    return {
      mode: draft?.mode === 'substring' ? 'substring' : 'exact',
      value: typeof draft?.value === 'string' ? draft.value : ''
    }
  }

  if (column.type === 'enum') {
    const allowedValues = new Set(Array.isArray(column.allowedValues) ? column.allowedValues : [])
    const selectedValues = Array.isArray(draft?.selectedValues)
      ? draft.selectedValues.filter((value, index, values) => typeof value === 'string' && allowedValues.has(value) && values.indexOf(value) === index)
      : []

    return { selectedValues }
  }

  if (column.type === 'boolean') {
    return {
      value: draft?.value === true || draft?.value === false ? draft.value : null
    }
  }

  return {
    min: typeof draft?.min === 'string' ? draft.min : '',
    max: typeof draft?.max === 'string' ? draft.max : ''
  }
}

function isFilterDraftActive(type, draft) {
  if (type === 'string') {
    return typeof draft?.value === 'string' && draft.value.trim() !== ''
  }

  if (type === 'enum') {
    return Array.isArray(draft?.selectedValues) && draft.selectedValues.length > 0
  }

  if (type === 'boolean') {
    return draft?.value === true || draft?.value === false
  }

  const min = parseNumericBound(draft?.min)
  const max = parseNumericBound(draft?.max)
  return min !== null || max !== null
}

function classifyEvaluationAgainstFilter(evaluations, filter) {
  if (!evaluations || typeof evaluations !== 'object') {
    return filter.required ? 'reject' : 'na-keep'
  }

  if (!Object.prototype.hasOwnProperty.call(evaluations, filter.id)) {
    return filter.required ? 'reject' : 'na-keep'
  }

  const evaluation = evaluations[filter.id]

  if (!evaluation || typeof evaluation !== 'object') {
    return 'reject'
  }

  if (evaluation.status === 'na') {
    return 'na-keep'
  }

  if (evaluation.status !== 'known' || !isKnownValueValid(filter.type, evaluation.value)) {
    return 'reject'
  }

  return matchesKnownValue(filter, evaluation.value) ? 'known-match' : 'reject'
}

function matchesKnownValue(filter, value) {
  if (filter.type === 'string') {
    if (filter.draft.mode === 'substring') {
      return value.toLowerCase().includes(filter.draft.value.toLowerCase())
    }

    return value === filter.draft.value
  }

  if (filter.type === 'enum') {
    return filter.draft.selectedValues.includes(value)
  }

  if (filter.type === 'boolean') {
    return value === filter.draft.value
  }

  const min = parseNumericBound(filter.draft.min)
  const max = parseNumericBound(filter.draft.max)

  if (min !== null && value < min) {
    return false
  }

  if (max !== null && value > max) {
    return false
  }

  return true
}

function parseNumericBound(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : null
}

function resolveColumnById(columns, columnId) {
  return (Array.isArray(columns) ? columns : []).find((column) => column?.id === columnId)
}

function createNaCell() {
  return {
    kind: 'na',
    text: 'N/A',
    dataEvaluationState: 'na',
    className: NA_TOKEN_CLASS_NAME,
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

function compareBuckets(leftCell, rightCell) {
  if (leftCell.kind === rightCell.kind) {
    return 0
  }

  return leftCell.kind === 'known' ? -1 : 1
}

function compareKnownValues(type, leftValue, rightValue) {
  if (type === 'numeric') {
    return leftValue - rightValue
  }

  if (type === 'boolean') {
    if (leftValue === rightValue) {
      return 0
    }

    return leftValue ? 1 : -1
  }

  const leftNormalized = leftValue.toLowerCase()
  const rightNormalized = rightValue.toLowerCase()

  if (leftNormalized < rightNormalized) {
    return -1
  }

  if (leftNormalized > rightNormalized) {
    return 1
  }

  if (leftValue < rightValue) {
    return -1
  }

  if (leftValue > rightValue) {
    return 1
  }

  return 0
}

function fail(category) {
  return {
    ok: false,
    category
  }
}
