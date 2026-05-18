import {
  FALLBACK_NAVIGATION_LABELS,
  createNavigationItems,
  validateElectronApi,
  resolveBootNavigation,
  buildLoadSuccessView,
  clearListFilters,
  deriveVisibleRows,
  patchListFilters
} from './listViewModel.mjs'

export function createInitialState() {
  return {
    navigationItems: createNavigationItems(),
    activeKey: 'washer',
    view: {
      status: 'loading',
      message: 'Loading Washer…',
      columns: [],
      canonicalRows: [],
      rows: [],
      filters: [],
      hasActiveFilters: false,
      totalRowCount: 0,
      filteredRowCount: 0
    }
  }
}

export function createAppShellController({ apiProvider } = {}) {
  const provideApi = typeof apiProvider === 'function'
    ? apiProvider
    : () => (typeof window !== 'undefined' ? window.electronAPI : undefined)

  let state = createInitialState()
  let loadRequestId = 0
  let disposed = false
  const listeners = new Set()

  function emit() {
    if (disposed) {
      return
    }

    for (const listener of listeners) {
      listener(state)
    }
  }

  function setState(nextState) {
    state = nextState
    emit()
  }

  function updateNavigation(labels) {
    state = {
      ...state,
      navigationItems: createNavigationItems(labels)
    }
    emit()
  }

  async function boot() {
    const electronApi = provideApi()
    const apiValidation = validateElectronApi(electronApi, ['listSchemas', 'loadSchema', 'loadOptions'])

    if (!apiValidation.ok) {
      setErrorState('washer', apiValidation.category, { labels: { ...FALLBACK_NAVIGATION_LABELS } })
      return state
    }

    let discoveryResult

    try {
      discoveryResult = await electronApi.listSchemas()
    } catch (_error) {
      setErrorState('washer', 'Schema discovery unavailable', { labels: { ...FALLBACK_NAVIGATION_LABELS } })
      return state
    }

    const navigationResult = resolveBootNavigation(discoveryResult)

    if (!navigationResult.ok) {
      setErrorState('washer', navigationResult.category, { labels: navigationResult.labels })
      return state
    }

    updateNavigation(navigationResult.labels)
    await loadAppliance(navigationResult.activeKey)
    return state
  }

  async function selectAppliance(applianceKey) {
    if (applianceKey === state.activeKey && state.view.status !== 'error') {
      return state
    }

    await loadAppliance(applianceKey)
    return state
  }

  async function retry() {
    await loadAppliance(state.activeKey)
    return state
  }

  function updateFilters(update) {
    if (!state.view || (state.view.status !== 'ready' && state.view.status !== 'empty')) {
      return state
    }

    const filters = patchListFilters(state.view.columns, state.view.filters, update)
    const visibleRowsResult = deriveVisibleRows(state.view.canonicalRows, filters)
    const hasRows = state.view.canonicalRows.length > 0

    setState({
      ...state,
      view: {
        ...state.view,
        status: hasRows ? 'ready' : 'empty',
        message: deriveReadyMessage({
          activeLabel: resolveActiveLabel(state.activeKey),
          totalRowCount: state.view.canonicalRows.length,
          visibleRowCount: visibleRowsResult.rows.length,
          hasActiveFilters: visibleRowsResult.hasActiveFilters
        }),
        rows: visibleRowsResult.rows,
        filters,
        hasActiveFilters: visibleRowsResult.hasActiveFilters,
        totalRowCount: state.view.canonicalRows.length,
        filteredRowCount: visibleRowsResult.rows.length
      }
    })

    return state
  }

  async function loadAppliance(applianceKey) {
    const electronApi = provideApi()
    const apiValidation = validateElectronApi(electronApi, ['loadSchema', 'loadOptions'])
    const isSameApplianceReload = applianceKey === state.activeKey
    const previousFilters = isSameApplianceReload ? state.view.filters : []

    if (!apiValidation.ok) {
      setErrorState(applianceKey, apiValidation.category)
      return state
    }

    const requestId = loadRequestId + 1
    loadRequestId = requestId

    setState({
      ...state,
      activeKey: applianceKey,
      view: {
        status: 'loading',
        message: `Loading ${resolveActiveLabel(applianceKey)}…`,
        columns: [],
        canonicalRows: [],
        rows: [],
        filters: [],
        hasActiveFilters: false,
        totalRowCount: 0,
        filteredRowCount: 0
      }
    })

    let schemaResult

    try {
      schemaResult = await electronApi.loadSchema(applianceKey)
    } catch (_error) {
      if (isStale(requestId)) {
        return state
      }

      setErrorState(applianceKey, 'Schema unavailable or invalid')
      return state
    }

    if (isStale(requestId)) {
      return state
    }

    if (!schemaResult || typeof schemaResult !== 'object' || schemaResult.ok !== true || !schemaResult.schema || typeof schemaResult.schema !== 'object') {
      setErrorState(applianceKey, 'Schema unavailable or invalid')
      return state
    }

    let optionsResult

    try {
      optionsResult = await electronApi.loadOptions(applianceKey)
    } catch (_error) {
      if (isStale(requestId)) {
        return state
      }

      setErrorState(applianceKey, 'Option data unavailable or invalid')
      return state
    }

    if (isStale(requestId)) {
      return state
    }

    if (!optionsResult || typeof optionsResult !== 'object' || optionsResult.ok !== true || !Array.isArray(optionsResult.options)) {
      setErrorState(applianceKey, 'Option data unavailable or invalid')
      return state
    }

    const supportingDataResult = await loadSupportingData({
      electronApi,
      applianceKey,
      isStale: () => isStale(requestId)
    })
    if (!supportingDataResult.ok) {
      if (supportingDataResult.stale) {
        return state
      }

      setErrorState(applianceKey, supportingDataResult.category)
      return state
    }

    const viewResult = buildLoadSuccessView(
      schemaResult.schema,
      optionsResult.options,
      applianceKey,
      supportingDataResult.supportingData
    )

    if (!viewResult.ok) {
      setErrorState(applianceKey, viewResult.category)
      return state
    }

    const filters = isSameApplianceReload
      ? patchListFilters(viewResult.columns, previousFilters, {})
      : clearListFilters(viewResult.columns)
    const visibleRowsResult = deriveVisibleRows(viewResult.rows, filters)

    setState({
      ...state,
      activeKey: applianceKey,
      view: {
        status: viewResult.status,
        message: deriveReadyMessage({
          activeLabel: resolveActiveLabel(applianceKey),
          totalRowCount: viewResult.rows.length,
          visibleRowCount: visibleRowsResult.rows.length,
          hasActiveFilters: visibleRowsResult.hasActiveFilters
        }),
        columns: viewResult.columns,
        canonicalRows: viewResult.rows,
        rows: visibleRowsResult.rows,
        filters,
        hasActiveFilters: visibleRowsResult.hasActiveFilters,
        totalRowCount: viewResult.rows.length,
        filteredRowCount: visibleRowsResult.rows.length
      }
    })

    return state
  }

  function setErrorState(applianceKey, category, { labels } = {}) {
    const nextLabels = labels || Object.fromEntries(state.navigationItems.map((item) => [item.key, item.label]))

    setState({
      navigationItems: createNavigationItems(nextLabels),
      activeKey: applianceKey,
      view: {
        status: 'error',
        message: `${resolveLabelFromItems(createNavigationItems(nextLabels), applianceKey)} could not be loaded. ${category}.`,
        columns: [],
        canonicalRows: [],
        rows: [],
        filters: [],
        hasActiveFilters: false,
        totalRowCount: 0,
        filteredRowCount: 0
      }
    })
  }

  function resolveActiveLabel(applianceKey) {
    return resolveLabelFromItems(state.navigationItems, applianceKey)
  }

  function isStale(requestId) {
    return disposed || requestId !== loadRequestId
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      listener(state)

      return () => {
        listeners.delete(listener)
      }
    },
    getState() {
      return state
    },
    boot,
    selectAppliance,
    retry,
    updateFilters,
    dispose() {
      disposed = true
      loadRequestId += 1
      listeners.clear()
    }
  }
}

