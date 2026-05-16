const fs = require('fs')
const path = require('path')
const Module = require('module')

function loadCommonJsModule(modulePath, mocks = {}) {
  const absoluteModulePath = path.resolve(modulePath)
  const fileContents = fs.readFileSync(absoluteModulePath, 'utf8')
  const loadedModule = new Module(absoluteModulePath, module)

  loadedModule.filename = absoluteModulePath
  loadedModule.paths = Module._nodeModulePaths(path.dirname(absoluteModulePath))

  const realRequire = Module.createRequire(absoluteModulePath)
  loadedModule.require = (request) => {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request]
    }

    return realRequire(request)
  }

  loadedModule._compile(fileContents, absoluteModulePath)
  return loadedModule.exports
}

module.exports = {
  loadCommonJsModule
}
