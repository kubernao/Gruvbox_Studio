const fs = require('node:fs');
const path = require('node:path');

const generatedFiles = [
  path.join(__dirname, '..', 'submodules', 'pi-mono', 'packages', 'ai', 'src', 'models.generated.ts'),
];

const requiredHeader = "This file is auto-generated";

const missing = [];
const invalid = [];

for (const filePath of generatedFiles) {
  if (!fs.existsSync(filePath)) {
    missing.push(filePath);
    continue;
  }
  const contents = fs.readFileSync(filePath, 'utf8');
  if (!contents.includes(requiredHeader)) {
    invalid.push(filePath);
  }
}

if (missing.length || invalid.length) {
  if (missing.length) {
    console.error('Missing generated artifacts:');
    for (const filePath of missing) {
      console.error(` - ${filePath}`);
    }
  }
  if (invalid.length) {
    console.error('Generated artifacts missing required auto-generated header:');
    for (const filePath of invalid) {
      console.error(` - ${filePath}`);
    }
  }
  process.exit(1);
}

console.log('Generated artifacts verified.');
