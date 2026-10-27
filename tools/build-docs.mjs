/**
 * 把 public/ 同步到 docs/，给 GitHub Pages 的「分支 + /docs」方式用。
 * 改完页面记得跑一次：node tools/build-docs.mjs
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'public');
const dest = path.join(root, 'docs');

await fsp.rm(dest, { recursive: true, force: true });
await fsp.cp(src, dest, { recursive: true });

const files = await fsp.readdir(dest);
console.log(`已同步 ${files.length} 个文件到 docs/：${files.join(', ')}`);
