const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { pathToFileURL } = require('node:url')

async function loadListViewModel() {
  return import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'shell', 'listViewModel.mjs')).href)
}

test('resolveBootNavigation chooses the first canonical Appliance and adopts usable labels', async () => {
  const { resolveBootNavigation } = await loadListViewModel()
  const result = resolveBootNavigation({
    schemas: [
      { applianceKey: 'dryer', displayName: 'Dryers' },
      { applianceKey: 'washer', displayName: 'Washers' },
      { applianceKey: 'laundry-set', displayName: 'Laundry Sets' }
    ]
  })

  assert.equal(result.ok, true)
  assert.equal(result.activeKey, 'washer')
  assert.equal(result.labels.washer, 'Washers')
  assert.equal(result.labels.dryer, 'Dryers')
  assert.equal(result.labels['laundry-set'], 'Laundry Sets')
})

test('resolveBootNavigation ignores malformed and duplicate discovery entries', async () => {
  const { resolveBootNavigation } = await loadListViewModel()
  const result = resolveBootNavigation({
    schemas: [
      null,
      { applianceKey: 10, displayName: 'Bad' },
      { applianceKey: 'unknown', displayName: 'Unknown' },
      { applianceKey: 'dryer', displayName: '' },
      { applianceKey: 'dryer', displayName: 'Duplicate' }
    ]
  })

  assert.equal(result.ok, true)
  assert.equal(result.activeKey, 'dryer')
  assert.equal(result.labels.dryer, 'Dryer')
})

test('resolveBootNavigation fails to washer error defaults on malformed discovery envelope', async () => {
  const { resolveBootNavigation, FALLBACK_NAVIGATION_LABELS } = await loadListViewModel()
  const result = resolveBootNavigation({ warnings: ['ignored'] })

  assert.deepEqual(result, {
    ok: false,
    activeKey: 'washer',
    labels: { ...FALLBACK_NAVIGATION_LABELS },
    category: 'Schema discovery unavailable'
  })
})

test('validateElectronApi rejects missing or malformed preload exposure', async () => {
  const { validateElectronApi } = await loadListViewModel()
  assert.equal(validateElectronApi(undefined, ['listSchemas']).ok, false)
  assert.equal(validateElectronApi({ listSchemas: 'nope' }, ['listSchemas']).ok, false)
  assert.equal(validateElectronApi({ listSchemas() {} }, ['listSchemas']).ok, true)
})

test('deriveVisibleColumns preserves schema order, excludes laundry-set pointer Dimensions, and includes delegated display Dimensions', async () => {
  const { deriveVisibleColumns } = await loadListViewModel()
  const result = deriveVisibleColumns('laundry-set', {
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true },
      { id: 'washer', label: 'Washer', type: 'pointer', required: true },
      { id: 'washer.capacityKg', label: 'Washer Capacity', type: 'numeric', required: false },
      { id: 'bundlePrice', label: 'Bundle Price', type: 'numeric', required: true, unit: 'CNY' },
      { id: 'sourceUrl', label: 'Source URL', type: 'string', required: false }
    ]
  }, {
    resolutionContext: {
      ok: true,
      targets: {
        washer: {
          dimensionsById: new Map([['capacityKg', { id: 'capacityKg', type: 'numeric', unit: 'kg' }]])
        },
        dryer: {
          dimensionsById: new Map()
        }
      }
    }
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.columns.map((column) => column.id), ['brand', 'washer.capacityKg', 'bundlePrice', 'sourceUrl'])
  assert.equal(result.columns[1].unit, 'kg')
})

test('deriveVisibleColumns remains unchanged for non-laundry-set Appliances', async () => {
  const { deriveVisibleColumns } = await loadListViewModel()

  const result = deriveVisibleColumns('washer', {
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true },
      { id: 'price', label: 'Price', type: 'numeric', required: true, unit: 'CNY' }
    ]
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.columns.map((column) => column.id), ['brand', 'price'])
})

test('deriveVisibleColumns fails on duplicate ids and invalid visible metadata', async () => {
  const { deriveVisibleColumns } = await loadListViewModel()
  assert.equal(
    deriveVisibleColumns('washer', {
      dimensions: [
        { id: 'brand', label: 'Brand', type: 'string', required: true },
        { id: 'brand', label: 'Brand 2', type: 'string', required: true }
      ]
    }).ok,
    false
  )

  assert.equal(
    deriveVisibleColumns('washer', {
      dimensions: [
        { id: 'brand', label: 'Brand', type: 'string', required: true },
        { id: 'price', label: 'Price', type: 'numeric', required: 'yes' }
      ]
    }).ok,
    false
  )
})

