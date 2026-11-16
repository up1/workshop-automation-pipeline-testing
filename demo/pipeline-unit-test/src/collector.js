'use strict';

const CATEGORIES = {
  STR: 'Structure (Spec vs DDL)',
  SQL: 'Logic (Spec vs SQL)',
  SRC: 'Source Data Quality',
  EXC: 'Exception Pre-check',
  EXE: 'Execution',
  DAT: 'Data Validation',
};

class Collector {
  constructor() {
    this.tests = [];
    this.details = [];
    this.exceptions = [];
    this._n = {};
    this._d = {};
  }

  /** status: PASS | FAIL | WARN | SKIPPED */
  add(cat, table, column, description, status, expected = '', actual = '', detail = '') {
    this._n[cat] = (this._n[cat] || 0) + 1;
    const t = {
      id: `${cat}-${String(this._n[cat]).padStart(3, '0')}`,
      cat, category: CATEGORIES[cat], table: table || '', column: column || '',
      description, status, expected: String(expected ?? ''), actual: String(actual ?? ''), detail: String(detail ?? ''),
    };
    this.tests.push(t);
    return t;
  }

  /** รายละเอียดระดับแถวของ Test ที่ Fail (จำกัดจำนวนต่อ Test) */
  addDetail(test, d, cap = 100) {
    this._d[test.id] = (this._d[test.id] || 0) + 1;
    if (this._d[test.id] > cap) return;
    this.details.push({ testId: test.id, table: test.table, column: test.column, key: '', expected: '', actual: '', issue: '', ...d });
  }

  addException(stage, object, testId, message, sql = '') {
    this.exceptions.push({ stage, object, testId, message: String(message), sql: String(sql).slice(0, 500) });
  }

  summary() {
    const s = { total: this.tests.length, PASS: 0, FAIL: 0, WARN: 0, SKIPPED: 0 };
    for (const t of this.tests) s[t.status]++;
    const run = s.PASS + s.FAIL;
    s.passRate = run ? s.PASS / run : 0;
    s.verdict = s.FAIL > 0 ? 'FAIL' : s.WARN > 0 ? 'PASS WITH WARNINGS' : 'PASS';
    return s;
  }
}

module.exports = { Collector, CATEGORIES };
