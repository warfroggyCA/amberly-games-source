// Use the repository's installed compiler; no additional test packages.
// Webpack loads CommonJS loaders synchronously.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require("typescript");
module.exports = function (source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
};