test('deriveConsumableDefaultListOrder accepts visible rules and rejects unusable rules', async () => {
  const { deriveConsumableDefaultListOrder } = await loadListViewModel()
  const columns = [
    { id: 'price', type: 'numeric' },
    { id: 'brand', type: 'string' }
  ]

  assert.equal(
    deriveConsumableDefaultListOrder({
      defaultListOrder: [
        { dimensionId: 'price', direction: 'asc' },
        { dimensionId: 'brand', direction: 'desc' }
      ]
    }, columns).ok,
    true
  )

  assert.equal(
    deriveConsumableDefaultListOrder({
      defaultListOrder: [{ dimensionId: 'washer', direction: 'asc' }]
    }, columns).ok,
    false
  )
})

test('deriveCellToken renders known values and normalizes absent optional Evaluations to N/A', async () => {
  const { deriveCellToken } = await loadListViewModel()
  assert.deepEqual(
    deriveCellToken(
      { id: 'price', type: 'numeric', unit: 'CNY', required: true },
      { price: { status: 'known', value: 1999 } }
    ),
    {
      ok: true,
      cell: {
        kind: 'known',
        text: '1999 CNY',
        sortValue: 1999
      }
    }
  )

  assert.deepEqual(
    deriveCellToken(
      { id: 'warrantyMonths', type: 'numeric', required: false },
      {}
    ),
    {
      ok: true,
      cell: {
        kind: 'na',
        text: 'N/A',
        dataEvaluationState: 'na',
        className: 'evaluation-token evaluation-token--na',
        sortValue: null
      }
    }
  )

  assert.deepEqual(
    deriveCellToken(
      { id: 'finish', type: 'enum', required: false },
      { finish: { status: 'na' } }
    ),
    {
      ok: true,
      cell: {
        kind: 'na',
        text: 'N/A',
        dataEvaluationState: 'na',
        className: 'evaluation-token evaluation-token--na',
        sortValue: null
      }
    }
  )
})

test('deriveCellToken fails for missing required or malformed visible Evaluation data', async () => {
  const { deriveCellToken } = await loadListViewModel()
  assert.equal(
    deriveCellToken({ id: 'brand', type: 'string', required: true }, {}).category,
    'Missing required visible Evaluation data'
  )

  assert.equal(
    deriveCellToken(
      { id: 'hasInverterMotor', type: 'boolean', required: false },
      { hasInverterMotor: { status: 'known', value: 'true' } }
    ).category,
    'Malformed visible Evaluation data'
  )

  assert.equal(
    deriveCellToken(
      { id: 'price', type: 'numeric', required: false },
      { price: { status: 'known', value: Infinity } }
    ).category,
    'Malformed visible Evaluation data'
  )
})

test('deriveCellToken renders plain-text string, enum, and boolean known values plus explicit na tokens', async () => {
  const { deriveCellToken } = await loadListViewModel()

  assert.deepEqual(
    deriveCellToken(
      { id: 'brand', type: 'string', required: true },
      { brand: { status: 'known', value: '<strong>Brand</strong>' } }
    ),
    {
      ok: true,
      cell: {
        kind: 'known',
        text: '<strong>Brand</strong>',
        sortValue: '<strong>Brand</strong>'
      }
    }
  )

  assert.deepEqual(
    deriveCellToken(
      { id: 'finish', type: 'enum', required: true },
      { finish: { status: 'known', value: '<em>Graphite</em>' } }
    ),
    {
      ok: true,
      cell: {
        kind: 'known',
        text: '<em>Graphite</em>',
        sortValue: '<em>Graphite</em>'
      }
    }
  )

  assert.deepEqual(
    deriveCellToken(
      { id: 'isCompact', type: 'boolean', required: true },
      { isCompact: { status: 'known', value: false } }
    ),
    {
      ok: true,
      cell: {
        kind: 'known',
        text: 'False',
        sortValue: false
      }
    }
  )

  assert.deepEqual(
    deriveCellToken(
      { id: 'finish', type: 'enum', required: false },
      { finish: { status: 'na', value: 'ignored' } }
    ),
    {
      ok: true,
      cell: {
        kind: 'na',
        text: 'N/A',
        dataEvaluationState: 'na',
        className: 'evaluation-token evaluation-token--na',
        sortValue: null
      }
    }
  )
})

