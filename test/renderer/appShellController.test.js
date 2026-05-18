const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { pathToFileURL } = require('node:url')

async function loadControllerModule() {
  return import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'shell', 'appShellController.mjs')).href)
}

function createDeferred() {
  let resolve
  let reject

  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

test('boot falls back to washer error state when preload API is unavailable', async () => {
  const { createAppShellController } = await loadControllerModule()
  const controller = createAppShellController({
    apiProvider: () => undefined
  })

  await controller.boot()

  assert.equal(controller.getState().activeKey, 'washer')
  assert.equal(controller.getState().view.status, 'error')
  assert.match(controller.getState().view.message, /Washer could not be loaded\. Integration unavailable\./)
})

test('boot falls back to washer error state when schema discovery rejects', async () => {
  const { createAppShellController } = await loadControllerModule()
  const controller = createAppShellController({
    apiProvider: () => ({
      listSchemas: async () => Promise.reject(new Error('boom')),
      loadSchema: async () => ({ ok: true, schema: {} }),
      loadOptions: async () => ({ ok: true, options: [] })
    })
  })

  await controller.boot()

  assert.equal(controller.getState().activeKey, 'washer')
  assert.equal(controller.getState().view.status, 'error')
  assert.match(controller.getState().view.message, /Schema discovery unavailable\./)
})

test('boot falls back to washer error state when schema discovery envelope is malformed', async () => {
  const { createAppShellController } = await loadControllerModule()
  const controller = createAppShellController({
    apiProvider: () => ({
      listSchemas: async () => ({ warnings: ['ignored'] }),
      loadSchema: async () => ({ ok: true, schema: {} }),
      loadOptions: async () => ({ ok: true, options: [] })
    })
  })

  await controller.boot()

  assert.equal(controller.getState().activeKey, 'washer')
  assert.equal(controller.getState().view.status, 'error')
  assert.match(controller.getState().view.message, /Washer could not be loaded\. Schema discovery unavailable\./)
})

test('boot adopts discovery labels and loads ready state', async () => {
  const { createAppShellController } = await loadControllerModule()
  const controller = createAppShellController({
    apiProvider: () => ({
      listSchemas: async () => ({
        schemas: [
          { applianceKey: 'dryer', displayName: 'Dryers' }
        ]
      }),
      loadSchema: async () => ({
        ok: true,
        schema: {
          dimensions: [
            { id: 'brand', label: 'Brand', type: 'string', required: true }
          ],
          defaultListOrder: [
            { dimensionId: 'brand', direction: 'asc' }
          ]
        }
      }),
      loadOptions: async () => ({
        ok: true,
        options: [
          {
            id: 'dryer-1',
            evaluations: {
              brand: { status: 'known', value: 'Bosch' }
            }
          }
        ]
      })
    })
  })

  await controller.boot()

  assert.equal(controller.getState().activeKey, 'dryer')
  assert.equal(controller.getState().navigationItems.find((item) => item.key === 'dryer').label, 'Dryers')
  assert.equal(controller.getState().view.status, 'ready')
})

test('retry reloads the active Appliance without rerunning discovery', async () => {
  const { createAppShellController } = await loadControllerModule()
  let listSchemasCalls = 0
  let loadSchemaCalls = 0
  let loadOptionsCalls = 0
  let shouldFail = true

  const controller = createAppShellController({
    apiProvider: () => ({
      listSchemas: async () => {
        listSchemasCalls += 1
        return { schemas: [{ applianceKey: 'washer', displayName: 'Washer' }] }
      },
      loadSchema: async () => {
        loadSchemaCalls += 1
        return {
          ok: true,
          schema: {
            dimensions: [
              { id: 'brand', label: 'Brand', type: 'string', required: true }
            ],
            defaultListOrder: [
              { dimensionId: 'brand', direction: 'asc' }
            ]
          }
        }
      },
      loadOptions: async () => {
        loadOptionsCalls += 1
        if (shouldFail) {
          shouldFail = false
          throw new Error('load failed')
        }

        return {
          ok: true,
          options: [
            {
              id: 'washer-1',
              evaluations: {
                brand: { status: 'known', value: 'Midea' }
              }
            }
          ]
        }
      }
    })
  })

  await controller.boot()
  assert.equal(controller.getState().view.status, 'error')

  await controller.retry()

  assert.equal(listSchemasCalls, 1)
  assert.equal(loadSchemaCalls, 2)
  assert.equal(loadOptionsCalls, 2)
  assert.equal(controller.getState().view.status, 'ready')
})

test('loadSchema rejection routes the active view to error', async () => {
  const { createAppShellController } = await loadControllerModule()
  const controller = createAppShellController({
    apiProvider: () => ({
      loadSchema: async () => Promise.reject(new Error('schema boom')),
      loadOptions: async () => ({ ok: true, options: [] })
    })
  })

  await controller.selectAppliance('dryer')

  assert.equal(controller.getState().activeKey, 'dryer')
  assert.equal(controller.getState().view.status, 'error')
  assert.match(controller.getState().view.message, /Dryer could not be loaded\. Schema unavailable or invalid\./)
})

test('active view enters loading before settling ready', async () => {
  const { createAppShellController } = await loadControllerModule()
  const schemaDeferred = createDeferred()
  const optionsDeferred = createDeferred()
  const states = []

  const controller = createAppShellController({
    apiProvider: () => ({
      loadSchema: async () => schemaDeferred.promise,
      loadOptions: async () => optionsDeferred.promise
    })
  })

  const unsubscribe = controller.subscribe((state) => {
    states.push({
      activeKey: state.activeKey,
      status: state.view.status,
      message: state.view.message
    })
  })

  const loadPromise = controller.selectAppliance('dryer')
  await Promise.resolve()

  assert.deepEqual(states.at(-1), {
    activeKey: 'dryer',
    status: 'loading',
    message: 'Loading Dryer…'
  })

  schemaDeferred.resolve({
    ok: true,
    schema: {
      dimensions: [
        { id: 'brand', label: 'Brand', type: 'string', required: true }
      ],
      defaultListOrder: [
        { dimensionId: 'brand', direction: 'asc' }
      ]
    }
  })
  optionsDeferred.resolve({
    ok: true,
    options: [
      {
        id: 'dryer-1',
        evaluations: {
          brand: { status: 'known', value: 'Bosch' }
        }
      }
    ]
  })

  await loadPromise
  unsubscribe()

  assert.equal(controller.getState().view.status, 'ready')
})

test('loadOptions rejection routes the active view to error', async () => {
  const { createAppShellController } = await loadControllerModule()
  const controller = createAppShellController({
    apiProvider: () => ({
      loadSchema: async () => ({
        ok: true,
        schema: {
          dimensions: [
            { id: 'brand', label: 'Brand', type: 'string', required: true }
          ],
          defaultListOrder: [
            { dimensionId: 'brand', direction: 'asc' }
          ]
        }
      }),
      loadOptions: async () => Promise.reject(new Error('options boom'))
    })
  })

  await controller.selectAppliance('dryer')

  assert.equal(controller.getState().activeKey, 'dryer')
  assert.equal(controller.getState().view.status, 'error')
  assert.match(controller.getState().view.message, /Dryer could not be loaded\. Option data unavailable or invalid\./)
})

test('successful discovery, schema, and option warnings do not alter ready or empty outcomes', async () => {
  const { createAppShellController } = await loadControllerModule()

  const readyController = createAppShellController({
    apiProvider: () => ({
      listSchemas: async () => ({
        schemas: [{ applianceKey: 'washer', displayName: 'Washers' }],
        warnings: ['discovery warning']
      }),
      loadSchema: async () => ({
        ok: true,
        schema: {
          dimensions: [
            { id: 'brand', label: 'Brand', type: 'string', required: true }
          ],
          defaultListOrder: [
            { dimensionId: 'brand', direction: 'asc' }
          ]
        },
        warnings: ['schema warning']
      }),
      loadOptions: async () => ({
        ok: true,
        options: [
          {
            id: 'washer-1',
            evaluations: {
              brand: { status: 'known', value: 'Midea' }
            }
          }
        ],
        warnings: ['option warning']
      })
    })
  })

  await readyController.boot()
  assert.equal(readyController.getState().view.status, 'ready')

  const emptyController = createAppShellController({
    apiProvider: () => ({
      listSchemas: async () => ({
        schemas: [{ applianceKey: 'washer', displayName: 'Washers' }],
        warnings: ['discovery warning']
      }),
      loadSchema: async () => ({
        ok: true,
        schema: {
          dimensions: [
            { id: 'brand', label: 'Brand', type: 'string', required: true }
          ],
          defaultListOrder: [
            { dimensionId: 'brand', direction: 'asc' }
          ]
        },
        warnings: ['schema warning']
      }),
      loadOptions: async () => ({
        ok: true,
        options: [],
        warnings: ['option warning']
      })
    })
  })

  await emptyController.boot()
  assert.equal(emptyController.getState().view.status, 'empty')
})

test('same-Appliance retry ignores stale earlier failures', async () => {
  const { createAppShellController } = await loadControllerModule()
  const firstOptions = createDeferred()
  const secondOptions = createDeferred()
  let loadOptionsCall = 0

  const controller = createAppShellController({
    apiProvider: () => ({
      loadSchema: async () => ({
        ok: true,
        schema: {
          dimensions: [
            { id: 'brand', label: 'Brand', type: 'string', required: true }
          ],
          defaultListOrder: [
            { dimensionId: 'brand', direction: 'asc' }
          ]
        }
      }),
      loadOptions: async () => {
        loadOptionsCall += 1
        return loadOptionsCall === 1 ? firstOptions.promise : secondOptions.promise
      }
    })
  })

  const initialLoad = controller.selectAppliance('dryer')
  await Promise.resolve()
  const retryLoad = controller.retry()

  secondOptions.resolve({
    ok: true,
    options: [
      {
        id: 'dryer-fresh',
        evaluations: {
          brand: { status: 'known', value: 'Fresh Dryer' }
        }
      }
    ]
  })

  firstOptions.reject(new Error('stale failure'))

  await Promise.all([initialLoad, retryLoad])

  assert.equal(controller.getState().activeKey, 'dryer')
  assert.equal(controller.getState().view.status, 'ready')
  assert.equal(controller.getState().view.rows[0].key, 'dryer-fresh')
})

test('latest Appliance selection wins when stale responses resolve later', async () => {
  const { createAppShellController } = await loadControllerModule()
  const washerSchema = createDeferred()
  const dryerSchema = createDeferred()
  const washerOptions = createDeferred()
  const dryerOptions = createDeferred()

  const controller = createAppShellController({
    apiProvider: () => ({
      loadSchema: async (applianceKey) => {
        if (applianceKey === 'washer') {
          return washerSchema.promise
        }

        return dryerSchema.promise
      },
      loadOptions: async (applianceKey) => {
        if (applianceKey === 'washer') {
          return washerOptions.promise
        }

        return dryerOptions.promise
      }
    })
  })

  const washerLoad = controller.selectAppliance('washer')
  const dryerLoad = controller.selectAppliance('dryer')

  dryerSchema.resolve({
    ok: true,
    schema: {
      dimensions: [
        { id: 'brand', label: 'Brand', type: 'string', required: true }
      ],
      defaultListOrder: [
        { dimensionId: 'brand', direction: 'asc' }
      ]
    }
  })
  dryerOptions.resolve({
    ok: true,
    options: [
      {
        id: 'dryer-1',
        evaluations: {
          brand: { status: 'known', value: 'AEG' }
        }
      }
    ]
  })

  washerSchema.resolve({
    ok: true,
    schema: {
      dimensions: [
        { id: 'brand', label: 'Brand', type: 'string', required: true }
      ],
      defaultListOrder: [
        { dimensionId: 'brand', direction: 'asc' }
      ]
    }
  })
  washerOptions.resolve({
    ok: true,
    options: [
      {
        id: 'washer-1',
        evaluations: {
          brand: { status: 'known', value: 'Late Washer' }
        }
      }
    ]
  })

  await Promise.all([washerLoad, dryerLoad])

  assert.equal(controller.getState().activeKey, 'dryer')
  assert.equal(controller.getState().view.status, 'ready')
  assert.equal(controller.getState().view.rows[0].key, 'dryer-1')
})

test('changing active Appliance resets filters while same-Appliance retry preserves and reapplies them', async () => {
  const { createAppShellController } = await loadControllerModule()
  const apiState = {
    washerOptions: [
      {
        id: 'washer-1',
        evaluations: {
          brand: { status: 'known', value: 'Alpha' },
          price: { status: 'known', value: 900 }
        }
      },
      {
        id: 'washer-2',
        evaluations: {
          brand: { status: 'known', value: 'Beta' },
          price: { status: 'known', value: 1200 }
        }
      }
    ]
  }

  const controller = createAppShellController({
    apiProvider: () => ({
      listSchemas: async () => ({ schemas: [{ applianceKey: 'washer', displayName: 'Washer' }, { applianceKey: 'dryer', displayName: 'Dryer' }] }),
      loadSchema: async (applianceKey) => ({
        ok: true,
        schema: {
          dimensions: [
            { id: 'brand', label: 'Brand', type: 'string', required: true },
            { id: 'price', label: 'Price', type: 'numeric', required: true }
          ],
          defaultListOrder: [{ dimensionId: 'price', direction: 'asc' }],
          appliance: applianceKey
        }
      }),
      loadOptions: async (applianceKey) => ({
        ok: true,
        options: applianceKey === 'washer'
          ? apiState.washerOptions
          : [{ id: 'dryer-1', evaluations: { brand: { status: 'known', value: 'Dryer' }, price: { status: 'known', value: 700 } } }]
      })
    })
  })

  await controller.boot()
  await controller.updateFilters({ dimensionId: 'brand', patch: { value: 'Alpha', mode: 'exact' } })
  assert.equal(controller.getState().view.hasActiveFilters, true)
  assert.deepEqual(controller.getState().view.rows.map((row) => row.key), ['washer-1'])

  apiState.washerOptions = [
    {
      id: 'washer-3',
      evaluations: {
        brand: { status: 'known', value: 'Alpha' },
        price: { status: 'known', value: 800 }
      }
    }
  ]

  await controller.retry()
  assert.equal(controller.getState().view.filters[0].draft.value, 'Alpha')
  assert.deepEqual(controller.getState().view.rows.map((row) => row.key), ['washer-3'])

  await controller.selectAppliance('dryer')
  assert.equal(controller.getState().view.hasActiveFilters, false)
  assert.equal(controller.getState().view.filters[0].draft.value, '')
})

test('filtered-empty message is distinct from appliance-empty state', async () => {
  const { createAppShellController } = await loadControllerModule()
  const controller = createAppShellController({
    apiProvider: () => ({
      loadSchema: async () => ({
        ok: true,
        schema: {
          dimensions: [{ id: 'brand', label: 'Brand', type: 'string', required: true }],
          defaultListOrder: [{ dimensionId: 'brand', direction: 'asc' }]
        }
      }),
      loadOptions: async () => ({
        ok: true,
        options: [{ id: 'washer-1', evaluations: { brand: { status: 'known', value: 'Alpha' } } }]
      })
    })
  })

  await controller.retry()
  await controller.updateFilters({ dimensionId: 'brand', patch: { value: 'Nope', mode: 'exact' } })

  assert.equal(controller.getState().view.status, 'ready')
  assert.equal(controller.getState().view.rows.length, 0)
  assert.match(controller.getState().view.message, /No visible Options match the active Dimension filters/)
})

test('laundry-set loads supporting washer and dryer dependencies for delegated resolution', async () => {
  const { createAppShellController } = await loadControllerModule()
  const calls = []

  const controller = createAppShellController({
    apiProvider: () => ({
      loadSchema: async (applianceKey) => {
        calls.push(`schema:${applianceKey}`)
        if (applianceKey === 'laundry-set') {
          return {
            ok: true,
            schema: {
              dimensions: [
                { id: 'brand', label: 'Brand', type: 'string', required: true },
                { id: 'washer', label: 'Washer', type: 'pointer', required: true },
                { id: 'dryer', label: 'Dryer', type: 'pointer', required: true },
                { id: 'washer.capacityKg', label: 'Washer Capacity', type: 'numeric', required: false }
              ],
              defaultListOrder: [{ dimensionId: 'brand', direction: 'asc' }]
            }
          }
        }

        return {
          ok: true,
          schema: {
            dimensions: [
              applianceKey === 'washer'
                ? { id: 'capacityKg', label: 'Capacity', type: 'numeric', required: true, unit: 'kg' }
                : { id: 'noiseLevelDb', label: 'Noise', type: 'numeric', required: false, unit: 'dB' }
            ]
          }
        }
      },
      loadOptions: async (applianceKey) => {
        calls.push(`options:${applianceKey}`)
        if (applianceKey === 'laundry-set') {
          return {
            ok: true,
            options: [{
              id: 'set-1',
              evaluations: {
                brand: { status: 'known', value: 'Bundle' },
                washer: { status: 'known', value: 'washer-1' },
                dryer: { status: 'known', value: 'dryer-1' }
              }
            }]
          }
        }

        return {
          ok: true,
          options: [{
            id: `${applianceKey}-1`,
            evaluations: applianceKey === 'washer'
              ? { capacityKg: { status: 'known', value: 10 } }
              : { noiseLevelDb: { status: 'known', value: 61 } }
          }]
        }
      }
    })
  })

  await controller.selectAppliance('laundry-set')

  assert.equal(controller.getState().view.status, 'ready')
  assert.deepEqual(calls, [
    'schema:laundry-set',
    'options:laundry-set',
    'schema:washer',
    'options:washer',
    'schema:dryer',
    'options:dryer'
  ])
  assert.equal(controller.getState().view.rows[0].cells[1].text, '10 kg')
})

test('laundry-set supporting dependency failure routes the active view to error', async () => {
  const { createAppShellController } = await loadControllerModule()
  const controller = createAppShellController({
    apiProvider: () => ({
      loadSchema: async (applianceKey) => {
        if (applianceKey === 'laundry-set') {
          return {
            ok: true,
            schema: {
              dimensions: [
                { id: 'brand', label: 'Brand', type: 'string', required: true },
                { id: 'washer', label: 'Washer', type: 'pointer', required: true },
                { id: 'dryer', label: 'Dryer', type: 'pointer', required: true },
                { id: 'washer.capacityKg', label: 'Washer Capacity', type: 'numeric', required: false }
              ],
              defaultListOrder: [{ dimensionId: 'brand', direction: 'asc' }]
            }
          }
        }

        return Promise.reject(new Error('dependency load failed'))
      },
      loadOptions: async (applianceKey) => ({
        ok: true,
        options: applianceKey === 'laundry-set'
          ? [{
            id: 'set-1',
            evaluations: {
              brand: { status: 'known', value: 'Bundle' },
              washer: { status: 'known', value: 'washer-1' },
              dryer: { status: 'known', value: 'dryer-1' }
            }
          }]
          : []
      })
    })
  })

  await controller.selectAppliance('laundry-set')

  assert.equal(controller.getState().view.status, 'error')
  assert.match(controller.getState().view.message, /Laundry Set could not be loaded\. Schema unavailable or invalid\./)
})

test('incomplete laundry-set rows stay visible with warning metadata and remain filterable when a referenced Option is missing', async () => {
  const { createAppShellController } = await loadControllerModule()
  const controller = createAppShellController({
    apiProvider: () => ({
      loadSchema: async (applianceKey) => {
        if (applianceKey === 'laundry-set') {
          return {
            ok: true,
            schema: {
              dimensions: [
                { id: 'brand', label: 'Brand', type: 'string', required: true },
                { id: 'bundlePrice', label: 'Bundle Price', type: 'numeric', required: true },
                { id: 'washer', label: 'Washer', type: 'pointer', required: true },
                { id: 'dryer', label: 'Dryer', type: 'pointer', required: true },
                { id: 'washer.capacityKg', label: 'Washer Capacity', type: 'numeric', required: false }
              ],
              defaultListOrder: [{ dimensionId: 'bundlePrice', direction: 'asc' }]
            }
          }
        }

        return {
          ok: true,
          schema: {
            dimensions: applianceKey === 'washer'
              ? [{ id: 'capacityKg', label: 'Capacity', type: 'numeric', required: true, unit: 'kg' }]
              : [{ id: 'noiseLevelDb', label: 'Noise', type: 'numeric', required: false, unit: 'dB' }]
          }
        }
      },
      loadOptions: async (applianceKey) => {
        if (applianceKey === 'laundry-set') {
          return {
            ok: true,
            options: [
              {
                id: 'set-complete',
                evaluations: {
                  brand: { status: 'known', value: 'BundleCo' },
                  bundlePrice: { status: 'known', value: 2000 },
                  washer: { status: 'known', value: 'washer-1' },
                  dryer: { status: 'known', value: 'dryer-1' }
                }
              },
              {
                id: 'set-incomplete',
                evaluations: {
                  brand: { status: 'known', value: 'BrokenCo' },
                  bundlePrice: { status: 'known', value: 2100 },
                  washer: { status: 'known', value: 'washer-missing' },
                  dryer: { status: 'known', value: 'dryer-1' }
                }
              }
            ]
          }
        }

        if (applianceKey === 'washer') {
          return {
            ok: true,
            options: [
              {
                id: 'washer-1',
                evaluations: { capacityKg: { status: 'known', value: 10 } }
              }
            ]
          }
        }

        return {
          ok: true,
          options: [
            {
              id: 'dryer-1',
              evaluations: { noiseLevelDb: { status: 'known', value: 61 } }
            }
          ]
        }
      }
    })
  })

  await controller.selectAppliance('laundry-set')

  assert.equal(controller.getState().view.status, 'ready')
  assert.deepEqual(controller.getState().view.rows.map((row) => row.key), ['set-complete', 'set-incomplete'])
  assert.equal(controller.getState().view.rows[1].isIncomplete, true)
  assert.deepEqual(controller.getState().view.rows[1].warning, {
    text: 'Warning',
    title: 'Warning: Missing delegated reference for washer.',
    missingReferences: ['washer']
  })

  await controller.updateFilters({ dimensionId: 'brand', patch: { mode: 'exact', value: 'BrokenCo' } })

  assert.equal(controller.getState().view.status, 'ready')
  assert.deepEqual(controller.getState().view.rows.map((row) => row.key), ['set-incomplete'])
  assert.equal(controller.getState().view.rows[0].isIncomplete, true)
  assert.equal(controller.getState().view.rows[0].warning.title, 'Warning: Missing delegated reference for washer.')
})
