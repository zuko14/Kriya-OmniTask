import fs from 'node:fs';
import path from 'node:path';

function translateDdlForPostgres(sql) {
  let translated = sql
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bdatetime\s*\(\s*['"]now['"]\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bBOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+0\b/gi, 'BOOLEAN NOT NULL DEFAULT false')
    .replace(/\bBOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+1\b/gi, 'BOOLEAN NOT NULL DEFAULT true')
    .replace(/\bBOOLEAN\s+DEFAULT\s+0\b/gi, 'BOOLEAN DEFAULT false')
    .replace(/\bBOOLEAN\s+DEFAULT\s+1\b/gi, 'BOOLEAN DEFAULT true')
    .replace(/\bALTER\s+TABLE\s+([a-zA-Z0-9_]+)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/gi, 'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS ')
    .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\s+/gi, 'INSERT INTO ')
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\s+/gi, 'INSERT INTO ');

  translated = translated.replace(
    /(INSERT\s+INTO\s+dna_profiles\s*\([^)]+\)\s*VALUES\s*\([\s\S]+?\))\s*;/gi,
    (match, p1) => match.includes('ON CONFLICT') ? match : `${p1} ON CONFLICT (id) DO NOTHING;`
  );
  translated = translated.replace(
    /(INSERT\s+INTO\s+brain_catalogue\s*\([^)]+\)\s*VALUES\s*[\s\S]+?\))\s*;/gi,
    (match, p1) => match.includes('ON CONFLICT') ? match : `${p1} ON CONFLICT (id) DO NOTHING;`
  );
  translated = translated.replace(
    /(INSERT\s+INTO\s+roles\s*\([^)]+\)\s*VALUES\s*[\s\S]+?\))\s*;/gi,
    (match, p1) => match.includes('ON CONFLICT') ? match : `${p1} ON CONFLICT (id) DO NOTHING;`
  );

  translated = translated.replace(/^[ \t]*--\s*(?:PG|POSTGRES):\s*(.+)$/gim, '$1');
  return translated;
}

const dir = path.join(process.cwd(), 'src', 'storage', 'migrations');
const files = fs.readdirSync(dir).filter(f => f.match(/^\d+_.+\.sql$/)).sort();

const batches = [
  { name: 'batch1_002_015', start: 2, end: 15 },
  { name: 'batch2_016_030', start: 16, end: 30 },
  { name: 'batch3_031_045', start: 31, end: 45 },
  { name: 'batch4_046_058', start: 46, end: 58 }
];

batches.forEach(b => {
  let sql = '';
  files.forEach(f => {
    const num = parseInt(f.split('_')[0], 10);
    if (num >= b.start && num <= b.end) {
      const match = f.match(/^(\d+)_(.+)\.sql$/);
      const version = match[1];
      const name = match[2];
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      sql += `\n-- Migration ${version}: ${name}\n`;
      sql += translateDdlForPostgres(raw).trim() + '\n\n';
      sql += `INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('${version}', '${name}', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;\n`;
    }
  });
  fs.writeFileSync(path.join('supabase', `${b.name}.sql`), sql, 'utf8');
  console.log(`Created supabase/${b.name}.sql (${sql.length} chars)`);
});
