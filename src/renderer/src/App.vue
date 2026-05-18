<template>
  <div class="app-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Comparison and CRUD</p>
        <h1>Appliance Research Tool</h1>
        <p class="page-subtitle">Browse Appliance Options, compare them side-by-side, and manage schema-driven Options.</p>
      </div>
    </header>

    <main class="page-body">
      <nav class="appliance-nav" aria-label="Appliance navigation">
        <button
          v-for="item in navigationItems"
          :key="item.key"
          type="button"
          class="nav-button"
          :class="{ 'is-active': item.key === workspaceState.activeKey }"
          :disabled="navigationDisabled"
          @click="selectAppliance(item.key)"
        >
          {{ item.label }}
        </button>
      </nav>

      <div class="workspace-grid">
        <div class="workspace-column workspace-column--primary">
          <OptionListPanel
            :active-label="activeLabel"
            :view="view"
            :selected-option-ids="comparison.selectedOptionIds"
            :selection-disabled="crudBusy"
            @retry="retryLoad"
            @toggle-option="toggleOptionSelection"
            @update-filter="updateFilter"
          />

          <OptionListView
            :active-appliance-key="workspaceState.activeKey"
            :active-appliance-label="activeLabel"
            :rows="optionRows"
            :loading="view.status === 'loading'"
            :refreshing="crudViewState.isRefreshingAfterSave"
            :error="crudLoadError"
            :warnings="crudWarnings"
            :action-disabled="crudBusy"
            @create="openCreateSession"
            @edit="openEditSession"
            @delete="openDeleteDialog"
            @retry="retryLoad"
          />
        </div>

        <div class="workspace-column workspace-column--secondary">
          <ComparisonPanel
            :active-label="activeLabel"
            :comparison="comparison"
            :view-status="view.status"
            @add-dimension="addComparedDimension"
            @remove-dimension="removeComparedDimension"
            @apply-preset="applyPreset"
            @delete-preset="deletePreset"
            @update-save-name="setPresetSaveName"
            @save-preset="savePreset"
            @retry-presets="retryPresetLoad"
          />

          <SchemaDrivenOptionForm
            :active-appliance-label="activeLabel"
            :mode="crudViewState.session?.mode ?? null"
            :fields="editableFields"
            :draft="crudViewState.session?.draft ?? {}"
            :field-errors-by-dimension-id="editorState.fieldErrorsByDimensionId"
            :form-errors="editorState.formErrors"
            :call-error="editorState.callError"
            :save-pending="editorState.savePending"
            :pointer-catalog-loading="editorState.pointerCatalogLoading"
            :pointer-catalog-error="editorState.pointerCatalogError"
            :pointer-choices-by-dimension-id="pointerChoicesByDimensionId"
            @update-field="updateDraftField"
            @cancel="cancelEditorSession"
            @save="saveEditorSession"
          />
        </div>
      </div>
    </main>

    <DeleteOptionDialog
      :open="deleteDialog.open"
      :appliance-label="activeLabel"
      :option-label="deleteDialog.optionLabel"
      :message="deleteDialog.message"
      :loading-impact="deleteDialog.loadingImpact"
      :error="deleteDialog.error"
      :confirm-pending="deleteDialog.confirmPending"
      @cancel="closeDeleteDialog"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ComparisonPanel from './components/ComparisonPanel.vue'
import DeleteOptionDialog from './components/DeleteOptionDialog.vue'
import OptionListPanel from './components/OptionListPanel.vue'
import OptionListView from './components/OptionListView.vue'
import SchemaDrivenOptionForm from './components/SchemaDrivenOptionForm.vue'
import { createComparisonWorkspaceController, createInitialState } from './composables/comparisonWorkspace.mjs'
import optionCrudModel from './optionCrudModel.mjs'
import optionCrudWorkflow from './optionCrudWorkflow.mjs'

const {
  applyReloadedOptions,
  beginCreateSession,
  beginEditSession,
  buildOptionPayload,
  cancelSession,
  createCrudViewState,
  createPointerChoices,
  deriveEditableFields,
  getOptionDisplayLabel,
  groupValidationErrors,
  markSaveSuccessPendingReload,
  updateSessionDraft
} = optionCrudModel

