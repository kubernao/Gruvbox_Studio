/**
 * Escapes ` and ${ inside ASCII_VARIANTS template literals.
 * Run after editing assets/toolbar-ascii-variants.ts (e.g. figlet regen).
 * 
 * The raw ASCII text for the brand logo is not able to be rendered directly, 
 * it has to be processed here (Keeping readability in the source file) 
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(__dirname, '..', 'assets', 'toolbar-ascii-variants.ts');

function escapeTemplateContent(content) {
  return content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const s = fs.readFileSync(inputPath, 'utf8');
const startMarker = 'export const ASCII_VARIANTS: string[] = [';
const startIdx = s.indexOf(startMarker);
if (startIdx === -1) throw new Error(`Missing ${JSON.stringify(startMarker)}`);

let out = s.slice(0, startIdx + startMarker.length);
let i = startIdx + startMarker.length;

while (i < s.length) {
  while (i < s.length && /\s/.test(s[i]) && s[i] !== '`') {
    out += s[i];
    i++;
  }
  if (i >= s.length) break;
  if (s[i] !== '`') {
    out += s.slice(i);
    break;
  }
  i++;
  let content = '';
  let closed = false;
  while (i < s.length && !closed) {
    if (s[i] !== '`') {
      content += s[i];
      i++;
      continue;
    }
    if (s[i + 1] === ',') {
      out += '`' + escapeTemplateContent(content) + '`,';
      i += 2;
      closed = true;
      break;
    }
    if (s[i + 1] === ']' && s[i + 2] === ';') {
      out += '`' + escapeTemplateContent(content) + '`' + s.slice(i + 1);
      i = s.length;
      closed = true;
      break;
    }
    content += '`';
    i++;
  }
  if (!closed) throw new Error(`Unclosed template at offset ${i}`);
}

fs.writeFileSync(inputPath, out, 'utf8');
console.log('Escaped backticks in', inputPath);
