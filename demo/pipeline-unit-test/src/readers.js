'use strict';
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { splitTopLevel, stripComments, splitStatements, splitClauses, mask, stripQuotes, key, parseType } = require('./util');

// =============================================================== Mapping Spec
const TABLE_H = {
  target: ['target table', 'table', 'target', 'target_table'],
  order: ['load order', 'order', 'seq', 'sequence'],
  sqlFile: ['sql file', 'script', 'sql script', 'sql', 'script file'],
  from: ['source from', 'from', 'source', 'source tables', 'from clause'],
  where: ['filter (where)', 'filter', 'where', 'where clause'],
  groupBy: ['group by', 'groupby'],
};
const COLUMN_H = {
  target: ['target table', 'table'],
  column: ['target column', 'column', 'column name', 'target_column'],
  type: ['data type', 'type', 'target type', 'datatype'],
  nullable: ['nullable', 'null', 'is nullable', 'null?'],
  pk: ['pk', 'primary key', 'key'],
  rule: ['transformation rule', 'transformation', 'rule', 'logic', 'source expression', 'expression', 'mapping logic'],
  description: ['description', 'remark', 'remarks', 'notes', 'comment'],
};

const norm = (s) => String(s ?? '').trim().toLowerCase();
function headerMap(row, defs) {
  const map = {};
  row.forEach((v, idx) => {
    const n = norm(v);
    for (const [k, aliases] of Object.entries(defs)) if (!(k in map) && aliases.includes(n)) map[k] = idx;
  });
  return map;
}
const yes = (v) => /^(y|yes|true|1|pk|x)$/i.test(String(v ?? '').trim());
const no = (v) => /^(n|no|false|0)$/i.test(String(v ?? '').trim());

async function readMapping(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = { tables: [], columns: [], warnings: [] };

  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(String(row.getCell(c).text ?? '').trim());
      rows.push({ rn, vals });
    });
    let role = null, hdr = null, hmap = null;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cm = headerMap(rows[i].vals, COLUMN_H);
      if ('column' in cm && 'rule' in cm) { role = 'columns'; hdr = i; hmap = cm; break; }
      const tm = headerMap(rows[i].vals, TABLE_H);
      if ('target' in tm && ('from' in tm || 'sqlFile' in tm)) { role = 'tables'; hdr = i; hmap = tm; break; }
    }
    if (!role) { out.warnings.push(`Sheet "${ws.name}" ถูกข้าม (ไม่พบหัวคอลัมน์ที่รู้จัก)`); continue; }
    const g = (r, k) => (k in hmap ? r.vals[hmap[k]] : '');
    for (const r of rows.slice(hdr + 1)) {
      if (r.vals.every((v) => v === '')) continue;
      if (role === 'tables') {
        out.tables.push({
          target: g(r, 'target'), order: Number(g(r, 'order')) || 999, sqlFile: g(r, 'sqlFile'),
          from: g(r, 'from'), where: g(r, 'where'), groupBy: g(r, 'groupBy'), row: r.rn,
        });
      } else {
        const nl = g(r, 'nullable'), pk = g(r, 'pk');
        out.columns.push({
          target: g(r, 'target'), column: g(r, 'column'), type: g(r, 'type'),
          nullable: yes(nl) ? true : no(nl) ? false : undefined,
          pk: yes(pk), rule: g(r, 'rule'), description: g(r, 'description'), row: r.rn, sheet: ws.name,
        });
      }
    }
  }
  // ถ้าไม่มี sheet Tables ให้สร้างจากชื่อตารางใน Columns
  if (!out.tables.length) {
    for (const t of [...new Set(out.columns.map((c) => c.target))]) {
      out.tables.push({ target: t, order: 999, sqlFile: '', from: '', where: '', groupBy: '', row: 0 });
    }
    out.warnings.push('ไม่พบ sheet Tables: ใช้ FROM/WHERE/GROUP BY จาก SQL Script แทน');
  }
  out.tables.sort((a, b) => a.order - b.order);
  return out;
}

// =============================================================== DDL
const CONSTRAINT_KW = /\b(NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|REFERENCES|CHECK|UNIQUE|COLLATE|AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|GENERATED)\b/i;

