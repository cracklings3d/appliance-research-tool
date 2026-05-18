import {
  FALLBACK_NAVIGATION_LABELS,
  NA_TOKEN_CLASS_NAME,
  validateElectronApi
} from '../shell/listViewModel.mjs'
import {
  createAppShellController,
  createInitialState as createInitialShellState
} from '../shell/appShellController.mjs'

const EMPTY_CELL_TEXT = '—'
const EMPTY_PRESET_LOAD_MESSAGE = 'Comparison presets could not be loaded.'
const EMPTY_PRESET_ACTION_MESSAGE = 'Comparison preset action failed.'

export function createInitialState() {
  const shellState = createInitialShellState()

  return {
    navigationItems: shellState.navigationItems,
    activeKey: shellState.activeKey,
    view: shellState.view,
    comparison: createEmptyComparisonState({
      status: 'loading',
      presetLoadStatus: 'idle'
    })
  }
}

export function createComparisonWorkspaceController({ apiProvider, shellController } = {}) {
  const provideApi = typeof apiProvider === 'function'
    ? apiProvider
    : () => (typeof window !== 'undefined' ? window.electronAPI : undefined)
  const ownsShellController = !shellController
  const integratedShellController = shellController || createAppShellController({ apiProvider })

  let state = createInitialState()
  let requestId = 0
  let disposed = false
  let workspaceData = createEmptyWorkspaceData()
  const listeners = new Set()
  let shellUnsubscribe = () => {}
  let comparisonSyncPromise = Promise.resolve(state)

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

  function mirrorShellState(shellState) {
    state = {
      ...state,
      navigationItems: Array.isArray(shellState?.navigationItems)
        ? shellState.navigationItems
        : state.navigationItems,
      activeKey: typeof shellState?.activeKey === 'string'
        ? shellState.activeKey
        : state.activeKey,
      view: shellState?.view && typeof shellState.view === 'object'
        ? shellState.view
        : state.view
    }

    emit()
  }

  function getApi(methodNames) {
    const electronApi = provideApi()
    const validation = validateElectronApi(electronApi, methodNames)

    if (!validation.ok) {
      return {
        ok: false,
        category: validation.category,
        api: null
      }
    }

    return {
      ok: true,
      api: electronApi
    }
  }

  async function boot() {
    if (typeof integratedShellController.boot === 'function') {
      await integratedShellController.boot()
      await comparisonSyncPromise
    }

    return state
  }

  async function selectAppliance(applianceKey) {
    if (typeof integratedShellController.selectAppliance === 'function') {
      await integratedShellController.selectAppliance(applianceKey)
      await comparisonSyncPromise
    }

    return state
  }

  async function retry() {
    if (typeof integratedShellController.retry === 'function') {
      await integratedShellController.retry()
      await comparisonSyncPromise
    }

    return state
  }

  async function updateFilters(update) {
    if (typeof integratedShellController.updateFilters === 'function') {
      await integratedShellController.updateFilters(update)
      await comparisonSyncPromise
    }

    return state
  }

  async function retryPresetLoad() {
    if (!workspaceData.schema || workspaceData.activeKey !== state.activeKey) {
      return state
    }

    updateComparisonState({
      presetLoadStatus: 'loading',
      presetLoadMessage: '',
      presetActionError: ''
    })

    const currentRequestId = requestId
    await loadPresetsForActiveAppliance(currentRequestId, state.activeKey)
    return state
  }

  function toggleOptionSelection(optionId) {
    if (typeof optionId !== 'string' || optionId === '') {
      return state
    }

    const availableIds = new Set(workspaceData.orderedOptions.map((option) => option.id).filter((id) => typeof id === 'string'))
    if (!availableIds.has(optionId)) {
      return state
    }

    const selectedOptionIds = state.comparison.selectedOptionIds.includes(optionId)
      ? state.comparison.selectedOptionIds.filter((candidate) => candidate !== optionId)
      : [...state.comparison.selectedOptionIds, optionId]

    updateComparisonState({ selectedOptionIds })
    return state
  }

  function addComparedDimension(dimensionKey) {
    if (typeof dimensionKey !== 'string' || dimensionKey === '') {
      return state
    }

    const availableDimensionIds = new Set(workspaceData.availableDimensions.map((dimension) => dimension.id))
    if (!availableDimensionIds.has(dimensionKey) || state.comparison.comparedDimensionKeys.includes(dimensionKey)) {
      return state
    }

    updateComparisonState({
      comparedDimensionKeys: [...state.comparison.comparedDimensionKeys, dimensionKey],
      appliedPresetId: null,
      appliedPresetWarning: null
    })
    return state
  }

  function removeComparedDimension(dimensionKey) {
    if (typeof dimensionKey !== 'string' || dimensionKey === '') {
      return state
    }

    if (!state.comparison.comparedDimensionKeys.includes(dimensionKey)) {
      return state
    }

    updateComparisonState({
      comparedDimensionKeys: state.comparison.comparedDimensionKeys.filter((candidate) => candidate !== dimensionKey),
      appliedPresetId: null,
      appliedPresetWarning: null
    })
    return state
  }

  function applyPreset(presetId) {
    const preset = state.comparison.presets.find((candidate) => candidate.id === presetId)
    if (!preset) {
      return state
    }

    const comparedDimensionKeys = filterComparisonDimensionKeys(
      preset.effectiveDimensionKeys,
      workspaceData.availableDimensions
    )

    updateComparisonState({
      comparedDimensionKeys,
      appliedPresetId: preset.id,
      appliedPresetWarning: createAppliedPresetWarning(preset),
      presetActionError: '',
      presetSaveValidationErrors: []
    })
    return state
  }

  function setPresetSaveName(name) {
    updateComparisonState({
      presetSaveName: typeof name === 'string' ? name : '',
      presetSaveValidationErrors: []
    })
    return state
  }

  async function savePreset() {
    const trimmedName = state.comparison.presetSaveName.trim()
    if (trimmedName === '') {
      updateComparisonState({
        presetSaveValidationErrors: [{ message: 'Preset name is required.' }],
        presetActionError: ''
      })
      return state
    }

    const apiResult = getApi(['savePreset'])
    if (!apiResult.ok) {
      updateComparisonState({
        presetActionError: apiResult.category,
        presetSaveValidationErrors: []
      })
      return state
    }

    let response
    try {
      response = await apiResult.api.savePreset(state.activeKey, {
        name: trimmedName,
        dimensionKeys: [...state.comparison.comparedDimensionKeys]
      })
    } catch (_error) {
      updateComparisonState({
        presetActionError: EMPTY_PRESET_ACTION_MESSAGE,
        presetSaveValidationErrors: []
      })
      return state
    }

    if (!response || typeof response !== 'object') {
      updateComparisonState({
        presetActionError: EMPTY_PRESET_ACTION_MESSAGE,
        presetSaveValidationErrors: []
      })
      return state
    }

    if (response.ok !== true) {
      if (Array.isArray(response.validationErrors) && response.validationErrors.length > 0) {
        updateComparisonState({
          presetSaveValidationErrors: response.validationErrors,
          presetActionError: ''
        })
        return state
      }

      updateComparisonState({
        presetActionError: response.failure?.message || EMPTY_PRESET_ACTION_MESSAGE,
        presetSaveValidationErrors: []
      })
      return state
    }

    if (!response.preset || typeof response.preset !== 'object') {
      updateComparisonState({
        presetActionError: EMPTY_PRESET_ACTION_MESSAGE,
        presetSaveValidationErrors: []
      })
      return state
    }

    const normalizedPreset = normalizePresetRecord(response.preset)
    const nextPresets = upsertPreset(state.comparison.presets, normalizedPreset)

    updateComparisonState({
      presets: nextPresets,
      presetActionError: '',
      presetSaveValidationErrors: [],
      presetSaveName: ''
    })
    return state
  }

  async function deletePreset(presetId) {
    const apiResult = getApi(['deletePreset'])
    if (!apiResult.ok) {
      updateComparisonState({
        presetActionError: apiResult.category,
        presetSaveValidationErrors: []
      })
      return state
    }

    let response
    try {
      response = await apiResult.api.deletePreset(state.activeKey, presetId)
    } catch (_error) {
      updateComparisonState({
        presetActionError: EMPTY_PRESET_ACTION_MESSAGE,
        presetSaveValidationErrors: []
      })
      return state
    }

    if (!response || typeof response !== 'object' || response.ok !== true || typeof response.deletedPresetId !== 'string') {
      updateComparisonState({
        presetActionError: response?.failure?.message || EMPTY_PRESET_ACTION_MESSAGE,
        presetSaveValidationErrors: []
      })
      return state
    }

    const nextPresets = state.comparison.presets.filter((preset) => preset.id !== response.deletedPresetId)
    const wasApplied = state.comparison.appliedPresetId === response.deletedPresetId

    updateComparisonState({
      presets: nextPresets,
      appliedPresetId: wasApplied ? null : state.comparison.appliedPresetId,
      appliedPresetWarning: wasApplied ? null : state.comparison.appliedPresetWarning,
      presetActionError: '',
      presetSaveValidationErrors: []
    })
    return state
  }

  async function syncComparisonFromShell(shellState) {
    const applianceKey = typeof shellState?.activeKey === 'string'
      ? shellState.activeKey
      : state.activeKey
    const viewStatus = shellState?.view?.status
    const nextRequestId = requestId + 1
    requestId = nextRequestId

    if (viewStatus === 'loading') {
      const resetComparison = applianceKey !== workspaceData.activeKey

      if (resetComparison) {
        workspaceData = createEmptyWorkspaceData(applianceKey)
        setState({
          ...state,
          comparison: createEmptyComparisonState({
            status: 'loading',
            presetLoadStatus: 'loading'
          })
        })
      } else {
        updateComparisonState({
          status: 'loading',
          statusMessage: ''
        })
      }

      return state
    }

    if (viewStatus === 'error') {
      workspaceData = createEmptyWorkspaceData(applianceKey)
      setState({
        ...state,
        comparison: createEmptyComparisonState({
          status: 'error',
          statusMessage: 'Comparison is unavailable until the active Appliance finishes loading.',
          presetLoadStatus: 'idle'
        })
      })

      return state
    }

    if (viewStatus !== 'ready' && viewStatus !== 'empty') {
      return state
    }

    const resetComparison = applianceKey !== workspaceData.activeKey
    const orderedOptions = deriveOrderedOptions(shellState?.view?.canonicalRows ?? shellState?.view?.rows)
    const apiResult = getApi(['loadSchema'])

    if (!apiResult.ok) {
      setComparisonLoadError(apiResult.category)
      return state
    }

    updateComparisonState({
      status: 'loading',
      statusMessage: '',
      presetLoadStatus: resetComparison ? 'loading' : state.comparison.presetLoadStatus,
      presetLoadMessage: resetComparison ? '' : state.comparison.presetLoadMessage,
      presetActionError: '',
      presetSaveValidationErrors: []
    })

    let schemaEnvelope
    try {
      schemaEnvelope = await apiResult.api.loadSchema(applianceKey)
    } catch (_error) {
      if (!isCurrentRequest(nextRequestId)) {
        return state
      }

      setLoadErrorState(applianceKey, 'Schema unavailable or invalid')
      return state
    }

    if (!isCurrentRequest(nextRequestId)) {
      return state
    }

    if (!schemaEnvelope || typeof schemaEnvelope !== 'object' || schemaEnvelope.ok !== true || !schemaEnvelope.schema) {
      setComparisonLoadError('Schema unavailable or invalid')
      return state
    }

    const availableDimensionsResult = deriveEligibleComparisonDimensions(applianceKey, schemaEnvelope.schema)
    if (!availableDimensionsResult.ok) {
      setComparisonLoadError(availableDimensionsResult.category)
      return state
    }

    workspaceData = {
      activeKey: applianceKey,
      schema: schemaEnvelope.schema,
      orderedOptions,
      availableDimensions: availableDimensionsResult.dimensions
    }

    const nextComparedDimensionKeys = resetComparison
      ? deriveDefaultComparisonDimensionKeys(applianceKey, schemaEnvelope.schema, workspaceData.availableDimensions)
      : filterComparisonDimensionKeys(state.comparison.comparedDimensionKeys, workspaceData.availableDimensions)

    const nextSelectedOptionIds = resetComparison
      ? []
      : pruneSelectedOptionIds(state.comparison.selectedOptionIds, workspaceData.orderedOptions)

    const nextAppliedPresetId = resetComparison ? null : state.comparison.appliedPresetId
    const nextAppliedPresetWarning = resetComparison ? null : state.comparison.appliedPresetWarning

    updateComparisonState({
      availableDimensions: workspaceData.availableDimensions,
      orderedOptions: workspaceData.orderedOptions,
      comparedDimensionKeys: nextComparedDimensionKeys,
      selectedOptionIds: nextSelectedOptionIds,
      presets: resetComparison ? [] : state.comparison.presets,
      appliedPresetId: nextAppliedPresetId,
      appliedPresetWarning: nextAppliedPresetWarning,
      presetLoadStatus: resetComparison ? 'loading' : state.comparison.presetLoadStatus,
      presetLoadMessage: resetComparison ? '' : state.comparison.presetLoadMessage,
      presetActionError: '',
      presetSaveValidationErrors: [],
      presetSaveName: resetComparison ? '' : state.comparison.presetSaveName,
      status: 'ready',
      statusMessage: ''
    })

    if (resetComparison) {
      await loadPresetsForActiveAppliance(nextRequestId, applianceKey)
    }

    return state
  }

  async function loadPresetsForActiveAppliance(expectedRequestId, applianceKey) {
    const apiResult = getApi(['loadPresets'])
    if (!apiResult.ok) {
      updateComparisonState({
        presetLoadStatus: 'error',
        presetLoadMessage: apiResult.category
      })
      return state
    }

    let presetEnvelope
    try {
      presetEnvelope = await apiResult.api.loadPresets(applianceKey)
    } catch (_error) {
      if (!isCurrentRequest(expectedRequestId, applianceKey)) {
        return state
      }

      updateComparisonState({
        presetLoadStatus: 'error',
        presetLoadMessage: EMPTY_PRESET_LOAD_MESSAGE
      })
      return state
    }

    if (!isCurrentRequest(expectedRequestId, applianceKey)) {
      return state
    }

    if (!presetEnvelope || typeof presetEnvelope !== 'object') {
      updateComparisonState({
        presetLoadStatus: 'error',
        presetLoadMessage: EMPTY_PRESET_LOAD_MESSAGE
      })
      return state
    }

    if (presetEnvelope.ok !== true) {
      updateComparisonState({
        presetLoadStatus: 'error',
        presetLoadMessage: presetEnvelope.failure?.message || EMPTY_PRESET_LOAD_MESSAGE
      })
      return state
    }

    if (!Array.isArray(presetEnvelope.presets) || !Array.isArray(presetEnvelope.warnings)) {
      updateComparisonState({
        presetLoadStatus: 'error',
        presetLoadMessage: EMPTY_PRESET_LOAD_MESSAGE
      })
      return state
    }

    const presets = normalizePresetRecords(presetEnvelope.presets, presetEnvelope.warnings)
    const appliedPreset = presets.find((preset) => preset.id === state.comparison.appliedPresetId) || null

    updateComparisonState({
      presets,
      appliedPresetId: appliedPreset ? appliedPreset.id : null,
      appliedPresetWarning: appliedPreset ? createAppliedPresetWarning(appliedPreset) : null,
      presetLoadStatus: 'ready',
      presetLoadMessage: '',
      presetActionError: ''
    })
    return state
  }

  function updateComparisonState(overrides) {
    const availableDimensions = Object.prototype.hasOwnProperty.call(overrides, 'availableDimensions')
      ? overrides.availableDimensions
      : workspaceData.availableDimensions
    const orderedOptions = Object.prototype.hasOwnProperty.call(overrides, 'orderedOptions')
      ? overrides.orderedOptions
      : workspaceData.orderedOptions

    state = {
      ...state,
      comparison: buildComparisonState({
        previousComparison: state.comparison,
        availableDimensions,
        orderedOptions,
        comparedDimensionKeys: Object.prototype.hasOwnProperty.call(overrides, 'comparedDimensionKeys')
          ? overrides.comparedDimensionKeys
          : state.comparison.comparedDimensionKeys,
        selectedOptionIds: Object.prototype.hasOwnProperty.call(overrides, 'selectedOptionIds')
          ? overrides.selectedOptionIds
          : state.comparison.selectedOptionIds,
        presets: Object.prototype.hasOwnProperty.call(overrides, 'presets')
          ? overrides.presets
          : state.comparison.presets,
        appliedPresetId: Object.prototype.hasOwnProperty.call(overrides, 'appliedPresetId')
          ? overrides.appliedPresetId
          : state.comparison.appliedPresetId,
        appliedPresetWarning: Object.prototype.hasOwnProperty.call(overrides, 'appliedPresetWarning')
          ? overrides.appliedPresetWarning
          : state.comparison.appliedPresetWarning,
        presetLoadStatus: Object.prototype.hasOwnProperty.call(overrides, 'presetLoadStatus')
          ? overrides.presetLoadStatus
          : state.comparison.presetLoadStatus,
        presetLoadMessage: Object.prototype.hasOwnProperty.call(overrides, 'presetLoadMessage')
          ? overrides.presetLoadMessage
          : state.comparison.presetLoadMessage,
        presetActionError: Object.prototype.hasOwnProperty.call(overrides, 'presetActionError')
          ? overrides.presetActionError
          : state.comparison.presetActionError,
        presetSaveValidationErrors: Object.prototype.hasOwnProperty.call(overrides, 'presetSaveValidationErrors')
          ? overrides.presetSaveValidationErrors
          : state.comparison.presetSaveValidationErrors,
        presetSaveName: Object.prototype.hasOwnProperty.call(overrides, 'presetSaveName')
          ? overrides.presetSaveName
          : state.comparison.presetSaveName,
        status: Object.prototype.hasOwnProperty.call(overrides, 'status')
          ? overrides.status
          : state.comparison.status,
        statusMessage: Object.prototype.hasOwnProperty.call(overrides, 'statusMessage')
          ? overrides.statusMessage
          : state.comparison.statusMessage
      })
    }
    emit()
  }

  function setComparisonLoadError(category) {
    workspaceData = {
      ...workspaceData,
      schema: null,
      orderedOptions: []
    }

    updateComparisonState({
      availableDimensions: [],
      orderedOptions: [],
      comparedDimensionKeys: [],
      selectedOptionIds: [],
      selectedOptions: [],
      rows: [],
      presets: [],
      appliedPresetId: null,
      appliedPresetWarning: null,
      presetLoadStatus: 'idle',
      presetLoadMessage: '',
      presetActionError: '',
      presetSaveValidationErrors: [],
      presetSaveName: '',
      status: 'error',
      statusMessage: `Comparison could not be prepared. ${category}.`
    })
  }

  function isCurrentRequest(expectedRequestId, applianceKey = state.activeKey) {
    return !disposed && requestId === expectedRequestId && state.activeKey === applianceKey
  }

  shellUnsubscribe = integratedShellController.subscribe((shellState) => {
    if (disposed) {
      return
    }

    mirrorShellState(shellState)
    comparisonSyncPromise = syncComparisonFromShell(shellState)
  })

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
    syncShellState: async (shellState) => {
      mirrorShellState(shellState)
      comparisonSyncPromise = syncComparisonFromShell(shellState)
      await comparisonSyncPromise
      return state
    },
    retryPresetLoad,
    toggleOptionSelection,
    addComparedDimension,
    removeComparedDimension,
    applyPreset,
    setPresetSaveName,
    savePreset,
    deletePreset,
    dispose() {
      disposed = true
      requestId += 1
      shellUnsubscribe()

      if (ownsShellController && typeof integratedShellController.dispose === 'function') {
        integratedShellController.dispose()
      }

      listeners.clear()
    }
  }
}

