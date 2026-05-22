const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMapGitError() {
  const mainPath = path.join(__dirname, '../../src/electron-main/main.js');
  const source = fs.readFileSync(mainPath, 'utf8');
  const start = source.indexOf('function mapGitError(');
  const end = source.indexOf('// Git provider IPC handlers', start);
  if (start === -1 || end === -1) {
    throw new Error('Unable to locate mapGitError function in main.js');
  }
  const functionSource = `${source.slice(start, end)}\nmodule.exports = { mapGitError };`;
  const sandbox = {
    module: { exports: {} },
    exports: {},
    process: { on: () => {} },
    console: { error: () => {} },
  };
  vm.runInNewContext(functionSource, sandbox);
  return sandbox.module.exports.mapGitError;
}

test('mapGitError classifies pathspec errors as pathspec_not_found', () => {
  const mapGitError = loadMapGitError();
  const result = mapGitError("fatal: pathspec 'gruvbox/memory/project-memory.json' did not match any file");
  assert.equal(result.code, 'pathspec_not_found');
});

test('mapGitError keeps revision lookup failures as ref_not_found', () => {
  const mapGitError = loadMapGitError();
  const result = mapGitError('fatal: unknown revision or path not in the working tree');
  assert.equal(result.code, 'ref_not_found');
});
