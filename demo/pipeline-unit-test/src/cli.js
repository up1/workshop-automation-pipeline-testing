#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const { run } = require('./runner');
const { writeReport } = require('./report');

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  return o;
}

async function main() {
  const o = args();
  if (o.help || o.h) {
    console.log(`Usage: node src/cli.js [options]
  --mapping <file.xlsx>   Mapping Specification  (default input/mapping_spec.xlsx)
  --ddl <dir>             DDL (.sql)             (default input/ddl)
  --sql <dir>             Load scripts (.sql)    (default input/sql)
  --data <dir>            Sample data (.csv/.json/.xlsx)  (default input/data)
  --out <file.xlsx>       Report output          (default output/unit_test_report.xlsx)
Exit code: 0 = ไม่มี FAIL, 1 = มี FAIL (ใช้กับ CI ได้)`);
    return 0;
  }
  const cfg = {
    mappingFile: path.resolve(o.mapping || 'input/mapping_spec.xlsx'),
    ddlDir: path.resolve(o.ddl || 'input/ddl'),
    sqlDir: path.resolve(o.sql || 'input/sql'),
    dataDir: path.resolve(o.data || 'input/data'),
  };
  const out = path.resolve(o.out || 'output/unit_test_report.xlsx');
  if (!fs.existsSync(cfg.mappingFile)) { console.error('ไม่พบ Mapping Spec:', cfg.mappingFile); return 2; }

  const result = await run(cfg);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await writeReport(result, out);

  const s = result.summary;
  console.log(`\nUnit Test: ${s.total} cases | PASS ${s.PASS} | FAIL ${s.FAIL} | WARN ${s.WARN} | SKIPPED ${s.SKIPPED}`);
  console.log(`Verdict : ${s.verdict}  (pass rate ${(s.passRate * 100).toFixed(1)}%)`);
  console.log(`Report  : ${out}`);
  return s.FAIL > 0 ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(2); });
