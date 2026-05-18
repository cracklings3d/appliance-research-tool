const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')

function readRendererFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('comparison panel keeps horizontal overflow enabled for wide column sets', () => {
  const source = readRendererFile('src/renderer/src/components/ComparisonPanel.vue')

  assert.match(source, /<div v-else class="comparison-table-wrap">/)
  assert.match(source, /\.comparison-table-wrap\s*\{[\s\S]*overflow-x:\s*auto;/)
  assert.match(source, /\.comparison-table\s*\{[\s\S]*min-width:\s*max-content;/)
})

test('active list view exposes compare toggles from the option list surface and app shell wires them', () => {
  const listPanelSource = readRendererFile('src/renderer/src/components/OptionListPanel.vue')
  const appSource = readRendererFile('src/renderer/src/App.vue')

  assert.match(listPanelSource, /<th scope="col">Compare<\/th>/)
  assert.match(listPanelSource, /type="checkbox"/)
  assert.match(listPanelSource, /@change="\$emit\('toggle-option', row\.key\)"/)
  assert.match(appSource, /:selected-option-ids="comparison\.selectedOptionIds"/)
  assert.match(appSource, /@toggle-option="toggleOptionSelection"/)
})

test('comparison panel renders an explicit empty state before any option is selected', () => {
  const source = readRendererFile('src/renderer/src/components/ComparisonPanel.vue')

  assert.match(source, /comparison\.selectedOptions\.length === 0/)
  assert.match(source, /Select one or more Options from the active list to start a side-by-side Comparison\./)
})

test('comparison panel exposes renderer preset save, apply, and delete interactions', () => {
  const source = readRendererFile('src/renderer/src/components/ComparisonPanel.vue')

  assert.match(source, /placeholder="Preset name"/)
  assert.match(source, /@click="\$emit\('save-preset'\)"/)
  assert.match(source, /@click="\$emit\('apply-preset', preset\.id\)"/)
  assert.match(source, /@click="\$emit\('delete-preset', preset\.id\)"/)
})

test('comparison panel renders visible Warning evidence and greyed incomplete comparison styling hooks', () => {
  const source = readRendererFile('src/renderer/src/components/ComparisonPanel.vue')

  assert.match(source, /option\.warning/)
  assert.match(source, /comparison-option-warning/)
  assert.match(source, /:title="option\.warning\.title"/)
  assert.match(source, /comparison-option--incomplete/)
  assert.match(source, /data-incomplete-comparison-option/)
})