const {
  createDeleteDialogState,
  createEditorState,
  deleteOptionAndReload,
  loadLaundrySetPointerCatalogs,
  prepareDeleteConfirmation,
  saveOptionAndReload
} = optionCrudWorkflow

const workspaceState = ref(createInitialState())
const controller = createComparisonWorkspaceController()

const activeSchema = ref(null)
const crudViewState = ref(createCrudViewState())
const editorState = ref(createEditorState())
const deleteDialog = ref(createDeleteDialogState())
const crudLoadError = ref(null)
const crudWarnings = ref([])

let unsubscribe = () => {}

const navigationItems = computed(() => workspaceState.value.navigationItems)
const view = computed(() => workspaceState.value.view)
const comparison = computed(() => workspaceState.value.comparison)
const activeLabel = computed(() => {
  const activeItem = workspaceState.value.navigationItems.find((item) => item.key === workspaceState.value.activeKey)
  return activeItem ? activeItem.label : 'Washer'
})

const editableFields = computed(() => deriveEditableFields(activeSchema.value))

const optionRows = computed(() => {
  if (crudViewState.value.settledOptions.length > 0) {
    return crudViewState.value.settledOptions.map((option) => ({
      id: option.id,
      label: getOptionDisplayLabel(option),
      subtitle: option.id,
      option
    }))
  }

  return Array.isArray(view.value.rows)
    ? (Array.isArray(view.value.canonicalRows) ? view.value.canonicalRows : view.value.rows)
      .map((row) => row?.option)
      .filter((option) => option && typeof option === 'object')
      .map((option) => ({
        id: option.id,
        label: getOptionDisplayLabel(option),
        subtitle: option.id,
        option
      }))
    : []
})

const pointerChoicesByDimensionId = computed(() => {
  const choices = {}

  for (const field of editableFields.value) {
    if (field.type !== 'pointer') {
      continue
    }

    const catalog = editorState.value.pointerCatalogs[field.targetAppliance] ?? []
    choices[field.id] = createPointerChoices(catalog)
  }

  return choices
})

const crudBusy = computed(() => (
  editorState.value.savePending
  || editorState.value.pointerCatalogLoading
  || deleteDialog.value.open
  || deleteDialog.value.confirmPending
  || deleteDialog.value.loadingImpact
))

const navigationDisabled = computed(() => crudBusy.value || Boolean(crudViewState.value.session))

function syncCrudFromWorkspace(nextState) {
  const sourceRows = Array.isArray(nextState?.view?.canonicalRows)
    ? nextState.view.canonicalRows
    : nextState?.view?.rows
  const nextOptions = Array.isArray(sourceRows)
    ? sourceRows
      .map((row) => row?.option)
      .filter((option) => option && typeof option === 'object')
    : []

  if (!crudViewState.value.session && !crudViewState.value.isRefreshingAfterSave) {
    crudViewState.value = applyReloadedOptions(crudViewState.value, nextOptions)
  }

  crudLoadError.value = nextState?.view?.status === 'error' ? nextState.view.message : null
  crudWarnings.value = []
}

async function loadActiveSchema() {
  const electronApi = window.electronAPI ?? null
  const applianceKey = workspaceState.value.activeKey

  activeSchema.value = null

  if (!electronApi || typeof electronApi.loadSchema !== 'function' || typeof applianceKey !== 'string' || applianceKey === '') {
    return
  }

  try {
    const schemaResult = await electronApi.loadSchema(applianceKey)
    if (schemaResult?.ok === true && schemaResult.schema && typeof schemaResult.schema === 'object') {
      activeSchema.value = schemaResult.schema
    }
  } catch (_error) {
    activeSchema.value = null
  }
}

function selectAppliance(applianceKey) {
  if (navigationDisabled.value) {
    return
  }

  activeSchema.value = null
  void controller.selectAppliance(applianceKey)
}

function retryLoad() {
  activeSchema.value = null
  void controller.retry()
}

function retryPresetLoad() {
  void controller.retryPresetLoad()
}

function toggleOptionSelection(optionId) {
  if (crudBusy.value) {
    return
  }

  controller.toggleOptionSelection(optionId)
}

function updateFilter(update) {
  if (crudBusy.value) {
    return
  }

  void controller.updateFilters(update)
}