export function deriveEligibleComparisonDimensions(applianceKey, schema) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.dimensions)) {
    return fail('Schema unavailable or invalid')
  }

  const seenIds = new Set()
  const dimensions = []

  for (const dimension of schema.dimensions) {
    if (!dimension || typeof dimension !== 'object') {
      return fail('Schema unavailable or invalid')
    }

    if (
      typeof dimension.id !== 'string'
      || typeof dimension.label !== 'string'
      || typeof dimension.type !== 'string'
      || typeof dimension.required !== 'boolean'
      || seenIds.has(dimension.id)
    ) {
      return fail('Schema unavailable or invalid')
    }

    seenIds.add(dimension.id)

    if (applianceKey === 'laundry-set' && dimension.id.includes('.')) {
      continue
    }

    dimensions.push({
      id: dimension.id,
      label: dimension.label,
      type: dimension.type,
      required: dimension.required,
      unit: typeof dimension.unit === 'string' ? dimension.unit : undefined
    })
  }

  return {
    ok: true,
    dimensions
  }
}

export function deriveDefaultComparisonDimensionKeys(applianceKey, schema, availableDimensions) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.defaultComparisonDimensionIds)) {
    return []
  }

  const availableIds = new Set(
    (Array.isArray(availableDimensions) ? availableDimensions : [])
      .map((dimension) => dimension?.id)
      .filter((id) => typeof id === 'string')
  )
  const keys = []
  const seenKeys = new Set()

  for (const dimensionKey of schema.defaultComparisonDimensionIds) {
    if (typeof dimensionKey !== 'string' || seenKeys.has(dimensionKey)) {
      continue
    }

    if (applianceKey === 'laundry-set' && dimensionKey.includes('.')) {
      continue
    }

    if (!availableIds.has(dimensionKey)) {
      continue
    }

    seenKeys.add(dimensionKey)
    keys.push(dimensionKey)
  }

  return keys
}

