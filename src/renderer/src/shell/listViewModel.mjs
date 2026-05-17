export const CANONICAL_APPLIANCE_KEYS = ['washer', 'dryer', 'laundry-set']

export const FALLBACK_NAVIGATION_LABELS = {
  washer: 'Washer',
  dryer: 'Dryer',
  'laundry-set': 'Laundry Set'
}

export const NA_TOKEN_CLASS_NAME = 'evaluation-token evaluation-token--na'

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

    columns.push({
      id: dimension.id,
      label: dimension.label,
      type: dimension.type,
      required: dimension.required,
      unit: typeof dimension.unit === 'string' ? dimension.unit : undefined
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