function parseDDL(text) {
  const src = stripComments(text);
  const tables = {};
  const re = /create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]]+)\s*\(/gi;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index, bodyStart = re.lastIndex;
    let depth = 1, i = bodyStart, qt = null;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (qt) { if (ch === qt) qt = null; continue; }
      if (ch === "'" || ch === '"') { qt = ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
    }
    const body = src.slice(bodyStart, i - 1);
    const display = stripQuotes(m[1]).split('.').pop();
    const t = { name: display, key: key(m[1]), columns: [], pk: [], fks: [], raw: src.slice(start, i) + ';' };
    for (const item of splitTopLevel(body)) {
      let mm;
      if ((mm = /^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i.exec(item))) {
        t.pk.push(...mm[1].split(',').map(key));
      } else if ((mm = /^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+([\w."`\[\]]+)\s*\(([^)]*)\)/i.exec(item))) {
        t.fks.push({ cols: mm[1].split(',').map(key), refTable: key(mm[2]), refCols: mm[3].split(',').map(key) });
      } else if (/^(constraint|unique|check|index|key)\b/i.test(item)) {
        // ไม่ใช้งานในการตรวจ
      } else {
        const cm = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s+([\s\S]*)$/.exec(item);
        if (!cm) continue;
        const rest = cm[2];
        const kw = CONSTRAINT_KW.exec(rest);
        const typeText = (kw ? rest.slice(0, kw.index) : rest).trim();
        const col = {
          name: stripQuotes(cm[1]), key: key(cm[1]), typeText, type: parseType(typeText),
          nullable: !/\bnot\s+null\b/i.test(rest), pk: /\bprimary\s+key\b/i.test(rest),
        };
        const rf = /\breferences\s+([\w."`\[\]]+)\s*\(([^)]*)\)/i.exec(rest);
        if (rf) t.fks.push({ cols: [col.key], refTable: key(rf[1]), refCols: rf[2].split(',').map(key) });
        t.columns.push(col);
      }
    }
    for (const c of t.columns) if (c.pk && !t.pk.includes(c.key)) t.pk.push(c.key);
    for (const c of t.columns) if (t.pk.includes(c.key)) { c.pk = true; c.nullable = false; }
    tables[t.key] = t;
  }
  return tables;
}

// =============================================================== SQL load scripts
function parseLoadScript(text) {
  const statements = splitStatements(text);
  const inserts = [];
  for (const st of statements) {
    const m = /^\s*insert\s+(?:or\s+\w+\s+)?into\s+([\w."`\[\]]+)\s*(\(([^)]*)\))?\s*(select\b[\s\S]*)$/i.exec(st);
    if (!m) continue;
    const sel = m[4];
    const mk = mask(sel);
    const fm = /\bfrom\b/i.exec(mk);
    const listText = fm ? sel.slice(6, fm.index) : sel.slice(6);
    const rest = fm ? sel.slice(fm.index) : '';
    const items = splitTopLevel(listText.replace(/^\s*(distinct|all)\b/i, ''));
    inserts.push({
      target: key(m[1]), targetDisplay: stripQuotes(m[1]).split('.').pop(),
      columns: m[3] != null ? m[3].split(',').map(key) : null,
      expressions: items.map((e) => e.replace(/\s+as\s+["`\w]+\s*$/i, '').trim()),
      hasStar: items.some((e) => /(^|\.)\*$/.test(e.trim())),
      clauses: splitClauses(rest), statement: st,
    });
  }
  return { statements, inserts };
}

// =============================================================== Sample data
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

async function readSampleData(dir) {
  const data = {};
  if (!dir || !fs.existsSync(dir)) return data;
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f), ext = path.extname(f).toLowerCase(), base = path.basename(f, ext);
    if (ext === '.csv') data[key(base)] = { file: f, rows: parseCSV(fs.readFileSync(full, 'utf8')) };
    else if (ext === '.json') {
      const j = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (Array.isArray(j)) data[key(base)] = { file: f, rows: j };
      else for (const [t, rows] of Object.entries(j)) data[key(t)] = { file: f, rows };
    } else if (ext === '.xlsx') {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(full);
      for (const ws of wb.worksheets) {
        const rows = [];
        let head = null;
        ws.eachRow((row) => {
          const vals = [];
          for (let c = 1; c <= ws.columnCount; c++) vals.push(String(row.getCell(c).text ?? ''));
          if (!head) head = vals.map((h) => h.trim());
          else rows.push(Object.fromEntries(head.map((h, i) => [h, vals[i]])));
        });
        data[key(ws.name)] = { file: `${f}#${ws.name}`, rows };
      }
    }
  }
  return data;
}

const readText = (dir, exts) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => exts.includes(path.extname(f).toLowerCase())).sort()
        .map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }))
    : [];

module.exports = { readMapping, parseDDL, parseLoadScript, readSampleData, readText, parseCSV };