export function filterComparisonDimensionKeys(dimensionKeys, availableDimensions) {
  if (!Array.isArray(dimensionKeys)) {
    return []
  }

  const availableIds = new Set(availableDimensions.map((dimension) => dimension.id))
  const filteredKeys = []
  const seenKeys = new Set()

  for (const dimensionKey of dimensionKeys) {
    if (typeof dimensionKey !== 'string' || seenKeys.has(dimensionKey) || !availableIds.has(dimensionKey)) {
      continue
    }

    seenKeys.add(dimensionKey)
    filteredKeys.push(dimensionKey)
  }

  return filteredKeys
}

export function pruneSelectedOptionIds(selectedOptionIds, orderedOptions) {
  if (!Array.isArray(selectedOptionIds)) {
    return []
  }

  const availableIds = new Set(orderedOptions.map((option) => option?.id).filter((id) => typeof id === 'string'))
  const seenIds = new Set()

  return selectedOptionIds.filter((optionId) => {
    if (typeof optionId !== 'string' || seenIds.has(optionId) || !availableIds.has(optionId)) {
      return false
    }

    seenIds.add(optionId)
    return true
  })
}

export function normalizePresetRecords(presets, warnings) {
  const warningMap = new Map()

  for (const warning of warnings) {
    if (!warning || typeof warning !== 'object' || typeof warning.presetId !== 'string') {
      continue
    }

    if (!warningMap.has(warning.presetId)) {
      warningMap.set(warning.presetId, [])
    }

    warningMap.get(warning.presetId).push({
      ...warning,
      message: typeof warning.message === 'string' ? warning.message : 'A preset Dimension could not be applied.'
    })
  }

  return presets.map((preset) => ({
    ...normalizePresetRecord(preset),
    warnings: warningMap.get(preset.id) || []
  }))
}

