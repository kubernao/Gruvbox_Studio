'use strict';

const fs = require('fs');

/**
 * Whether the editor should treat the path as read-only for typing.
 * Uses O_RDWR probe; only EACCES/EPERM count as readonly (EBUSY etc. stay editable in UI).
 *
 * @param {string} filePath
 * @param {import('fs').Stats} stats
 * @returns {boolean}
 */
function getPermissionsReadonly(filePath, stats) {
  if (!stats.isFile()) {
    return false;
  }
  try {
    const fd = fs.openSync(filePath, fs.constants.O_RDWR);
    fs.closeSync(fd);
    return false;
  } catch (e) {
    const code = e && e.code;
    return code === 'EACCES' || code === 'EPERM';
  }
}

module.exports = { getPermissionsReadonly };
