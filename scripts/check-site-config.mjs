/**
 * Reports which outbound destinations are configured.
 *
 *   npm run check:config
 *
 * Nothing here invents a URL. The build deliberately still succeeds without
 * them — an unconfigured call to action is simply not rendered, which is
 * better than shipping a button that goes nowhere — so this is a visible
 * reminder rather than a gate. Pass `--strict` (CI does, on release branches)
 * to turn a missing destination into a non-zero exit.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './media/lib/media.mjs';

const KEYS = [
  {
    name: 'VITE_CONTACT_URL',
    label: 'START A PROJECT',
    hint: 'the APK contact page, form or mailto: address',
  },
  {
    name: 'VITE_PORTFOLIO_URL',
    label: 'VIEW MORE WORK',
    hint: 'the portfolio index this piece belongs to',
  },
  {
    name: 'VITE_SITE_ORIGIN',
    label: 'canonical / og:image',
    hint: 'the absolute origin the site is published under',
  },
];

async function readDotEnv() {
  const values = new Map();
  for (const file of ['.env', '.env.local']) {
    let contents;
    try {
      contents = await readFile(path.join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of contents.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[1]) values.set(match[1], (match[2] ?? '').trim());
    }
  }
  return values;
}

const strict = process.argv.includes('--strict');
const dotEnv = await readDotEnv();
const missing = [];

console.log('Site configuration');
console.log('------------------');
for (const key of KEYS) {
  const value = process.env[key.name]?.trim() || dotEnv.get(key.name) || '';
  if (value) {
    console.log(`  ok      ${key.name.padEnd(20)} ${value}`);
  } else {
    missing.push(key);
    console.log(`  not set ${key.name.padEnd(20)} (${key.hint})`);
  }
}

if (missing.length > 0) {
  console.log('');
  for (const key of missing) {
    console.log(`  "${key.label}" will not be rendered until ${key.name} is set.`);
  }
  console.log('  Set them in .env (see .env.example) or as repository variables.');
  if (strict) process.exitCode = 1;
}
