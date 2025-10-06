// lib/ajv.js
'use strict';

const Ajv2020 = require('ajv/dist/2020');      // Ajv v8 2020-dialect constructor
const addFormats = require('ajv-formats');

function safeAdd(ajv, schema) {
  try {
    ajv.addSchema(schema);
  } catch (e) {
    // Ignore duplicate registration if the same process calls createAjv() multiple times
    if (!e || !String(e.message || e).includes('already exists')) throw e;
  }
}

module.exports = function createAjv() {
  // We only need to validate data, not the schemas themselves at runtime.
  const ajv = new Ajv2020({
    strict: false,          // be permissive for dev tooling
    allErrors: true,        // collect all errors
    allowUnionTypes: true,
    validateSchema: false,  // <-- don't validate our schemas against metas at runtime
    meta: false             // <-- don't pre-register any JSON Schema metas
  });

  addFormats(ajv);

  // Register our local schemas by $id so $ref resolves offline
  safeAdd(ajv, require('../schema/types.common.v1.schema.json'));
  safeAdd(ajv, require('../schema/aimtable.v1.schema.json'));
  safeAdd(ajv, require('../schema/hierarchy.v1.schema.json'));
  safeAdd(ajv, require('../schema/plannerbundle.v1.schema.json'));

  return ajv;
};
