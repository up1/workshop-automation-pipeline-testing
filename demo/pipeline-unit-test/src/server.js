'use strict';
/** Web UI สำหรับ Upload เอกสารทั้งหมด -> รัน Unit Test -> ดาวน์โหลดรายงาน Excel */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./runner');
const { writeReport } = require('./report');

const app = express();
const upload = multer({ dest: path.join(os.tmpdir(), 'pipeline-ut-uploads'), limits: { fileSize: 50 * 1024 * 1024 } });
const fields = upload.fields([{ name: 'mapping', maxCount: 1 }, { name: 'ddl' }, { name: 'sql' }, { name: 'data' }]);

app.get('/', (_req, res) => res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Pipeline Unit Test</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px}label{display:block;margin-top:16px;font-weight:600}small{color:#666;font-weight:400}button{margin-top:24px;padding:10px 20px;font-size:16px}</style>
<h2>Data Pipeline Unit Test</h2>
<form method="post" action="/run" enctype="multipart/form-data">
<label>Mapping Specification (.xlsx)<br><input type="file" name="mapping" accept=".xlsx" required></label>
<label>DDL (.sql) <small>เลือกได้หลายไฟล์</small><br><input type="file" name="ddl" accept=".sql,.ddl" multiple required></label>
<label>SQL Scripts (.sql) <small>เลือกได้หลายไฟล์</small><br><input type="file" name="sql" accept=".sql" multiple required></label>
<label>Sample Data (.csv/.json/.xlsx) <small>ชื่อไฟล์ = ชื่อตาราง</small><br><input type="file" name="data" accept=".csv,.json,.xlsx" multiple required></label>
<button>Run &amp; Download Report</button></form>`));

app.post('/run', fields, async (req, res) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-run-'));
  try {
    const f = req.files || {};
    if (!f.mapping) return res.status(400).send('ต้องแนบ Mapping Spec (.xlsx)');
    const place = (list, dir) => { fs.mkdirSync(path.join(work, dir), { recursive: true }); for (const x of list || []) fs.copyFileSync(x.path, path.join(work, dir, path.basename(x.originalname))); };
    place(f.ddl, 'ddl'); place(f.sql, 'sql'); place(f.data, 'data');
    const mappingFile = path.join(work, 'mapping_spec.xlsx');
    fs.copyFileSync(f.mapping[0].path, mappingFile);
    const result = await run({ mappingFile, ddlDir: path.join(work, 'ddl'), sqlDir: path.join(work, 'sql'), dataDir: path.join(work, 'data') });
    const out = path.join(work, 'unit_test_report.xlsx');
    await writeReport(result, out);
    res.setHeader('X-Verdict', result.summary.verdict);
    res.download(out, `unit_test_report_${new Date().toISOString().slice(0, 10)}.xlsx`, () => fs.rmSync(work, { recursive: true, force: true }));
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    res.status(500).send('Error: ' + e.message);
  } finally {
    for (const l of Object.values(req.files || {})) for (const x of l) fs.rmSync(x.path, { force: true });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Upload UI: http://localhost:${port}`));