export function buildComparisonMatrix({ availableDimensions, comparedDimensionKeys, orderedOptions, selectedOptionIds }) {
  const normalizedDimensions = Array.isArray(availableDimensions) ? availableDimensions : []
  const normalizedOptions = Array.isArray(orderedOptions) ? orderedOptions : []
  const nextSelectedOptionIds = pruneSelectedOptionIds(selectedOptionIds, normalizedOptions)
  const selectedIds = new Set(nextSelectedOptionIds)
  const selectedOptions = normalizedOptions
    .filter((option) => selectedIds.has(option.id))
    .map((option) => ({
      id: option.id,
      label: deriveOptionLabel(option),
      option
    }))

  const dimensionsById = new Map(normalizedDimensions.map((dimension) => [dimension.id, dimension]))
  const rows = filterComparisonDimensionKeys(comparedDimensionKeys, normalizedDimensions)
    .map((dimensionKey) => dimensionsById.get(dimensionKey))
    .filter(Boolean)
    .map((dimension) => ({
      key: dimension.id,
      label: dimension.label,
      cells: selectedOptions.map((selectedOption) => ({
        optionId: selectedOption.id,
        ...deriveComparisonCell(dimension, selectedOption.option?.evaluations)
      }))
    }))

  return {
    selectedOptionIds: nextSelectedOptionIds,
    selectedOptions,
    rows,
    addableDimensions: normalizedDimensions.filter((dimension) => !comparedDimensionKeys.includes(dimension.id))
  }
}

