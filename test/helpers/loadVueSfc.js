const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

function loadVueSfc(filePath, cache = new Map()) {
  const absolutePath = path.resolve(filePath)

  if (cache.has(absolutePath)) {
    return cache.get(absolutePath)
  }

  const source = fs.readFileSync(absolutePath, 'utf8')
  const { descriptor } = parse(source, { filename: absolutePath })
  const scopeId = crypto.createHash('sha1').update(absolutePath).digest('hex').slice(0, 8)
  const script = compileScript(descriptor, {
    id: scopeId,
    genDefaultAs: '__sfc__'
  })

  let compiledCode = transformImports(script.content)

  if (descriptor.template) {
    const template = compileTemplate({
      id: scopeId,
      filename: absolutePath,
      source: descriptor.template.content,
      bindingMetadata: script.bindings
    })

    compiledCode += `\n${transformImports(template.code).replace('export function render', 'function render')}\n`
    compiledCode += '\n__sfc__.render = render\n'
  }

  compiledCode += '\nmodule.exports = __sfc__\n'

  const loadedModule = new Module(absolutePath, module)
  const realRequire = Module.createRequire(absolutePath)
  loadedModule.filename = absolutePath
  loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath))
  loadedModule.require = (request) => {
    if (request.endsWith('.vue')) {
      return loadVueSfc(path.resolve(path.dirname(absolutePath), request), cache)
    }

    return realRequire(request)
  }

  loadedModule._compile(compiledCode, absolutePath)
  cache.set(absolutePath, loadedModule.exports)
  return loadedModule.exports
}

function transformImports(code) {
  return code.replace(/^(import\s+([^\n]+?)\s+from\s+['"]([^'"]+)['"]\s*)$/gm, (_match, _statement, specifiers, request) => {
    const trimmedSpecifiers = specifiers.trim()

    if (trimmedSpecifiers.startsWith('{') && trimmedSpecifiers.endsWith('}')) {
      const namedImports = trimmedSpecifiers
        .slice(1, -1)
        .split(',')
        .map((specifier) => specifier.trim())
        .filter(Boolean)
        .map((specifier) => specifier.replace(/\s+as\s+/g, ': '))
        .join(', ')

      return `const { ${namedImports} } = require('${request}')`
    }

    return `const ${trimmedSpecifiers} = require('${request}')`
  })
}

module.exports = {
  loadVueSfc
}