function addComparedDimension(dimensionKey) {
  controller.addComparedDimension(dimensionKey)
}

function removeComparedDimension(dimensionKey) {
  controller.removeComparedDimension(dimensionKey)
}

function applyPreset(presetId) {
  controller.applyPreset(presetId)
}

function setPresetSaveName(name) {
  controller.setPresetSaveName(name)
}

function savePreset() {
  void controller.savePreset()
}

function deletePreset(presetId) {
  void controller.deletePreset(presetId)
}

async function openCreateSession() {
  if (!editableFields.value.length || crudBusy.value) {
    return
  }

  crudViewState.value = beginCreateSession(crudViewState.value, editableFields.value)
  editorState.value = createEditorState()
  await ensurePointerCatalogsForEditor()
}

async function openEditSession(option) {
  if (!option || !editableFields.value.length || crudBusy.value) {
    return
  }

  crudViewState.value = beginEditSession(crudViewState.value, editableFields.value, option)
  editorState.value = createEditorState()
  await ensurePointerCatalogsForEditor()
}

function cancelEditorSession() {
  crudViewState.value = cancelSession(crudViewState.value)
  editorState.value = createEditorState()
}

function updateDraftField({ dimensionId, patch }) {
  crudViewState.value = updateSessionDraft(crudViewState.value, dimensionId, patch)

  if (dimensionId && editorState.value.fieldErrorsByDimensionId[dimensionId]) {
    const nextFieldErrors = { ...editorState.value.fieldErrorsByDimensionId }
    delete nextFieldErrors[dimensionId]
    editorState.value = {
      ...editorState.value,
      fieldErrorsByDimensionId: nextFieldErrors,
      callError: null
    }
    return
  }

  editorState.value = {
    ...editorState.value,
    callError: null
  }
}

async function saveEditorSession() {
  const session = crudViewState.value.session
  const electronApi = window.electronAPI ?? null

  if (!electronApi || !session) {
    return
  }

  editorState.value = {
    ...editorState.value,
    savePending: true,
    callError: null,
    fieldErrorsByDimensionId: {},
    formErrors: []
  }

  try {
    const optionPayload = buildOptionPayload({
      fields: editableFields.value,
      draft: session.draft,
      optionId: session.optionId
    })

    const workflowResult = await saveOptionAndReload({
      electronApi,
      applianceKey: workspaceState.value.activeKey,
      optionPayload
    })

    if (!workflowResult.ok) {
      const groupedErrors = groupValidationErrors(workflowResult.saveResult?.validationErrors)

      if (workflowResult.stage === 'save') {
        editorState.value = {
          ...editorState.value,
          savePending: false,
          callError: workflowResult.saveResult?.failure ? formatEntry(workflowResult.saveResult.failure) : null,
          fieldErrorsByDimensionId: groupedErrors.fieldErrorsByDimensionId,
          formErrors: groupedErrors.formErrors
        }
        return
      }

      editorState.value = {
        ...editorState.value,
        savePending: false,
        callError: `Option saved, but the refreshed list could not be loaded: ${formatEntry(workflowResult.reloadResult?.failure)}`,
        fieldErrorsByDimensionId: {},
        formErrors: []
      }
      return
    }

    crudViewState.value = markSaveSuccessPendingReload(crudViewState.value)
    crudViewState.value = applyReloadedOptions(crudViewState.value, workflowResult.reloadResult.options ?? [])
    editorState.value = createEditorState()
    crudWarnings.value = normalizeEntries(workflowResult.reloadResult?.warnings)
    await controller.retry()
    await loadActiveSchema()
  } catch (error) {
    editorState.value = {
      ...editorState.value,
      savePending: false,
      callError: formatThrownError(error)
    }
  }
}