export function deriveComparisonCell(dimension, evaluations) {
  if (!evaluations || typeof evaluations !== 'object' || !Object.prototype.hasOwnProperty.call(evaluations, dimension.id)) {
    return {
      kind: 'empty',
      text: EMPTY_CELL_TEXT
    }
  }

  const evaluation = evaluations[dimension.id]
  if (!evaluation || typeof evaluation !== 'object') {
    return {
      kind: 'empty',
      text: EMPTY_CELL_TEXT
    }
  }

  if (evaluation.status === 'na') {
    return {
      kind: 'na',
      text: 'N/A',
      className: NA_TOKEN_CLASS_NAME,
      dataEvaluationState: 'na'
    }
  }

  if (evaluation.status !== 'known') {
    return {
      kind: 'empty',
      text: EMPTY_CELL_TEXT
    }
  }

  const renderedValue = renderComparisonValue(dimension, evaluation.value)
  if (renderedValue === null) {
    return {
      kind: 'empty',
      text: EMPTY_CELL_TEXT
    }
  }

  return {
    kind: 'known',
    text: renderedValue
  }
}

function createEmptyComparisonState({ status = 'ready', statusMessage = '', presetLoadStatus = 'loading' } = {}) {
  return {
    status,
    statusMessage,
    availableDimensions: [],
    addableDimensions: [],
    comparedDimensionKeys: [],
    selectedOptionIds: [],
    selectedOptions: [],
    rows: [],
    presets: [],
    appliedPresetId: null,
    appliedPresetWarning: null,
    presetLoadStatus,
    presetLoadMessage: '',
    presetActionError: '',
    presetSaveName: '',
    presetSaveValidationErrors: []
  }
}

