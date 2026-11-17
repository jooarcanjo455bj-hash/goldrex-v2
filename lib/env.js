const fs = require('fs');
const path = require('path');

module.exports = function loadEnv(root, { skipInTest = true } = {}) {
  if (skipInTest && process.env.NODE_ENV === 'test') return;

  let content;
  try {
    content = fs.readFileSync(path.join(root, '.env'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
};
