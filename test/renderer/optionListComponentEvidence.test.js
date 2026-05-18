const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')

function readRendererFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('read-only option list exposes schema-derived filters row Warning copy and N/A presentation hooks', () => {
  const source = readRendererFile('src/renderer/src/components/OptionListPanel.vue')

  assert.match(source, /v-for="filter in view\.filters"/)
  assert.match(source, /Warning: Active filters hit N\/A for/)
  assert.match(source, /cell\.kind === 'na'/)
  assert.match(source, /data-evaluation-state="cell\.dataEvaluationState"|:data-evaluation-state="cell\.dataEvaluationState"/)
})

test('option list panel renders visible Warning badge hover binding and incomplete row styling hooks', () => {
  const source = readRendererFile('src/renderer/src/components/OptionListPanel.vue')

  assert.match(source, /row\.warning/)
  assert.match(source, /row-warning-badge/)
  assert.match(source, /:title="row\.warning\.title"/)
  assert.match(source, />\s*Warning\s*</)
  assert.match(source, /option-row--incomplete/)
  assert.match(source, /data-incomplete-row/)
})