function createEmptyWorkspaceData() {
  return {
    activeKey: null,
    schema: null,
    orderedOptions: [],
    availableDimensions: []
  }
}

function buildComparisonState({
  previousComparison,
  availableDimensions,
  orderedOptions,
  comparedDimensionKeys,
  selectedOptionIds,
  presets,
  appliedPresetId,
  appliedPresetWarning,
  presetLoadStatus,
  presetLoadMessage,
  presetActionError,
  presetSaveValidationErrors,
  presetSaveName,
  status,
  statusMessage
}) {
  const matrix = buildComparisonMatrix({
    availableDimensions,
    comparedDimensionKeys,
    orderedOptions,
    selectedOptionIds
  })

  return {
    ...createEmptyComparisonState(),
    ...previousComparison,
    availableDimensions: [...availableDimensions],
    addableDimensions: matrix.addableDimensions,
    comparedDimensionKeys: filterComparisonDimensionKeys(comparedDimensionKeys, availableDimensions),
    selectedOptionIds: matrix.selectedOptionIds,
    selectedOptions: matrix.selectedOptions,
    rows: matrix.rows,
    presets: [...presets],
    appliedPresetId,
    appliedPresetWarning,
    presetLoadStatus,
    presetLoadMessage,
    presetActionError,
    presetSaveValidationErrors: Array.isArray(presetSaveValidationErrors) ? [...presetSaveValidationErrors] : [],
    presetSaveName,
    status,
    statusMessage
  }
}

