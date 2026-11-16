'use strict';

/** แทนที่ข้อความใน quote / วงเล็บ ด้วยช่องว่าง (ความยาวเท่าเดิม) เพื่อค้นหา keyword ระดับบนสุด */
function mask(s) {
  let depth = 0, q = null, out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      out += ' ';
      if (ch === q) { if (s[i + 1] === q) { out += ' '; i++; } else q = null; }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; out += ' '; continue; }
    if (ch === '(') { depth++; out += ' '; continue; }
    if (ch === ')') { depth--; out += ' '; continue; }
    out += depth > 0 ? ' ' : ch;
  }
  return out;
}

/** split ด้วย separator เฉพาะระดับบนสุด (ไม่ตัดใน quote/วงเล็บ) */
function splitTopLevel(s, sep = ',') {
  const out = [];
  let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q) { if (s[i + 1] === q) cur += s[++i]; else q = null; }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

function stripComments(sql) {
  let out = '', q = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], nx = sql[i + 1];
    if (q) { out += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; out += ch; continue; }
    if (ch === '-' && nx === '-') { while (i < sql.length && sql[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && nx === '*') { i += 2; while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++; i++; out += ' '; continue; }
    out += ch;
  }
  return out;
}

const splitStatements = (sql) => splitTopLevel(stripComments(sql), ';');

/** แยก FROM ... WHERE ... GROUP BY ... ออกเป็นส่วน ๆ (รับข้อความที่ขึ้นต้นด้วย FROM) */
function splitClauses(text) {
  const m = mask(text);
  const marks = [];
  const add = (name, re) => { const r = re.exec(m); if (r) marks.push({ name, idx: r.index, len: r[0].length }); };
  add('from', /^\s*from\b/i);
  add('where', /\bwhere\b/i);
  add('groupBy', /\bgroup\s+by\b/i);
  add('having', /\bhaving\b/i);
  add('orderBy', /\border\s+by\b/i);
  add('limit', /\blimit\b/i);
  marks.sort((a, b) => a.idx - b.idx);
  const out = { from: '', where: '', groupBy: '', having: '', orderBy: '', limit: '' };
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    out[mk.name] = text.slice(mk.idx + mk.len, end).trim();
  });
  return out;
}

/** ทำ expression ให้เทียบกันได้: ตัดช่องว่าง, ตัวพิมพ์เล็ก, ตัด alias/วงเล็บนอก */
function normExpr(e) {
  let s = String(e || '').trim().replace(/\s+as\s+["`\w]+$/i, '');
  s = s.replace(/\s+/g, '').replace(/["`]/g, '').toLowerCase();
  while (/^\((.*)\)$/.test(s) && balanced(s.slice(1, -1))) s = s.slice(1, -1);
  return s;
}
function balanced(s) { let d = 0; for (const ch of s) { if (ch === '(') d++; if (ch === ')') { d--; if (d < 0) return false; } } return d === 0; }

const stripQuotes = (n) => String(n).trim().replace(/^["`\[]|["`\]]$/g, '');
const key = (n) => stripQuotes(n).split('.').pop().toLowerCase();
const q = (n) => `"${String(n).replace(/"/g, '""')}"`;

// ------------------------------------------------------------- Types
const ALIAS = {
  INTEGER: 'INT', INT4: 'INT', INT8: 'BIGINT', INT2: 'SMALLINT',
  'CHARACTER VARYING': 'VARCHAR', VARCHAR2: 'VARCHAR', NVARCHAR: 'VARCHAR', NVARCHAR2: 'VARCHAR',
  NUMERIC: 'DECIMAL', DEC: 'DECIMAL', NUMBER: 'DECIMAL',
  'DOUBLE PRECISION': 'DOUBLE', FLOAT8: 'DOUBLE', BOOL: 'BOOLEAN', DATETIME: 'TIMESTAMP',
  CHARACTER: 'CHAR', NCHAR: 'CHAR',
};
function parseType(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  const m = /^([A-Za-z_ ]+?)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?\s*$/.exec(s.replace(/\s+/g, ' '));
  if (!m) return { base: s.toUpperCase(), p: null, s: null, text: s.toUpperCase() };
  let base = m[1].trim().toUpperCase();
  base = ALIAS[base] || base;
  const p = m[2] != null ? Number(m[2]) : null;
  const sc = m[3] != null ? Number(m[3]) : null;
  const text = base + (p != null ? `(${p}${sc != null ? ',' + sc : ''})` : '');
  return { base, p, s: sc, text };
}
const FAMILY = {
  INT: 'int', BIGINT: 'int', SMALLINT: 'int', TINYINT: 'int',
  DECIMAL: 'num', FLOAT: 'num', DOUBLE: 'num', REAL: 'num',
  DATE: 'date', TIMESTAMP: 'ts', VARCHAR: 'str', CHAR: 'str', TEXT: 'str', BOOLEAN: 'bool',
};
const family = (t) => (t && FAMILY[t.base]) || 'other';

module.exports = { mask, splitTopLevel, stripComments, splitStatements, splitClauses, normExpr, stripQuotes, key, q, parseType, family };
