import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(process.cwd(), 'src', 'storage', 'migrations');
const distDir = join(process.cwd(), 'dist', 'storage', 'migrations');

if (existsSync(srcDir)) {
  mkdirSync(distDir, { recursive: true });
  cpSync(srcDir, distDir, { recursive: true });
  console.log('✅ Successfully copied SQL migrations to dist/storage/migrations');
}
