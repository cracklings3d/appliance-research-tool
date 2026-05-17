const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createSSRApp } = require('vue')
const { renderToString } = require('@vue/server-renderer')

const { loadVueSfc } = require('./helpers/loadVueSfc')

const workspaceRoot = path.resolve(__dirname, '..')
const componentCache = new Map()

function loadComponent(relativePath) {
  return loadVueSfc(path.join(workspaceRoot, relativePath), componentCache)
}

async function renderComponent(relativePath, props) {
  const component = loadComponent(relativePath)
  return renderToString(createSSRApp(component, props))
}

test('OptionListView keeps settled rows visible during save-refresh state', async () => {
  const html = await renderComponent('src/renderer/src/components/OptionListView.vue', {
    activeApplianceKey: 'washer',
    activeApplianceLabel: 'Washer',
    rows: [
      {
        id: 'washer-1',
        label: 'LG WM-1',
        subtitle: 'washer-1',
        option: { id: 'washer-1', evaluations: {} }
      }
    ],
    loading: false,
    refreshing: true,
    error: null,
    warnings: [],
    actionDisabled: false
  })

  assert.match(html, /Refreshing saved changes…/)
  assert.match(html, /LG WM-1/)
  assert.match(html, /washer-1/)
})

test('rendered editor draft stays isolated from the settled list and still offers cancel', async () => {
  const listHtml = await renderComponent('src/renderer/src/components/OptionListView.vue', {
    activeApplianceKey: 'washer',
    activeApplianceLabel: 'Washer',
    rows: [
      {
        id: 'washer-1',
        label: 'LG Original',
        subtitle: 'washer-1',
        option: { id: 'washer-1', evaluations: {} }
      }
    ],
    loading: false,
    refreshing: false,
    error: null,
    warnings: [],
    actionDisabled: false
  })

  const editorHtml = await renderComponent('src/renderer/src/components/SchemaDrivenOptionForm.vue', {
    activeApplianceLabel: 'Washer',
    mode: 'edit',
    fields: [
      { id: 'washer', label: 'Washer', type: 'pointer', required: true, allowedValues: [], unit: null }
    ],
    draft: {
      washer: { status: 'known', value: 'washer-draft-2' }
    },
    fieldErrorsByDimensionId: {},
    formErrors: [],
    callError: null,
    savePending: false,
    pointerCatalogLoading: false,
    pointerCatalogError: null,
    pointerChoicesByDimensionId: {
      washer: [
        { value: 'washer-original-1', label: 'LG Original' },
        { value: 'washer-draft-2', label: 'LG Edited Draft' }
      ]
    }
  })

  assert.match(listHtml, /LG Original/)
  assert.doesNotMatch(listHtml, /LG Edited Draft/)
  assert.match(editorHtml, /<option value="washer-draft-2">LG Edited Draft<\/option>/)
  assert.doesNotMatch(editorHtml, /<button[^>]*type="submit"[^>]*disabled[^>]*>Save<\/button>/)
  assert.match(editorHtml, /> Cancel </)
})

test('OptionListView removes a deleted row only after refreshed settled rows are rendered', async () => {
  const beforeDeleteHtml = await renderComponent('src/renderer/src/components/OptionListView.vue', {
    activeApplianceKey: 'dryer',
    activeApplianceLabel: 'Dryer',
    rows: [
      {
        id: 'dryer-1',
        label: 'Samsung D-1',
        subtitle: 'dryer-1',
        option: { id: 'dryer-1', evaluations: {} }
      }
    ],
    loading: false,
    refreshing: false,
    error: null,
    warnings: [],
    actionDisabled: false
  })

  const afterDeleteReloadHtml = await renderComponent('src/renderer/src/components/OptionListView.vue', {
    activeApplianceKey: 'dryer',
    activeApplianceLabel: 'Dryer',
    rows: [],
    loading: false,
    refreshing: false,
    error: null,
    warnings: [],
    actionDisabled: false
  })

  assert.match(beforeDeleteHtml, /Samsung D-1/)
  assert.doesNotMatch(afterDeleteReloadHtml, /Samsung D-1/)
  assert.match(afterDeleteReloadHtml, /No Dryer Options have been saved yet\./)
})

test('DeleteOptionDialog shows pre-delete impact messaging before confirmation becomes available', async () => {
  const loadingHtml = await renderComponent('src/renderer/src/components/DeleteOptionDialog.vue', {
    open: true,
    applianceLabel: 'Washer',
    optionLabel: 'LG WM-1',
    message: '',
    loadingImpact: true,
    error: null,
    confirmPending: false
  })

  const preparedHtml = await renderComponent('src/renderer/src/components/DeleteOptionDialog.vue', {
    open: true,
    applianceLabel: 'Washer',
    optionLabel: 'LG WM-1',
    message: 'Delete LG WM-1? 2 Laundry Set Options still reference this washer. Their washer pointer will be cleared and those Laundry Set Options will become incomplete.',
    loadingImpact: false,
    error: null,
    confirmPending: false
  })

  assert.match(loadingHtml, /Preparing downstream impact…/)
  assert.match(loadingHtml, /disabled[^>]*>Confirm delete</)
  assert.match(preparedHtml, /2 Laundry Set Options still reference this washer/i)
  assert.doesNotMatch(preparedHtml, /disabled[^>]*>Confirm delete</)
})

test('SchemaDrivenOptionForm renders laundry-set pointer catalog loading and failure states explicitly', async () => {
  const sharedProps = {
    activeApplianceLabel: 'Laundry Set',
    mode: 'create',
    fields: [
      { id: 'washer', label: 'Washer', type: 'pointer', required: true, allowedValues: [], unit: null },
      { id: 'dryer', label: 'Dryer', type: 'pointer', required: true, allowedValues: [], unit: null }
    ],
    draft: {
      washer: { status: 'known', value: '' },
      dryer: { status: 'known', value: '' }
    },
    fieldErrorsByDimensionId: {},
    formErrors: [],
    callError: null,
    savePending: false,
    pointerChoicesByDimensionId: {
      washer: [],
      dryer: []
    }
  }

  const loadingHtml = await renderComponent('src/renderer/src/components/SchemaDrivenOptionForm.vue', {
    ...sharedProps,
    pointerCatalogLoading: true,
    pointerCatalogError: null
  })

  const failureHtml = await renderComponent('src/renderer/src/components/SchemaDrivenOptionForm.vue', {
    ...sharedProps,
    pointerCatalogLoading: false,
    pointerCatalogError: 'Dryer catalog: Dryer options could not be read.'
  })

  assert.match(loadingHtml, /Loading Washer and Dryer catalogs for pointer selection…/)
  assert.match(loadingHtml, /select id="field-washer" class="text-input" value disabled/)
  assert.match(loadingHtml, /select id="field-dryer" class="text-input" value disabled/)
  assert.match(loadingHtml, /<button[^>]*type="submit"[^>]*disabled[^>]*>Save<\/button>/)
  assert.match(failureHtml, /Dryer catalog: Dryer options could not be read\./)
  assert.match(failureHtml, /select id="field-washer" class="text-input" value disabled/)
  assert.match(failureHtml, /select id="field-dryer" class="text-input" value disabled/)
  assert.match(failureHtml, /<button[^>]*type="submit"[^>]*disabled[^>]*>Save<\/button>/)
})
