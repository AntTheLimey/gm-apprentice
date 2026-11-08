// download.mjs <url> <dest>: fetch one file for tool_cache.py. Node does the
// download because it carries its own certificates, where a Python install
// may not; the caller checks the checksum.
import { writeFile } from 'node:fs/promises';

const [url, dest] = process.argv.slice(2);
try {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${url}`);
    process.exit(1);
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
} catch (err) {
  console.error(`${err.message}${err.cause ? ` (${err.cause.code || err.cause.message})` : ''} ${url}`);
  process.exit(1);
}