test('deriveOrderedRows sorts known values before N/A and preserves source order for full ties', async () => {
  const { deriveOrderedRows } = await loadListViewModel()
  const columns = [
    { id: 'brand', label: 'Brand', type: 'string', required: true },
    { id: 'price', label: 'Price', type: 'numeric', required: false }
  ]
  const rules = [{ dimensionId: 'price', direction: 'desc', type: 'numeric' }]

  const result = deriveOrderedRows([
    {
      id: 'row-1',
      evaluations: {
        brand: { status: 'known', value: 'Alpha' },
        price: { status: 'na' }
      }
    },
    {
      id: 'row-2',
      evaluations: {
        brand: { status: 'known', value: 'Beta' },
        price: { status: 'known', value: 800 }
      }
    },
    {
      id: 'row-3',
      evaluations: {
        brand: { status: 'known', value: 'Gamma' },
        price: { status: 'known', value: 800 }
      }
    }
  ], columns, rules)

  assert.equal(result.ok, true)
  assert.deepEqual(result.rows.map((row) => row.key), ['row-2', 'row-3', 'row-1'])
})

test('buildLoadSuccessView resolves delegated laundry-set values and keeps incomplete rows visible', async () => {
  const { buildLoadSuccessView } = await loadListViewModel()

  const result = buildLoadSuccessView({
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true },
      { id: 'washer', label: 'Washer', type: 'pointer', required: true },
      { id: 'dryer', label: 'Dryer', type: 'pointer', required: true },
      { id: 'washer.capacityKg', label: 'Washer Capacity', type: 'numeric', required: false },
      { id: 'bundlePrice', label: 'Bundle Price', type: 'numeric', required: true, unit: 'CNY' }
    ],
    defaultListOrder: [
      { dimensionId: 'washer.capacityKg', direction: 'asc' }
    ]
  }, [
    {
      id: 'set-1',
      evaluations: {
        brand: { status: 'known', value: 'BundleCo' },
        bundlePrice: { status: 'known', value: 2100 },
        washer: { status: 'known', value: 'washer-1' },
        dryer: { status: 'known', value: 'dryer-1' }
      }
    },
    {
      id: 'set-2',
      evaluations: {
        brand: { status: 'known', value: 'BrokenCo' },
        bundlePrice: { status: 'known', value: 2200 },
        washer: { status: 'na' },
        dryer: { status: 'known', value: 'dryer-1' }
      }
    }
  ], 'laundry-set', {
    washer: {
      schema: {
        dimensions: [
          { id: 'capacityKg', label: 'Capacity', type: 'numeric', required: true, unit: 'kg' }
        ]
      },
      options: [
        {
          id: 'washer-1',
          evaluations: {
            capacityKg: { status: 'known', value: 10 }
          }
        }
      ]
    },
    dryer: {
      schema: {
        dimensions: [
          { id: 'noiseLevelDb', label: 'Noise', type: 'numeric', required: false, unit: 'dB' }
        ]
      },
      options: [
        {
          id: 'dryer-1',
          evaluations: {
            noiseLevelDb: { status: 'known', value: 62 }
          }
        }
      ]
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.rows[0].key, 'set-1')
  assert.equal(result.rows[0].cells[1].text, '10 kg')
  assert.equal(result.rows[1].isIncomplete, true)
  assert.equal(result.rows[1].warning.text, 'Warning')
  assert.equal(result.rows[1].cells[1].text, 'N/A')
})

test('buildLoadSuccessView rejects delegated target-schema mismatches for laundry-set', async () => {
  const { buildLoadSuccessView } = await loadListViewModel()

  const result = buildLoadSuccessView({
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true },
      { id: 'washer.capacityKg', label: 'Washer Capacity', type: 'string', required: false }
    ],
    defaultListOrder: [
      { dimensionId: 'brand', direction: 'asc' }
    ]
  }, [], 'laundry-set', {
    washer: {
      schema: {
        dimensions: [
          { id: 'capacityKg', label: 'Capacity', type: 'numeric', required: true, unit: 'kg' }
        ]
      },
      options: []
    },
    dryer: {
      schema: { dimensions: [] },
      options: []
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.category, 'Schema unavailable or invalid')
})

test('deriveOrderedRows applies enum ordering case-insensitively with deterministic string tie-breaks', async () => {
  const { deriveOrderedRows } = await loadListViewModel()
  const columns = [
    { id: 'finish', label: 'Finish', type: 'enum', required: true }
  ]
  const rules = [{ dimensionId: 'finish', direction: 'asc', type: 'enum' }]

  const result = deriveOrderedRows([
    { id: 'row-1', evaluations: { finish: { status: 'known', value: 'beta' } } },
    { id: 'row-2', evaluations: { finish: { status: 'known', value: 'alpha' } } },
    { id: 'row-3', evaluations: { finish: { status: 'known', value: 'Alpha' } } }
  ], columns, rules)

  assert.equal(result.ok, true)
  assert.deepEqual(result.rows.map((row) => row.key), ['row-3', 'row-2', 'row-1'])
})

