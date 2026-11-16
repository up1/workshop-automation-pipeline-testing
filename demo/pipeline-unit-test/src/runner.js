'use strict';
const fs = require('fs');
const path = require('path');

// node:sqlite ยังเป็น experimental: ซ่อน warning เฉพาะของมัน
const _emit = process.emitWarning;
process.emitWarning = (w, ...a) => (/SQLite/i.test(String(w)) ? undefined : _emit.call(process, w, ...a));
const { DatabaseSync } = require('node:sqlite');

const U = require('./util');
const R = require('./readers');
const S = require('./staticChecks');
const { Collector } = require('./collector');

const fmt = (v) => (v == null ? 'NULL' : typeof v === 'string' ? `'${v.length > 60 ? v.slice(0, 57) + '...' : v}'` : String(v));
const sameValue = (a, b, tol) => {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a), y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) <= tol : String(a) === String(b);
  }
  return String(a) === String(b);
};
const keyStr = (arr) => arr.map((v) => (v == null ? '∅' : String(v))).join(' | ');

async function run({ mappingFile, ddlDir, sqlDir, dataDir }) {
  const C = new Collector();
  const meta = { startedAt: new Date(), inputs: [] };

  // ============================================================ 1) Read inputs
  const mapping = await R.readMapping(mappingFile);
  const ddlFiles = R.readText(ddlDir, ['.sql', '.ddl']);
  const ddl = {};
  for (const f of ddlFiles) Object.assign(ddl, R.parseDDL(f.text));
  const scripts = R.readText(sqlDir, ['.sql']).map((f) => ({ ...f, parsed: R.parseLoadScript(f.text), done: false }));
  const data = await R.readSampleData(dataDir);

  meta.inputs.push({ type: 'Mapping Spec', name: path.basename(mappingFile), info: `${mapping.tables.length} tables, ${mapping.columns.length} column mappings` });
  for (const f of ddlFiles) meta.inputs.push({ type: 'DDL', name: f.file, info: `${Object.keys(R.parseDDL(f.text)).length} tables` });
  for (const s of scripts) meta.inputs.push({ type: 'SQL Script', name: s.file, info: `${s.parsed.statements.length} statements, ${s.parsed.inserts.length} INSERT..SELECT` });
  for (const [k, d] of Object.entries(data)) meta.inputs.push({ type: 'Sample Data', name: d.file, info: `${k}: ${d.rows.length} rows` });
  meta.warnings = mapping.warnings;

  // ---- สร้างโครงสร้างตาราง target
  const tables = mapping.tables.map((t) => ({ spec: t, key: U.key(t.target), name: t.target, cols: [], scripts: [], load: { ok: false, reason: '' } }));
  for (const c of mapping.columns) {
    let t = tables.find((x) => x.key === U.key(c.target));
    if (!t) { t = { spec: { target: c.target, order: 999, sqlFile: '', from: '', where: '', groupBy: '' }, key: U.key(c.target), name: c.target, cols: [], scripts: [], load: { ok: false, reason: '' } }; tables.push(t); }
    t.cols.push({ ...c, key: U.key(c.column) });
  }
  const targetKeys = new Set(tables.map((t) => t.key));
  const sourceKeys = Object.keys(ddl).filter((k) => !targetKeys.has(k));

  // ---- จับคู่ SQL script กับตาราง
  for (const t of tables) {
    const byName = t.spec.sqlFile ? scripts.find((s) => s.file.toLowerCase() === path.basename(t.spec.sqlFile).toLowerCase()) : null;
    const byInsert = scripts.filter((s) => s.parsed.inserts.some((i) => i.target === t.key));
    t.scripts = [...new Set([byName, ...byInsert].filter(Boolean))];
    t.inserts = t.scripts.flatMap((s) => s.parsed.inserts.filter((i) => i.target === t.key).map((i) => ({ ...i, file: s.file })));
    // แหล่งข้อมูล (FROM/WHERE/GROUP BY) ของ Spec; ถ้าไม่ระบุให้ fallback ไปที่ SQL
    const fromSpec = S.stripFrom(t.spec.from);
    t.src = fromSpec
      ? { from: fromSpec, where: t.spec.where || '', groupBy: t.spec.groupBy || '', origin: 'Mapping Spec' }
      : t.inserts[0] ? { from: t.inserts[0].clauses.from, where: t.inserts[0].clauses.where, groupBy: t.inserts[0].clauses.groupBy, origin: 'SQL Script (fallback)' }
      : { from: '', where: '', groupBy: '', origin: '' };
    t.pkCols = t.cols.filter((c) => c.pk);
  }

  // ============================================================ 2) STR: Mapping Spec vs DDL
  for (const w of mapping.warnings) C.add('STR', '', '', 'Mapping Spec readable', 'WARN', '', '', w);

  for (const t of tables) {
    const dt = ddl[t.key];
    C.add('STR', t.name, '', 'Target table is defined in DDL', dt ? 'PASS' : 'FAIL', 'Table exists', dt ? 'Found' : 'Not found',
      dt ? '' : `ไม่พบ CREATE TABLE ${t.name} ในไฟล์ DDL`);

    const pkTest = C.add('STR', t.name, '', 'Mapping Spec flags at least one PK column', t.pkCols.length ? 'PASS' : 'FAIL',
      '>= 1 PK', `${t.pkCols.length} PK`, t.pkCols.length ? '' : 'ไม่มีคอลัมน์ที่ระบุ PK=Y: ไม่สามารถเทียบข้อมูลรายแถวได้');

    // ตารางต้นทางใน FROM มีใน DDL
    if (t.src.from) {
      const ft = S.parseFromTables(t.src.from).tables;
      const missing = [...new Set(ft.map((x) => x.table))].filter((x) => !ddl[x]);
      C.add('STR', t.name, '', 'Source tables in FROM clause are defined in DDL', missing.length ? 'FAIL' : 'PASS',
        'All defined', missing.length ? `Missing: ${missing.join(', ')}` : 'All defined', missing.length ? `ไม่พบ DDL ของ: ${missing.join(', ')}` : '');
    } else {
      C.add('STR', t.name, '', 'Source tables in FROM clause are defined in DDL', 'FAIL', 'FROM clause available', 'None', 'ไม่มี FROM ทั้งใน Mapping Spec และ SQL Script');
    }

    if (dt) {
      const uncovered = dt.columns.filter((c) => !t.cols.some((m) => m.key === c.key)).map((c) => c.name);
      C.add('STR', t.name, '', 'All DDL columns are covered by Mapping Spec', uncovered.length ? 'WARN' : 'PASS',
        'No uncovered columns', uncovered.length ? uncovered.join(', ') : 'None', uncovered.length ? `คอลัมน์ใน DDL ที่ไม่มีใน Mapping: ${uncovered.join(', ')}` : '');
    }

    for (const col of t.cols) {
      const dc = dt && dt.columns.find((c) => c.key === col.key);
      const exists = C.add('STR', t.name, col.column, 'Mapped column exists in target DDL', !dt ? 'SKIPPED' : dc ? 'PASS' : 'FAIL',
        'Column exists', !dt ? '-' : dc ? 'Found' : 'Not found', !dt ? 'Blocked: target table missing in DDL' : dc ? '' : `ไม่พบคอลัมน์ ${col.column} ใน DDL ของ ${t.name}`);

      const blocked = !dc ? 'Blocked: column not in DDL' : '';
      const mt = U.parseType(col.type);
      if (!blocked) {
        if (!mt) C.add('STR', t.name, col.column, 'Data type matches DDL', 'WARN', dc.type?.text, '(blank)', 'Mapping Spec ไม่ระบุ Data Type');
        else {
          const ok = dc.type && mt.text === dc.type.text;
          C.add('STR', t.name, col.column, 'Data type matches DDL', ok ? 'PASS' : 'FAIL', `DDL: ${dc.type?.text}`, `Spec: ${mt.text}`,
            ok ? '' : `Data type ไม่ตรงกัน: Mapping Spec = ${mt.text}, DDL = ${dc.type?.text}`);
        }
        if (col.nullable === undefined) C.add('STR', t.name, col.column, 'Nullability matches DDL', 'WARN', dc.nullable ? 'NULL' : 'NOT NULL', '(blank)', 'Mapping Spec ไม่ระบุ Nullable');
        else {
          const ok = col.nullable === dc.nullable;
          C.add('STR', t.name, col.column, 'Nullability matches DDL', ok ? 'PASS' : 'FAIL', `DDL: ${dc.nullable ? 'NULL' : 'NOT NULL'}`, `Spec: ${col.nullable ? 'NULL' : 'NOT NULL'}`,
            ok ? '' : 'Nullable ใน Mapping Spec ไม่ตรงกับ DDL');
        }
        const okPk = !!col.pk === !!dc.pk;
        C.add('STR', t.name, col.column, 'PK flag matches DDL', okPk ? 'PASS' : 'FAIL', `DDL: ${dc.pk ? 'PK' : '-'}`, `Spec: ${col.pk ? 'PK' : '-'}`, okPk ? '' : 'PK ใน Mapping Spec ไม่ตรงกับ DDL');
      } else {
        for (const d of ['Data type matches DDL', 'Nullability matches DDL', 'PK flag matches DDL']) C.add('STR', t.name, col.column, d, 'SKIPPED', '', '-', blocked);
      }

      // rule + reference
      if (!col.rule) {
        C.add('STR', t.name, col.column, 'Transformation rule is defined', 'FAIL', 'Rule present', '(blank)', 'ไม่มี Transformation Rule');
        C.add('STR', t.name, col.column, 'Columns referenced by rule exist in source DDL', 'SKIPPED', '', '-', 'Blocked: no rule');
      } else {
        C.add('STR', t.name, col.column, 'Transformation rule is defined', 'PASS', 'Rule present', 'Present');
        if (!t.src.from) C.add('STR', t.name, col.column, 'Columns referenced by rule exist in source DDL', 'SKIPPED', '', '-', 'Blocked: no FROM clause');
        else {
          const r = S.resolveRefs(col.rule, t.src.from, ddl);
          C.add('STR', t.name, col.column, 'Columns referenced by rule exist in source DDL', r.status, 'All references resolve', r.status === 'PASS' ? 'All resolve' : r.problems.join('; ') || r.msg, r.msg);
        }
      }
    }
  }

  // ============================================================ 3) SQL: Mapping Spec vs SQL Script
  const usedScripts = new Set(tables.flatMap((t) => t.scripts.map((s) => s.file)));
  for (const s of scripts) {
    if (!usedScripts.has(s.file)) C.add('SQL', '', '', `SQL script "${s.file}" is referenced by Mapping Spec`, 'WARN', 'Linked to a target table', 'Not linked', 'ไม่พบ INSERT..SELECT ที่ตรงกับตาราง target ใดใน Mapping Spec');
  }
  for (const t of tables) {
    if (t.spec.sqlFile && !scripts.some((s) => s.file.toLowerCase() === path.basename(t.spec.sqlFile).toLowerCase())) {
      C.add('SQL', t.name, '', `SQL file "${t.spec.sqlFile}" named in Mapping Spec exists`, 'FAIL', 'File exists', 'Not found', `ไม่พบไฟล์ ${t.spec.sqlFile} ในโฟลเดอร์ SQL`);
    }
    if (!t.inserts.length) {
      C.add('SQL', t.name, '', 'Load script (INSERT..SELECT) found for target table', 'FAIL', 'INSERT INTO ' + t.name + ' ... SELECT', 'Not found', 'ไม่พบ SQL ที่ INSERT เข้าตารางนี้');
      continue;
    }
    const ins = t.inserts[0];
    const dt = ddl[t.key];
    C.add('SQL', t.name, '', 'Load script (INSERT..SELECT) found for target table', 'PASS', 'Found', ins.file + (t.inserts.length > 1 ? ` (+${t.inserts.length - 1} more)` : ''));

    const cols = ins.columns || (dt ? dt.columns.map((c) => c.key) : []);
    if (ins.hasStar) C.add('SQL', t.name, '', 'SELECT list has no wildcard (*)', 'WARN', 'Explicit columns', 'SELECT *', 'ใช้ SELECT * ทำให้ตรวจ mapping รายคอลัมน์ไม่ได้');
    const cnt = cols.length === ins.expressions.length || ins.hasStar;
    C.add('SQL', t.name, '', 'INSERT column count equals SELECT expression count', cnt ? 'PASS' : 'FAIL', `${cols.length} columns`, `${ins.expressions.length} expressions`, cnt ? '' : 'จำนวนคอลัมน์ใน INSERT ไม่เท่ากับจำนวน expression ใน SELECT');

    if (dt) {
      const bad = cols.filter((c) => !dt.columns.some((d) => d.key === c));
      C.add('SQL', t.name, '', 'INSERT columns exist in target DDL', bad.length ? 'FAIL' : 'PASS', 'All exist', bad.length ? bad.join(', ') : 'All exist', bad.length ? `คอลัมน์ที่ไม่มีใน DDL: ${bad.join(', ')}` : '');
    }
    const extra = cols.filter((c) => !t.cols.some((m) => m.key === c));
    C.add('SQL', t.name, '', 'INSERT loads no column outside Mapping Spec', extra.length ? 'FAIL' : 'PASS', 'No extra columns', extra.length ? extra.join(', ') : 'None', extra.length ? `SQL โหลดคอลัมน์ที่ไม่มีใน Mapping: ${extra.join(', ')}` : '');

    // clauses
    if (t.spec.from) {
      const nf = (a, b) => U.normExpr(a) === U.normExpr(b);
      const diffs = [];
      if (!nf(S.stripFrom(t.spec.from), ins.clauses.from)) diffs.push(`FROM\n  Spec: ${t.spec.from}\n  SQL : ${ins.clauses.from}`);
      if (!nf(t.spec.where, ins.clauses.where)) diffs.push(`WHERE\n  Spec: ${t.spec.where || '(none)'}\n  SQL : ${ins.clauses.where || '(none)'}`);
      if (!nf(t.spec.groupBy, ins.clauses.groupBy)) diffs.push(`GROUP BY\n  Spec: ${t.spec.groupBy || '(none)'}\n  SQL : ${ins.clauses.groupBy || '(none)'}`);
      C.add('SQL', t.name, '', 'FROM / JOIN / WHERE / GROUP BY consistent with Mapping Spec', diffs.length ? 'WARN' : 'PASS', 'Same text (normalized)', diffs.length ? 'Differs' : 'Same', diffs.join('\n'));
    }

    for (const col of t.cols) {
      const idx = cols.indexOf(col.key);
      if (idx < 0) {
        C.add('SQL', t.name, col.column, 'Mapped column is populated by load script', 'FAIL', 'Listed in INSERT', 'Missing from INSERT', `SQL (${ins.file}) ไม่ได้ INSERT คอลัมน์ ${col.column}`);
        C.add('SQL', t.name, col.column, 'SQL expression matches Mapping rule', 'SKIPPED', '', '-', 'Blocked: column not in INSERT');
        continue;
      }
      C.add('SQL', t.name, col.column, 'Mapped column is populated by load script', 'PASS', 'Listed in INSERT', 'Listed');
      const expr = ins.expressions[idx];
      if (expr === undefined) { C.add('SQL', t.name, col.column, 'SQL expression matches Mapping rule', 'SKIPPED', '', '-', 'ไม่มี expression ตามตำแหน่ง'); continue; }
      if (!col.rule) { C.add('SQL', t.name, col.column, 'SQL expression matches Mapping rule', 'SKIPPED', '', '-', 'Blocked: no rule in spec'); continue; }
      const same = U.normExpr(expr) === U.normExpr(col.rule);
      C.add('SQL', t.name, col.column, 'SQL expression matches Mapping rule', same ? 'PASS' : 'WARN', col.rule, expr,
        same ? '' : 'ข้อความ expression ต่างกัน (อาจเป็นแค่รูปแบบการเขียน) ให้ดูผล Data Validation ประกอบ');
    }
  }

  // ============================================================ 4) SRC: Source data profiling
  const rowVal = (row, col) => {
    for (const k of Object.keys(row)) if (U.key(k) === col) return row[k];
    return undefined;
  };
  for (const sk of sourceKeys) {
    const st = ddl[sk];
    const d = data[sk];
    const used = tables.some((t) => t.src.from && S.parseFromTables(t.src.from).tables.some((x) => x.table === sk));
    if (!used) continue;
    const hasRows = d && d.rows.length > 0;
    C.add('SRC', st.name, '', 'Sample data provided', hasRows ? 'PASS' : 'FAIL', '> 0 rows', d ? `${d.rows.length} rows (${d.file})` : 'No file', hasRows ? '' : `ไม่พบ Sample Data ของ ${st.name}`);
    if (!hasRows) continue;
    const rows = d.rows;
    const dataCols = Object.keys(rows[0]).map(U.key);
    const missing = st.columns.filter((c) => !dataCols.includes(c.key)).map((c) => c.name);
    const extra = dataCols.filter((c) => !st.columns.some((x) => x.key === c));
    C.add('SRC', st.name, '', 'Sample data columns match DDL', missing.length ? 'FAIL' : extra.length ? 'WARN' : 'PASS', 'Same columns',
      missing.length ? `Missing: ${missing.join(', ')}` : extra.length ? `Extra: ${extra.join(', ')}` : 'Same', '');

    const pkOf = (r) => st.pk.map((k) => rowVal(r, k));
    const pkDesc = st.pk.join(', ');
    if (st.pk.length) {
      const seen = new Map();
      rows.forEach((r, i) => { const k = keyStr(pkOf(r)); (seen.get(k) || seen.set(k, []).get(k)).push(i + 2); });
      const dups = [...seen].filter(([, v]) => v.length > 1);
      const t = C.add('SRC', st.name, pkDesc, 'Primary key is unique', dups.length ? 'FAIL' : 'PASS', 'No duplicates', dups.length ? `${dups.length} duplicate key(s)` : 'No duplicates',
        dups.length ? `Key ซ้ำ: ${dups.slice(0, 5).map(([k, v]) => `${k} (แถว ${v.join(',')})`).join('; ')}` : '');
      for (const [k, v] of dups) C.addDetail(t, { key: k, actual: `${v.length} rows`, expected: '1 row', issue: `Duplicate PK ในไฟล์ ${d.file} แถว ${v.join(', ')}` });
    }
    // NOT NULL
    {
      const viol = [];
      for (const c of st.columns.filter((x) => !x.nullable)) rows.forEach((r, i) => { const v = rowVal(r, c.key); if (v == null || v === '') viol.push({ c, i, r }); });
      const t = C.add('SRC', st.name, '', 'NOT NULL columns have no NULL / blank', viol.length ? 'FAIL' : 'PASS', '0 violations', `${viol.length} violation(s)`,
        viol.length ? `พบ NULL ในคอลัมน์ NOT NULL: ${[...new Set(viol.map((v) => v.c.name))].join(', ')}` : '');
      viol.forEach((v) => C.addDetail(t, { key: keyStr(pkOf(v.r)), expected: 'NOT NULL', actual: 'NULL', issue: `${v.c.name} แถว ${v.i + 2}` }));
    }
    // type conformity
    {
      const viol = [];
      for (const c of st.columns) rows.forEach((r, i) => { const v = rowVal(r, c.key); const m = checkVal(v, c.type); if (m) viol.push({ c, i, r, v, m }); });
      const t = C.add('SRC', st.name, '', 'Values conform to DDL data types', viol.length ? 'FAIL' : 'PASS', '0 violations', `${viol.length} violation(s)`,
        viol.length ? `ค่าไม่ตรงชนิดข้อมูล: ${[...new Set(viol.map((v) => v.c.name))].join(', ')}` : '');
      viol.forEach((v) => C.addDetail(t, { key: keyStr(pkOf(v.r)), expected: v.c.type?.text, actual: fmt(v.v), issue: `${v.c.name}: ${v.m} (แถว ${v.i + 2})` }));
    }
    // FK
    for (const fk of st.fks) {
      const pd = data[fk.refTable];
      if (!pd) { C.add('SRC', st.name, fk.cols.join(','), `FK -> ${fk.refTable}(${fk.refCols.join(',')}) has no orphan rows`, 'SKIPPED', '', '-', `Blocked: ไม่มี Sample Data ของ ${fk.refTable}`); continue; }
      const parent = new Set(pd.rows.map((r) => keyStr(fk.refCols.map((c) => rowVal(r, c)))));
      const orphans = rows.map((r, i) => ({ r, i, k: fk.cols.map((c) => rowVal(r, c)) })).filter((x) => !x.k.some((v) => v == null || v === '') && !parent.has(keyStr(x.k)));
      const t = C.add('SRC', st.name, fk.cols.join(','), `FK -> ${fk.refTable}(${fk.refCols.join(',')}) has no orphan rows`, orphans.length ? 'FAIL' : 'PASS', '0 orphans', `${orphans.length} orphan(s)`,
        orphans.length ? `ไม่พบ parent ใน ${fk.refTable}: ${orphans.slice(0, 5).map((o) => keyStr(o.k)).join(', ')}` : '');
      orphans.forEach((o) => C.addDetail(t, { key: keyStr(pkOf(o.r)), expected: `exists in ${fk.refTable}`, actual: keyStr(o.k), issue: `Orphan FK แถว ${o.i + 2}` }));
    }
  }
  function checkVal(v, type) { return S.checkValue(v, type); }

  // ============================================================ 5) Build in-memory DB
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');

  // source tables: สร้างแบบไม่มี constraint (เพื่อให้โหลดข้อมูลที่ผิดได้ แล้วตรวจแยกด้านบน)
  for (const sk of sourceKeys) {
    const st = ddl[sk];
    try {
      db.exec(`CREATE TABLE ${U.q(st.name)} (${st.columns.map((c) => `${U.q(c.name)} ${c.typeText}`).join(', ')})`);
      const d = data[sk];
      if (!d) continue;
      const ins = db.prepare(`INSERT INTO ${U.q(st.name)} VALUES (${st.columns.map(() => '?').join(',')})`);
      for (const r of d.rows) {
        ins.run(...st.columns.map((c) => {
          const v = rowVal(r, c.key);
          if (v == null || v === '') return null;
          const f = U.family(c.type);
          return (f === 'int' || f === 'num') && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(String(v).trim()) ? Number(v) : String(v);
        }));
      }
    } catch (e) {
      C.add('EXE', st.name, '', 'Source table created and sample data loaded', 'FAIL', 'Loaded', 'Error', e.message);
      C.addException('Load source data', st.name, '', e.message);
    }
  }
  // target tables
  for (const t of tables) {
    const dt = ddl[t.key];
    if (!dt) { t.ddlOk = false; continue; }
    try { db.exec(dt.raw); t.ddlOk = true; C.add('EXE', t.name, '', 'Target DDL executes', 'PASS', 'CREATE TABLE ok', 'Created'); }
    catch (e) {
      t.ddlOk = false;
      const x = C.add('EXE', t.name, '', 'Target DDL executes', 'FAIL', 'CREATE TABLE ok', 'Error', e.message);
      C.addException('Create target table', t.name, x.id, e.message, dt.raw);
    }
  }

  // ============================================================ 6) EXC: Oracle = รัน Transformation Rule ของ Spec กับ Sample Data
  const tolFor = (type) => (type && type.base === 'DECIMAL' && type.s != null ? 0.5 * Math.pow(10, -type.s) - 1e-9 : 1e-9);
  const sourceSql = (t, exprs) => {
    const sel = exprs.map((e, i) => `(${e}) AS "__c${i}"`).join(', ');
    return `SELECT ${sel} FROM ${t.src.from}${t.src.where ? ' WHERE ' + t.src.where : ''}${t.src.groupBy ? ' GROUP BY ' + t.src.groupBy : ''}`;
  };

  for (const t of tables) {
    t.oracle = {};
    const dt = ddl[t.key];
    const pkRules = t.pkCols.map((c) => c.rule).filter(Boolean);
    t.pkOk = t.pkCols.length > 0 && pkRules.length === t.pkCols.length;
    for (const col of t.cols) {
      if (!col.rule || !t.src.from) continue;
      const exprs = [...pkRules, col.rule];
      const sql = sourceSql(t, exprs);
      let rows = null, err = null;
      try { rows = db.prepare(sql).all(); } catch (e) { err = e.message; }
      t.oracle[col.key] = { rows, err, sql, nPk: pkRules.length };

      const ex = C.add('EXC', t.name, col.column, 'Transformation rule executes against sample data', err ? 'FAIL' : 'PASS', 'Executes without error', err ? 'Error' : `${rows.length} rows`, err || '');
      if (err) { C.addException('Execute mapping rule', `${t.name}.${col.column}`, ex.id, err, col.rule); continue; }

      // constraint pre-check
      const dc = dt && dt.columns.find((c) => c.key === col.key);
      const type = (dc && dc.type) || U.parseType(col.type);
      const notNull = dc ? !dc.nullable : col.nullable === false;
      const vi = [];
      rows.forEach((r) => {
        const v = r[`__c${pkRules.length}`];
        const k = keyStr(pkRules.map((_, i) => r[`__c${i}`]));
        if (v == null) { if (notNull) vi.push({ k, v, m: 'NULL ในคอลัมน์ NOT NULL' }); return; }
        const m = S.checkValue(v, type);
        if (m) vi.push({ k, v, m });
        else if (type && type.base === 'DECIMAL' && type.s != null && typeof v === 'number') {
          // ทศนิยมเกิน scale ของปลายทาง = จะถูกปัดเศษ
        }
      });
      const ct = C.add('EXC', t.name, col.column, 'Rule output fits target column (NOT NULL / type / length / precision)', vi.length ? 'FAIL' : 'PASS', '0 violations', `${vi.length} violation(s)`,
        vi.length ? `${vi.length}/${rows.length} แถวจะละเมิดข้อจำกัดของ ${t.name}.${col.column}: ${vi[0].m}` : '');
      vi.forEach((x) => C.addDetail(ct, { key: x.k, expected: `${type?.text || ''}${notNull ? ' NOT NULL' : ''}`, actual: fmt(x.v), issue: x.m }));

      // divide-by-zero risk
      const stripped = col.rule.replace(/'(?:[^']|'')*'/g, "''");
      const dens = [...stripped.matchAll(/\/\s*([A-Za-z_][\w]*\.[A-Za-z_]\w*|[A-Za-z_]\w*)\b(?!\s*\()/g)].map((m) => m[1]);
      for (const den of new Set(dens)) {
        let n = null, e2 = null;
        try { n = db.prepare(`SELECT COUNT(*) AS n FROM ${t.src.from} WHERE ${t.src.where ? '(' + t.src.where + ') AND ' : ''}(${den}) = 0`).get().n; } catch (e) { e2 = e.message; }
        const dz = C.add('EXC', t.name, col.column, `Divide-by-zero risk: denominator ${den}`, e2 ? 'WARN' : n > 0 ? 'FAIL' : 'PASS', '0 rows with denominator = 0', e2 ? 'Check failed' : `${n} row(s)`, e2 || (n > 0 ? `พบ ${den} = 0 จำนวน ${n} แถว: จะเกิด Division by zero บน DB จริง (ควรใช้ NULLIF)` : ''));
        if (n > 0) C.addException('Potential runtime exception', `${t.name}.${col.column}`, dz.id, `Division by zero (${den} = 0 in ${n} rows)`, col.rule);
      }
    }
  }

  // ============================================================ 7) EXE: Execute load scripts
  const ordered = [];
  for (const t of tables) for (const s of t.scripts) if (!ordered.includes(s)) ordered.push(s);
  for (const s of scripts) if (!ordered.includes(s)) ordered.push(s);
  const scriptResult = new Map();

  for (const s of ordered) {
    const targets = [...new Set(s.parsed.inserts.map((i) => i.targetDisplay))];
    let failedAt = null, msg = null;
    db.exec('SAVEPOINT s_load');
    for (let i = 0; i < s.parsed.statements.length; i++) {
      try { db.exec(s.parsed.statements[i]); } catch (e) { failedAt = i; msg = e.message; break; }
    }
    if (failedAt != null) db.exec('ROLLBACK TO s_load');
    db.exec('RELEASE s_load');
    scriptResult.set(s.file, { ok: failedAt == null, msg });
    const objName = targets.join(', ');
    const x = C.add('EXE', objName, '', `Load script "${s.file}" executes without error`, failedAt == null ? 'PASS' : 'FAIL', 'Executes without error',
      failedAt == null ? 'Success' : `Error at statement #${failedAt + 1}`, msg || '');
    if (failedAt != null) C.addException('Execute load script', s.file, x.id, msg, s.parsed.statements[failedAt]);
  }
  for (const t of tables) {
    if (!t.scripts.length) { t.load = { ok: false, reason: 'ไม่พบ SQL script ของตารางนี้' }; continue; }
    if (!t.ddlOk) { t.load = { ok: false, reason: 'ตาราง target ถูกสร้างไม่ได้ (ดู DDL)' }; continue; }
    const failed = t.scripts.map((s) => ({ s, r: scriptResult.get(s.file) })).find((x) => x.r && !x.r.ok);
    t.load = failed ? { ok: false, reason: `Load script ${failed.s.file} ล้มเหลว: ${failed.r.msg}` } : { ok: true, reason: '' };
  }

  // FK integrity ของ target
  for (const t of tables.filter((x) => x.load.ok)) {
    const dt = ddl[t.key];
    dt.fks.forEach((fk, idx) => {
      let bad = [];
      try { bad = db.prepare(`PRAGMA foreign_key_check(${U.q(dt.name)})`).all().filter((r) => r.fkid === dt.fks.length - 1 - idx || true); } catch (e) { /* ignore */ }
      // PRAGMA จะคืนทุก FK: กรองโดยเทียบ parent
      bad = bad.filter((r) => String(r.parent).toLowerCase() === fk.refTable);
      const x = C.add('EXE', t.name, fk.cols.join(','), `FK -> ${fk.refTable}(${fk.refCols.join(',')}) integrity after load`, bad.length ? 'FAIL' : 'PASS', '0 orphans', `${bad.length} orphan(s)`,
        bad.length ? `พบ ${bad.length} แถวที่ไม่มี parent ใน ${fk.refTable}` : '');
      for (const b of bad) {
        const row = db.prepare(`SELECT * FROM ${U.q(dt.name)} WHERE rowid = ?`).get(b.rowid) || {};
        C.addDetail(x, { key: keyStr(dt.pk.map((k) => row[Object.keys(row).find((c) => U.key(c) === k)])), expected: `exists in ${fk.refTable}`, actual: keyStr(fk.cols.map((c) => row[Object.keys(row).find((z) => U.key(z) === c)])), issue: 'Orphan FK หลังโหลด' });
      }
    });
  }

  // ============================================================ 8) DAT: Expected (rule on source) vs Actual (target)
  for (const t of tables) {
    const dt = ddl[t.key];
    if (!t.load.ok) { C.add('DAT', t.name, '', 'Data validation (row count, keys, column values)', 'SKIPPED', '', '-', `Blocked: ${t.load.reason}`); continue; }
    const pkOracle = t.oracle[t.pkCols[0]?.key];
    const actualCount = db.prepare(`SELECT COUNT(*) AS n FROM ${U.q(dt.name)}`).get().n;

    if (!t.pkOk || !pkOracle || pkOracle.err) {
      C.add('DAT', t.name, '', 'Row count matches expected result', 'SKIPPED', '', '-', 'Blocked: PK ไม่ถูกระบุ หรือ PK rule รันไม่ได้');
      continue;
    }
    const expRows = pkOracle.rows;
    C.add('DAT', t.name, '', 'Row count matches expected result', expRows.length === actualCount ? 'PASS' : 'FAIL', `${expRows.length} rows`, `${actualCount} rows`,
      expRows.length === actualCount ? '' : `Expected ${expRows.length} แถว (จาก Spec บน Sample Data) แต่ target มี ${actualCount} แถว`);

    // key uniqueness of expected
    const ekeys = new Map();
    expRows.forEach((r) => { const k = keyStr(t.pkCols.map((_, i) => r[`__c${i}`])); ekeys.set(k, (ekeys.get(k) || 0) + 1); });
    const dupE = [...ekeys].filter(([, n]) => n > 1);
    const tu = C.add('DAT', t.name, t.pkCols.map((c) => c.column).join(','), 'Expected PK is unique under Mapping Spec', dupE.length ? 'FAIL' : 'PASS', 'Unique', dupE.length ? `${dupE.length} duplicate key(s)` : 'Unique',
      dupE.length ? 'Mapping/JOIN ทำให้ได้ PK ซ้ำ (fan-out)' : '');
    dupE.forEach(([k, n]) => C.addDetail(tu, { key: k, expected: '1 row', actual: `${n} rows`, issue: 'PK ซ้ำในผลลัพธ์ที่คาดหวัง' }));

    // actual rows by key
    const pkNames = t.pkCols.map((c) => c.column);
    const actualAll = db.prepare(`SELECT * FROM ${U.q(dt.name)}`).all();
    const getA = (row, name) => row[Object.keys(row).find((c) => U.key(c) === U.key(name))];
    const actualByKey = new Map(actualAll.map((r) => [keyStr(pkNames.map((n) => getA(r, n))), r]));
    const missing = [...ekeys.keys()].filter((k) => !actualByKey.has(k));
    const extra = [...actualByKey.keys()].filter((k) => !ekeys.has(k));
    const tk = C.add('DAT', t.name, pkNames.join(','), 'All expected keys exist in target and no unexpected keys', missing.length || extra.length ? 'FAIL' : 'PASS', '0 missing / 0 extra', `${missing.length} missing / ${extra.length} extra`,
      missing.length || extra.length ? `ขาด: ${missing.slice(0, 5).join(', ') || '-'} | เกิน: ${extra.slice(0, 5).join(', ') || '-'}` : '');
    missing.forEach((k) => C.addDetail(tk, { key: k, expected: 'present', actual: 'absent', issue: 'Key หายจาก target' }));
    extra.forEach((k) => C.addDetail(tk, { key: k, expected: 'absent', actual: 'present', issue: 'Key เกินใน target' }));

    for (const col of t.cols) {
      const dc = dt.columns.find((c) => c.key === col.key);
      const orc = t.oracle[col.key];
      if (!dc || !orc || orc.err) {
        C.add('DAT', t.name, col.column, 'Target values equal expected values (Mapping rule on sample data)', 'SKIPPED', '', '-',
          !dc ? 'Blocked: column not in target DDL' : !orc ? 'Blocked: no rule/FROM' : `Blocked: rule execution failed (${orc.err})`);
        continue;
      }
      const tol = tolFor(dc.type);
      let compared = 0;
      const bad = [];
      for (const r of orc.rows) {
        const k = keyStr(t.pkCols.map((_, i) => r[`__c${i}`]));
        const a = actualByKey.get(k);
        if (!a) continue;
        compared++;
        const ev = r[`__c${orc.nPk}`], av = getA(a, col.column);
        if (!sameValue(ev, av, tol)) bad.push({ k, ev, av });
      }
      const x = C.add('DAT', t.name, col.column, 'Target values equal expected values (Mapping rule on sample data)', bad.length ? 'FAIL' : 'PASS',
        `${compared}/${compared} rows equal`, `${compared - bad.length}/${compared} rows equal`,
        bad.length ? `${bad.length} จาก ${compared} แถวไม่ตรง เช่น key=${bad[0].k}: expected ${fmt(bad[0].ev)} แต่ได้ ${fmt(bad[0].av)}` : '');
      bad.forEach((b) => C.addDetail(x, { key: b.k, expected: fmt(b.ev), actual: fmt(b.av), issue: 'ค่าไม่ตรงกับ Mapping rule' }));
    }
  }

  db.close();
  meta.finishedAt = new Date();
  meta.tables = tables.map((t) => ({ name: t.name, loaded: t.load.ok, reason: t.load.reason }));
  return { meta, tests: C.tests, details: C.details, exceptions: C.exceptions, summary: C.summary() };
}

module.exports = { run };
