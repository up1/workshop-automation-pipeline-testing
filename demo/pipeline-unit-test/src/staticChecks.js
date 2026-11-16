'use strict';
const U = require('./util');

const KW = new Set(('case when then else end and or not null is in as cast between like ilike true false distinct over partition by order asc desc ' +
  'current_date current_timestamp current_time localtime localtimestamp interval using on select from where group having exists all any some div mod ' +
  'year month day hour minute second week quarter epoch escape collate').split(' '));
const TYPES = new Set(('int integer bigint smallint tinyint decimal numeric float double real varchar char text date timestamp datetime boolean bool ' +
  'signed unsigned varchar2 number precision').split(' '));
const RESERVED_ALIAS = new Set(['on', 'where', 'left', 'right', 'inner', 'join', 'full', 'cross', 'group', 'order', 'using', 'natural', 'outer', 'limit', 'having']);

const stripFrom = (s) => String(s || '').trim().replace(/^from\b\s*/i, '');

function parseFromTables(from) {
  const text = 'FROM ' + stripFrom(from);
  const res = [];
  const re = /\b(?:from|join)\s+([\w."`\[\]]+)(?:\s+(?:as\s+)?([A-Za-z_]\w*))?/gi;
  let m;
  while ((m = re.exec(text))) {
    const alias = m[2] && !RESERVED_ALIAS.has(m[2].toLowerCase()) ? m[2].toLowerCase() : null;
    res.push({ table: U.key(m[1]), alias });
  }
  return { tables: res, hasSubquery: /\(\s*select\b/i.test(text) };
}

function extractRefs(rule) {
  const s = String(rule || '').replace(/'(?:[^']|'')*'/g, "''").replace(/"[^"]*"/g, '""');
  const refs = [];
  const re = /(?<![\w.$])([A-Za-z_][\w$]*)(?:\.([A-Za-z_][\w$]*))?(\s*\()?/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[3]) continue; // function call
    const a = m[1].toLowerCase(), b = m[2] && m[2].toLowerCase();
    if (!b && (KW.has(a) || TYPES.has(a))) continue;
    refs.push(b ? { alias: a, col: b } : { col: a });
  }
  return refs;
}

/** ตรวจว่าทุก column/table ที่อ้างใน rule มีอยู่ใน DDL */
function resolveRefs(rule, from, ddl) {
  const { tables, hasSubquery } = parseFromTables(from);
  if (hasSubquery) return { status: 'WARN', msg: 'FROM มี subquery: ข้ามการตรวจ reference', problems: [] };
  const aliasMap = {};
  for (const t of tables) { aliasMap[t.table] = t.table; if (t.alias) aliasMap[t.alias] = t.table; }
  const problems = [];
  for (const r of extractRefs(rule)) {
    if (r.alias) {
      const t = aliasMap[r.alias];
      if (!t) { problems.push(`alias "${r.alias}" ไม่มีใน FROM (${r.alias}.${r.col})`); continue; }
      if (!ddl[t]) { problems.push(`ตาราง "${t}" ไม่มีใน DDL (${r.alias}.${r.col})`); continue; }
      if (!ddl[t].columns.some((c) => c.key === r.col)) problems.push(`ไม่พบคอลัมน์ "${r.col}" ในตาราง ${t} (${r.alias}.${r.col})`);
    } else {
      const hits = [...new Set(tables.map((t) => t.table))].filter((t) => ddl[t] && ddl[t].columns.some((c) => c.key === r.col));
      if (hits.length === 0) problems.push(`ไม่พบคอลัมน์ "${r.col}" ในตารางต้นทางใด ๆ`);
      else if (hits.length > 1) problems.push(`คอลัมน์ "${r.col}" กำกวม (พบใน ${hits.join(', ')})`);
    }
  }
  return { status: problems.length ? 'FAIL' : 'PASS', problems, msg: problems.join('; ') };
}

// ------------------------------------------------------------- Value validation (ใช้ทั้ง source profiling และ pre-check)
function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
function checkValue(v, type) {
  if (v == null || v === '' || !type) return null;
  const s = String(v);
  switch (U.family(type)) {
    case 'int': return /^[+-]?\d+$/.test(s.trim()) ? null : 'ไม่ใช่จำนวนเต็ม';
    case 'num': {
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim())) return 'ไม่ใช่ตัวเลข';
      if (type.base === 'DECIMAL' && type.p != null) {
        const intDigits = s.trim().replace(/^[+-]/, '').split('.')[0].replace(/^0+/, '').length;
        if (intDigits > type.p - (type.s || 0)) return `เกินความกว้าง ${type.text}`;
      }
      return null;
    }
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) && validDate(s.trim()) ? null : 'วันที่ไม่ถูกต้อง (YYYY-MM-DD)';
    case 'ts': {
      const m = /^\d{4}-\d{2}-\d{2}(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(s.trim());
      if (!m || !validDate(s.trim())) return 'วันที่/เวลาไม่ถูกต้อง';
      if (m[1] && (+m[1] > 23 || +m[2] > 59 || +m[3] > 59)) return 'เวลาไม่ถูกต้อง';
      return null;
    }
    case 'str': return type.p != null && s.length > type.p ? `ยาว ${s.length} > ${type.text}` : null;
    case 'bool': return /^(true|false|t|f|0|1|y|n)$/i.test(s) ? null : 'ไม่ใช่ boolean';
    default: return null;
  }
}

module.exports = { parseFromTables, extractRefs, resolveRefs, checkValue, stripFrom };