function normalizePresetRecord(preset) {
  return {
    id: typeof preset.id === 'string' ? preset.id : '',
    name: typeof preset.name === 'string' ? preset.name : '',
    applianceKey: typeof preset.applianceKey === 'string' ? preset.applianceKey : '',
    dimensionKeys: Array.isArray(preset.dimensionKeys) ? [...preset.dimensionKeys] : [],
    effectiveDimensionKeys: Array.isArray(preset.effectiveDimensionKeys) ? [...preset.effectiveDimensionKeys] : [],
    warnings: Array.isArray(preset.warnings) ? [...preset.warnings] : []
  }
}

function upsertPreset(presets, nextPreset) {
  const existingIndex = presets.findIndex((preset) => preset.id === nextPreset.id)
  if (existingIndex === -1) {
    return [...presets, { ...nextPreset, warnings: [] }]
  }

  const nextPresets = [...presets]
  nextPresets.splice(existingIndex, 1, { ...nextPreset, warnings: [] })
  return nextPresets
}

function createAppliedPresetWarning(preset) {
  if (!preset || !Array.isArray(preset.warnings) || preset.warnings.length === 0) {
    return null
  }

  return {
    presetId: preset.id,
    presetName: preset.name,
    messages: preset.warnings.map((warning) => {
      if (typeof warning.dimensionKey === 'string' && warning.dimensionKey !== '') {
        return `${warning.message} Missing Dimension: ${warning.dimensionKey}.`
      }

      return warning.message
    })
  }
}