async function openDeleteDialog(option) {
  const electronApi = window.electronAPI ?? null

  if (!option || !electronApi || crudBusy.value) {
    return
  }

  deleteDialog.value = {
    open: true,
    option,
    optionLabel: getOptionDisplayLabel(option),
    loadingImpact: true,
    message: '',
    error: null,
    confirmPending: false
  }

  try {
    const preparation = await prepareDeleteConfirmation({
      electronApi,
      applianceKey: workspaceState.value.activeKey,
      option
    })

    if (!preparation.ok) {
      deleteDialog.value = {
        ...deleteDialog.value,
        loadingImpact: false,
        optionLabel: preparation.optionLabel,
        error: preparation.error
      }
      return
    }

    deleteDialog.value = {
      ...deleteDialog.value,
      loadingImpact: false,
      optionLabel: preparation.optionLabel,
      message: preparation.message
    }
  } catch (error) {
    deleteDialog.value = {
      ...deleteDialog.value,
      loadingImpact: false,
      error: `Delete impact could not be prepared: ${formatThrownError(error)}`
    }
  }
}

function closeDeleteDialog() {
  deleteDialog.value = createDeleteDialogState()
}

async function confirmDelete() {
  const electronApi = window.electronAPI ?? null

  if (!electronApi || !deleteDialog.value.option || deleteDialog.value.loadingImpact || deleteDialog.value.error) {
    return
  }

  deleteDialog.value = {
    ...deleteDialog.value,
    confirmPending: true,
    error: null
  }

  try {
    const workflowResult = await deleteOptionAndReload({
      electronApi,
      applianceKey: workspaceState.value.activeKey,
      optionId: deleteDialog.value.option.id
    })

    if (!workflowResult.ok) {
      deleteDialog.value = {
        ...deleteDialog.value,
        confirmPending: false,
        error: workflowResult.stage === 'delete'
          ? formatEntry(workflowResult.deleteResult?.failure)
          : `Option deleted, but the refreshed list could not be loaded: ${formatEntry(workflowResult.reloadResult?.failure)}`
      }
      return
    }

    crudViewState.value = applyReloadedOptions(crudViewState.value, workflowResult.reloadResult.options ?? [])
    crudWarnings.value = normalizeEntries(workflowResult.reloadResult?.warnings)
    closeDeleteDialog()
    await controller.retry()
    await loadActiveSchema()
  } catch (error) {
    deleteDialog.value = {
      ...deleteDialog.value,
      confirmPending: false,
      error: formatThrownError(error)
    }
  }
}

async function ensurePointerCatalogsForEditor() {
  const electronApi = window.electronAPI ?? null

  if (workspaceState.value.activeKey !== 'laundry-set' || !crudViewState.value.session || !electronApi) {
    return
  }

  editorState.value = {
    ...editorState.value,
    pointerCatalogLoading: true,
    pointerCatalogError: null,
    pointerCatalogs: {
      washer: [],
      dryer: []
    }
  }

  try {
    const catalogResult = await loadLaundrySetPointerCatalogs({ electronApi })

    if (!catalogResult.ok) {
      editorState.value = {
        ...editorState.value,
        pointerCatalogLoading: false,
        pointerCatalogError: catalogResult.error,
        pointerCatalogs: {
          washer: catalogResult.washerResult?.ok ? catalogResult.washerResult.options ?? [] : [],
          dryer: catalogResult.dryerResult?.ok ? catalogResult.dryerResult.options ?? [] : []
        }
      }
      return
    }

    editorState.value = {
      ...editorState.value,
      pointerCatalogLoading: false,
      pointerCatalogError: null,
      pointerCatalogs: {
        washer: catalogResult.washerResult.options ?? [],
        dryer: catalogResult.dryerResult.options ?? []
      }
    }
  } catch (error) {
    editorState.value = {
      ...editorState.value,
      pointerCatalogLoading: false,
      pointerCatalogError: formatThrownError(error)
    }
  }
}

function normalizeEntries(entries) {
  return Array.isArray(entries) ? entries : []
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

function formatThrownError(error) {
  return error instanceof Error ? error.message : 'Unknown renderer error.'
}

onMounted(() => {
  unsubscribe = controller.subscribe((nextState) => {
    workspaceState.value = nextState
    syncCrudFromWorkspace(nextState)

    if (nextState?.view?.status === 'ready' || nextState?.view?.status === 'empty') {
      void loadActiveSchema()
    }
  })

  void controller.boot()
})

onBeforeUnmount(() => {
  unsubscribe()
  controller.dispose()
})
</script>

<style scoped>
.workspace-column {
  display: grid;
  gap: 1.5rem;
  align-content: start;
}
</style>