test('deriveOrderedRows applies boolean ordering for asc and desc rules', async () => {
  const { deriveOrderedRows } = await loadListViewModel()
  const columns = [
    { id: 'isCompact', label: 'Compact', type: 'boolean', required: true }
  ]

  const sourceRows = [
    { id: 'row-1', evaluations: { isCompact: { status: 'known', value: true } } },
    { id: 'row-2', evaluations: { isCompact: { status: 'known', value: false } } }
  ]

  const ascending = deriveOrderedRows(sourceRows, columns, [{ dimensionId: 'isCompact', direction: 'asc', type: 'boolean' }])
  const descending = deriveOrderedRows(sourceRows, columns, [{ dimensionId: 'isCompact', direction: 'desc', type: 'boolean' }])

  assert.equal(ascending.ok, true)
  assert.deepEqual(ascending.rows.map((row) => row.key), ['row-2', 'row-1'])
  assert.equal(descending.ok, true)
  assert.deepEqual(descending.rows.map((row) => row.key), ['row-1', 'row-2'])
})

test('deriveOrderedRows applies string ordering case-insensitively with deterministic tie-breaks', async () => {
  const { deriveOrderedRows } = await loadListViewModel()
  const columns = [
    { id: 'brand', label: 'Brand', type: 'string', required: true }
  ]
  const rules = [{ dimensionId: 'brand', direction: 'asc', type: 'string' }]

  const result = deriveOrderedRows([
    { id: 'row-1', evaluations: { brand: { status: 'known', value: 'beta' } } },
    { id: 'row-2', evaluations: { brand: { status: 'known', value: 'alpha' } } },
    { id: 'row-3', evaluations: { brand: { status: 'known', value: 'Alpha' } } }
  ], columns, rules)

  assert.equal(result.ok, true)
  assert.deepEqual(result.rows.map((row) => row.key), ['row-3', 'row-2', 'row-1'])
})

test('buildLoadSuccessView treats successful warnings as behaviorally inert', async () => {
  const { buildLoadSuccessView } = await loadListViewModel()
  const schema = {
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true }
    ],
    defaultListOrder: [
      { dimensionId: 'brand', direction: 'asc' }
    ],
    warnings: ['schema warning should be ignored']
  }

  const result = buildLoadSuccessView(schema, [
    {
      id: 'washer-1',
      evaluations: {
        brand: { status: 'known', value: 'Bosch' }
      }
    }
  ], 'washer')

  assert.equal(result.ok, true)
  assert.equal(result.status, 'ready')
  assert.equal(result.rows[0].cells[0].text, 'Bosch')
})

test('renderer shell template renders labels and string values as plain text only', async () => {
  const fs = require('node:fs/promises')
  const appVuePath = path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'App.vue')
  const comparisonPanelPath = path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'ComparisonPanel.vue')
  const optionListPanelPath = path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'OptionListPanel.vue')
  const appVue = await fs.readFile(appVuePath, 'utf8')
  const comparisonPanelVue = await fs.readFile(comparisonPanelPath, 'utf8')
  const optionListPanelVue = await fs.readFile(optionListPanelPath, 'utf8')

  assert.doesNotMatch(appVue, /v-html\s*=|innerHTML/)
  assert.doesNotMatch(comparisonPanelVue, /v-html\s*=|innerHTML/)
  assert.doesNotMatch(optionListPanelVue, /v-html\s*=|innerHTML/)
  assert.match(appVue, /\{\{ item\.label \}\}/)
  assert.match(comparisonPanelVue, /<span v-else>\{\{ cell\.text \}\}<\/span>/)
  assert.match(optionListPanelVue, /\{\{ column\.label \}\}/)
})

test('buildLoadSuccessView returns empty or ready and rejects malformed rows', async () => {
  const { buildLoadSuccessView } = await loadListViewModel()
  const schema = {
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true }
    ],
    defaultListOrder: [
      { dimensionId: 'brand', direction: 'asc' }
    ]
  }

  const emptyResult = buildLoadSuccessView(schema, [], 'washer')
  assert.equal(emptyResult.ok, true)
  assert.equal(emptyResult.status, 'empty')

  const invalidResult = buildLoadSuccessView(schema, [{ id: 'oops' }], 'washer')
  assert.equal(invalidResult.ok, false)
  assert.equal(invalidResult.category, 'Malformed Option rows')
})