function renderComparisonValue(dimension, value) {
  if (dimension.type === 'boolean') {
    return typeof value === 'boolean' ? (value ? 'True' : 'False') : null
  }

  if (dimension.type === 'numeric') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null
    }

    return dimension.unit ? `${value} ${dimension.unit}` : String(value)
  }

  if (dimension.type === 'pointer' || dimension.type === 'string' || dimension.type === 'enum') {
    return typeof value === 'string' ? value : null
  }

  return value == null ? null : String(value)
}

function deriveOptionLabel(option) {
  const brand = readKnownEvaluationValue(option?.evaluations, 'brand')
  const model = readKnownEvaluationValue(option?.evaluations, 'model')

  if (typeof brand === 'string' && typeof model === 'string') {
    return `${brand} ${model}`
  }

  if (typeof model === 'string') {
    return model
  }

  if (typeof brand === 'string') {
    return brand
  }

  return typeof option?.id === 'string' && option.id !== '' ? option.id : 'Option'
}

function readKnownEvaluationValue(evaluations, dimensionKey) {
  if (!evaluations || typeof evaluations !== 'object') {
    return null
  }

  const evaluation = evaluations[dimensionKey]
  if (!evaluation || typeof evaluation !== 'object' || evaluation.status !== 'known') {
    return null
  }

  return evaluation.value
}

function resolveLabelFromItems(items, applianceKey) {
  const item = items.find((entry) => entry.key === applianceKey)
  return item ? item.label : FALLBACK_NAVIGATION_LABELS[applianceKey] || applianceKey
}

function deriveOrderedOptions(rows) {
  if (!Array.isArray(rows)) {
    return []
  }

  return rows
    .map((row) => row?.option)
    .filter((option) => option && typeof option === 'object')
}

function fail(category) {
  return {
    ok: false,
    category
  }
}
