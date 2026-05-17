import optionCrudModel from './optionCrudModel.mjs'

const {
  buildDeleteConfirmationMessage,
  getDeleteImpact,
  getOptionDisplayLabel
} = optionCrudModel

async function prepareDeleteConfirmation({ electronApi, applianceKey, option }) {
  const optionLabel = getOptionDisplayLabel(option)

  if (applianceKey === 'laundry-set') {
    return {
      ok: true,
      optionLabel,
      message: buildDeleteConfirmationMessage({
        applianceKey,
        optionLabel,
        affectedLaundrySetOptionIds: []
      })
    }
  }

  const impactOptionsResult = await electronApi.loadOptions('laundry-set')

  if (!impactOptionsResult?.ok) {
    return {
      ok: false,
      optionLabel,
      error: `Delete impact could not be prepared: ${formatEntry(impactOptionsResult?.failure)}`
    }
  }

  const affectedLaundrySetOptionIds = getDeleteImpact(
    applianceKey,
    option?.id,
    impactOptionsResult.options
  )

  return {
    ok: true,
    optionLabel,
    message: buildDeleteConfirmationMessage({
      applianceKey,
      optionLabel,
      affectedLaundrySetOptionIds
    })
  }
}

async function saveOptionAndReload({ electronApi, applianceKey, optionPayload }) {
  const saveResult = await electronApi.saveOption(applianceKey, optionPayload)

  if (!saveResult?.ok) {
    return {
      ok: false,
      stage: 'save',
      saveResult
    }
  }

  const reloadResult = await electronApi.loadOptions(applianceKey)

  if (!reloadResult?.ok) {
    return {
      ok: false,
      stage: 'reload',
      saveResult,
      reloadResult
    }
  }

  return {
    ok: true,
    saveResult,
    reloadResult
  }
}

async function deleteOptionAndReload({ electronApi, applianceKey, optionId }) {
  const deleteResult = await electronApi.deleteOption(applianceKey, optionId)

  if (!deleteResult?.ok) {
    return {
      ok: false,
      stage: 'delete',
      deleteResult
    }
  }

  const reloadResult = await electronApi.loadOptions(applianceKey)

  if (!reloadResult?.ok) {
    return {
      ok: false,
      stage: 'reload',
      deleteResult,
      reloadResult
    }
  }

  return {
    ok: true,
    deleteResult,
    reloadResult
  }
}

async function loadLaundrySetPointerCatalogs({ electronApi }) {
  const [washerResult, dryerResult] = await Promise.all([
    electronApi.loadOptions('washer'),
    electronApi.loadOptions('dryer')
  ])

  return {
    ok: Boolean(washerResult?.ok) && Boolean(dryerResult?.ok),
    washerResult,
    dryerResult,
    error: !washerResult?.ok || !dryerResult?.ok
      ? formatPointerCatalogError(washerResult, dryerResult)
      : null
  }
}

function createEditorState() {
  return {
    savePending: false,
    callError: null,
    fieldErrorsByDimensionId: {},
    formErrors: [],
    pointerCatalogLoading: false,
    pointerCatalogError: null,
    pointerCatalogs: {
      washer: [],
      dryer: []
    }
  }
}

function createDeleteDialogState() {
  return {
    open: false,
    option: null,
    optionLabel: '',
    loadingImpact: false,
    message: '',
    error: null,
    confirmPending: false
  }
}

function formatEntry(entry) {
  if (!entry) {
    return 'Unknown error.'
  }

  if (entry.message && entry.code) {
    return `${entry.message} (${entry.code})`
  }

  if (entry.message) {
    return entry.message
  }

  if (entry.code) {
    return entry.code
  }

  return 'Unknown error.'
}

function formatPointerCatalogError(washerResult, dryerResult) {
  const failures = []

  if (!washerResult?.ok) {
    failures.push(`Washer catalog: ${formatEntry(washerResult?.failure)}`)
  }

  if (!dryerResult?.ok) {
    failures.push(`Dryer catalog: ${formatEntry(dryerResult?.failure)}`)
  }

  return failures.join(' | ')
}

export default {
  createDeleteDialogState,
  createEditorState,
  deleteOptionAndReload,
  formatEntry,
  formatPointerCatalogError,
  loadLaundrySetPointerCatalogs,
  prepareDeleteConfirmation,
  saveOptionAndReload
}
