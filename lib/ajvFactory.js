// lib/ajvFactory.js
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats").default;

function makeAjv() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true
    // Draft 2020-12 metas are preloaded by Ajv2020 – do not add manually.
  });
  addFormats(ajv);
  return ajv;
}

module.exports = { makeAjv };