async function loadSupportingData({ electronApi, applianceKey, isStale }) {
  if (applianceKey !== 'laundry-set') {
    return {
      ok: true,
      supportingData: null
    }
  }

  try {
    const [washerSchemaResult, washerOptionsResult, dryerSchemaResult, dryerOptionsResult] = await Promise.all([
      loadSupportingSchema(electronApi, 'washer'),
      loadSupportingOptions(electronApi, 'washer'),
      loadSupportingSchema(electronApi, 'dryer'),
      loadSupportingOptions(electronApi, 'dryer')
    ])

    if (typeof isStale === 'function' && isStale()) {
      return { ok: false, stale: true }
    }

    return {
      ok: true,
      supportingData: {
        washer: {
          schemaAvailable: washerSchemaResult.ok,
          schema: washerSchemaResult.ok ? washerSchemaResult.schema : null,
          optionsAvailable: washerOptionsResult.ok,
          options: washerOptionsResult.ok ? washerOptionsResult.options : []
        },
        dryer: {
          schemaAvailable: dryerSchemaResult.ok,
          schema: dryerSchemaResult.ok ? dryerSchemaResult.schema : null,
          optionsAvailable: dryerOptionsResult.ok,
          options: dryerOptionsResult.ok ? dryerOptionsResult.options : []
        }
      }
    }
  } catch (_error) {
    return {
      ok: true,
      supportingData: {
        washer: {
          schemaAvailable: false,
          schema: null,
          optionsAvailable: false,
          options: []
        },
        dryer: {
          schemaAvailable: false,
          schema: null,
          optionsAvailable: false,
          options: []
        }
      }
    }
  }
}

async function loadSupportingSchema(electronApi, applianceKey) {
  try {
    const result = await electronApi.loadSchema(applianceKey)
    return isValidSchemaEnvelope(result)
      ? { ok: true, schema: result.schema }
      : fail('Schema unavailable or invalid')
  } catch (_error) {
    return fail('Schema unavailable or invalid')
  }
}

async function loadSupportingOptions(electronApi, applianceKey) {
  try {
    const result = await electronApi.loadOptions(applianceKey)
    return isValidOptionsEnvelope(result)
      ? { ok: true, options: result.options }
      : fail('Option data unavailable or invalid')
  } catch (_error) {
    return fail('Option data unavailable or invalid')
  }
}

function isValidSchemaEnvelope(result) {
  return result && typeof result === 'object' && result.ok === true && result.schema && typeof result.schema === 'object'
}

function isValidOptionsEnvelope(result) {
  return result && typeof result === 'object' && result.ok === true && Array.isArray(result.options)
}

function fail(category) {
  return {
    ok: false,
    category
  }
}

function resolveLabelFromItems(items, applianceKey) {
  const item = items.find((entry) => entry.key === applianceKey)
  return item ? item.label : FALLBACK_NAVIGATION_LABELS[applianceKey] || applianceKey
}

function deriveReadyMessage({ activeLabel, totalRowCount, visibleRowCount, hasActiveFilters }) {
  if (totalRowCount === 0) {
    return `No Options available for ${activeLabel} yet.`
  }

  if (hasActiveFilters && visibleRowCount === 0) {
    return `No visible Options match the active Dimension filters for ${activeLabel}.`
  }

  return ''
}