test('deriveListFilters includes only direct visible filterable Dimensions in schema order', async () => {
  const { deriveVisibleColumns, deriveListFilters } = await loadListViewModel()
  const columns = deriveVisibleColumns('dryer', {
    dimensions: [
      { id: 'brand', label: 'Brand', type: 'string', required: true },
      { id: 'energyLevel', label: 'Energy', type: 'enum', required: true, allowedValues: ['A', 'B'] },
      { id: 'hasInverterMotor', label: 'Inverter', type: 'boolean', required: false },
      { id: 'price', label: 'Price', type: 'numeric', required: true, unit: 'CNY' }
    ]
  }).columns

  const filters = deriveListFilters(columns)
  assert.deepEqual(filters.map((filter) => filter.id), ['brand', 'energyLevel', 'hasInverterMotor', 'price'])
  assert.equal(filters[1].allowedValues[0], 'A')
})

test('list filter activation and matching semantics follow issue-7 rules', async () => {
  const {
    deriveListFilters,
    classifyRowAgainstFilters,
    deriveVisibleRows,
    patchListFilters
  } = await loadListViewModel()

  const columns = [
    { id: 'brand', label: 'Brand', type: 'string', required: true },
    { id: 'energy', label: 'Energy', type: 'enum', required: false, allowedValues: ['A', 'B'] },
    { id: 'inverter', label: 'Inverter', type: 'boolean', required: false },
    { id: 'price', label: 'Price', type: 'numeric', required: false }
  ]

  let filters = deriveListFilters(columns)
  filters = patchListFilters(columns, filters, { dimensionId: 'brand', patch: { mode: 'substring', value: 'alpha' } })
  filters = patchListFilters(columns, filters, { dimensionId: 'energy', patch: { selectedValues: ['A', 'B'] } })
  filters = patchListFilters(columns, filters, { dimensionId: 'inverter', patch: { value: true } })
  filters = patchListFilters(columns, filters, { dimensionId: 'price', patch: { min: '500', max: '1000' } })

  const completeRow = {
    key: 'complete',
    option: {
      evaluations: {
        brand: { status: 'known', value: 'Alpha Pro' },
        energy: { status: 'known', value: 'A' },
        inverter: { status: 'known', value: true },
        price: { status: 'known', value: 900 }
      }
    },
    cells: []
  }
  const warningRow = {
    key: 'warning',
    option: {
      evaluations: {
        brand: { status: 'known', value: 'Alpha Lite' },
        energy: { status: 'na' },
        inverter: { status: 'known', value: true },
        price: { status: 'known', value: 800 }
      }
    },
    cells: []
  }
  const rejectedRow = {
    key: 'reject',
    option: {
      evaluations: {
        brand: { status: 'known', value: 'Alpha Mini' },
        energy: { status: 'known', value: 'A' },
        inverter: { status: 'known', value: false },
        price: { status: 'known', value: 750 }
      }
    },
    cells: []
  }

  assert.equal(classifyRowAgainstFilters(completeRow, filters).matchKind, 'complete-match')
  const warningResult = classifyRowAgainstFilters(warningRow, filters)
  assert.equal(warningResult.matchKind, 'na-warning')
  assert.deepEqual(warningResult.filterWarningDimensionLabels, ['Energy'])
  assert.equal(classifyRowAgainstFilters(rejectedRow, filters).matchKind, 'reject')

  const visible = deriveVisibleRows([warningRow, rejectedRow, completeRow], filters)
  assert.equal(visible.hasActiveFilters, true)
  assert.deepEqual(visible.rows.map((row) => row.key), ['complete', 'warning'])
})

test('missing optional relevant Evaluation is treated as N/A keep while malformed data rejects', async () => {
  const { deriveListFilters, patchListFilters, classifyRowAgainstFilters } = await loadListViewModel()
  const columns = [{ id: 'warranty', label: 'Warranty', type: 'numeric', required: false }]
  let filters = deriveListFilters(columns)
  filters = patchListFilters(columns, filters, { dimensionId: 'warranty', patch: { min: '12' } })

  const missingResult = classifyRowAgainstFilters({ option: { evaluations: {} } }, filters)
  assert.equal(missingResult.matchKind, 'na-warning')

  const malformedResult = classifyRowAgainstFilters({ option: { evaluations: { warranty: { status: 'known', value: '12' } } } }, filters)
  assert.equal(malformedResult.matchKind, 'reject')
})
