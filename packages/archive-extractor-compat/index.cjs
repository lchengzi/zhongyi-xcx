'use strict';
// download@7 requires a callable CommonJS export that returns a Promise.
// Keep this as interop glue; the maintained package performs all extraction.
module.exports = (...args) => import('@xhmikosr/decompress')
  .then(({ default: decompress }) => decompress(...args));
