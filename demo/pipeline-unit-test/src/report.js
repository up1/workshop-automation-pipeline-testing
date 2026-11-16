'use strict';
const ExcelJS = require('exceljs');
const { CATEGORIES } = require('./collector');

const COLORS = {
  PASS: { fill: 'FFC6EFCE', font: 'FF006100' },
  FAIL: { fill: 'FFFFC7CE', font: 'FF9C0006' },
  WARN: { fill: 'FFFFEB9C', font: 'FF9C5700' },
  SKIPPED: { fill: 'FFE7E6E6', font: 'FF595959' },
};
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function styleHeader(row) {
  row.eachCell((c) => { c.fill = HEAD; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = BORDER; });
  row.height = 22;
}
function statusCell(cell) {
  const c = COLORS[cell.value];
  if (c) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } }; cell.font = { bold: true, color: { argb: c.font } }; cell.alignment = { horizontal: 'center', vertical: 'top' }; }
}

async function writeReport(result, file) {
  const { meta, tests, details, exceptions, summary } = result;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pipeline Unit Test';
  wb.created = new Date();

  const wsum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });

  // ------------------------------------------------------------ Test Cases
  const ws = wb.addWorksheet('Test Cases', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Test ID', key: 'id', width: 10 },
    { header: 'Category', key: 'category', width: 24 },
    { header: 'Target Table', key: 'table', width: 20 },
    { header: 'Column / Object', key: 'column', width: 20 },
    { header: 'Test Case', key: 'description', width: 48 },
    { header: 'Expected', key: 'expected', width: 34 },
    { header: 'Actual', key: 'actual', width: 40 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Error / Exception Detail', key: 'detail', width: 70 },
  ];
  styleHeader(ws.getRow(1));
  const order = Object.keys(CATEGORIES);
  const sorted = [...tests].sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    const r = ws.addRow(t);
    r.eachCell((c) => { c.border = BORDER; c.alignment = { vertical: 'top', wrapText: true }; });
    statusCell(r.getCell('status'));
  }
  ws.autoFilter = { from: 'A1', to: `I${sorted.length + 1}` };

  // ------------------------------------------------------------ Failure Details
  const wd = wb.addWorksheet('Failure Details', { views: [{ state: 'frozen', ySplit: 1 }] });
  wd.columns = [
    { header: 'Test ID', key: 'testId', width: 10 }, { header: 'Target Table', key: 'table', width: 20 },
    { header: 'Column / Object', key: 'column', width: 22 }, { header: 'Row Key', key: 'key', width: 24 },
    { header: 'Expected', key: 'expected', width: 40 }, { header: 'Actual', key: 'actual', width: 40 }, { header: 'Issue', key: 'issue', width: 60 },
  ];
  styleHeader(wd.getRow(1));
  details.forEach((d) => { const r = wd.addRow(d); r.eachCell((c) => { c.border = BORDER; c.alignment = { vertical: 'top', wrapText: true }; }); });
  if (details.length) wd.autoFilter = { from: 'A1', to: `G${details.length + 1}` };

  // ------------------------------------------------------------ Exceptions
  const we = wb.addWorksheet('Exceptions', { views: [{ state: 'frozen', ySplit: 1 }] });
  we.columns = [
    { header: '#', key: 'n', width: 5 }, { header: 'Stage', key: 'stage', width: 28 }, { header: 'Object', key: 'object', width: 34 },
    { header: 'Related Test', key: 'testId', width: 13 }, { header: 'Exception Message', key: 'message', width: 60 }, { header: 'SQL / Rule', key: 'sql', width: 80 },
  ];
  styleHeader(we.getRow(1));
  exceptions.forEach((x, i) => { const r = we.addRow({ n: i + 1, ...x }); r.eachCell((c) => { c.border = BORDER; c.alignment = { vertical: 'top', wrapText: true }; }); });

  // ------------------------------------------------------------ Summary (วางเป็นแผ่นแรก)
  wsum.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  wsum.getCell('A1').value = 'Data Pipeline Unit Test Report';
  wsum.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FF1F4E78' } };
  wsum.getCell('A2').value = `Run: ${meta.startedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC   |   Duration: ${((meta.finishedAt - meta.startedAt) / 1000).toFixed(1)}s`;
  wsum.getCell('A2').font = { color: { argb: 'FF595959' } };

  wsum.getCell('A4').value = 'Overall Verdict';
  wsum.getCell('A4').font = { bold: true };
  const v = wsum.getCell('B4');
  v.value = summary.verdict;
  wsum.mergeCells('B4:C4');
  const vc = summary.verdict === 'FAIL' ? COLORS.FAIL : summary.verdict === 'PASS' ? COLORS.PASS : COLORS.WARN;
  v.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: vc.fill } };
  v.font = { bold: true, size: 14, color: { argb: vc.font } };
  v.alignment = { horizontal: 'center' };

  let r = 6;
  const hdr = (labels) => { labels.forEach((l, i) => { wsum.getCell(r, i + 1).value = l; }); styleHeader(wsum.getRow(r)); r++; };
  const row = (label, fallback) => {
    wsum.getCell(r, 1).value = label;
    const [tot, pass, fail, warn, skip] = [null, 'PASS', 'FAIL', 'WARN', 'SKIPPED'].map(fallback);
    [tot, pass, fail, warn, skip].forEach((n, i) => { wsum.getCell(r, i + 2).value = n; });
    wsum.getCell(r, 7).value = pass + fail ? pass / (pass + fail) : 0;
    wsum.getCell(r, 7).numFmt = '0.0%';
    for (let c = 1; c <= 7; c++) { wsum.getCell(r, c).border = BORDER; if (c > 1) wsum.getCell(r, c).alignment = { horizontal: 'center' }; }
    wsum.getCell(r, 3).font = { color: { argb: COLORS.PASS.font } };
    wsum.getCell(r, 4).font = { bold: true, color: { argb: COLORS.FAIL.font } };
    wsum.getCell(r, 5).font = { color: { argb: COLORS.WARN.font } };
    r++;
  };
  const count = (pred) => (st) => tests.filter((t) => pred(t) && (!st || t.status === st)).length;

  wsum.getCell(r, 1).value = 'By Category'; wsum.getCell(r, 1).font = { bold: true, size: 12 }; r++;
  hdr(['Category', 'Total', 'Pass', 'Fail', 'Warning', 'Skipped', 'Pass Rate*']);
  for (const [k, label] of Object.entries(CATEGORIES)) row(label, count((t) => t.cat === k));
  row('TOTAL', count(() => true));
  wsum.getRow(r - 1).font = { bold: true };

  r++;
  wsum.getCell(r, 1).value = 'By Target Table'; wsum.getCell(r, 1).font = { bold: true, size: 12 }; r++;
  hdr(['Target Table', 'Total', 'Pass', 'Fail', 'Warning', 'Skipped', 'Pass Rate*']);
  const tnames = [...new Set(tests.map((t) => t.table).filter(Boolean))];
  for (const n of tnames) row(n, count((t) => t.table === n));

  r++;
  wsum.getCell(r, 1).value = '* Pass Rate = Pass / (Pass + Fail); Warning และ Skipped ไม่นับรวม'; wsum.getCell(r, 1).font = { italic: true, color: { argb: 'FF7F7F7F' } };
  r += 2;
  wsum.getCell(r, 1).value = 'Input Files'; wsum.getCell(r, 1).font = { bold: true, size: 12 }; r++;
  ['Type', 'File', '', 'Detail'].forEach((l, i) => { wsum.getCell(r, i + 1).value = l; });
  styleHeader(wsum.getRow(r)); r++;
  for (const i of meta.inputs) {
    wsum.getCell(r, 1).value = i.type; wsum.getCell(r, 2).value = i.name; wsum.getCell(r, 4).value = i.info;
    wsum.mergeCells(r, 2, r, 3); wsum.mergeCells(r, 4, r, 7);
    r++;
  }
  wsum.getColumn(2).width = 14;

  // ใส่สีตามสถานะด้วย conditional formatting ให้แก้ค่าเองแล้วสียังตาม
  ws.addConditionalFormatting({
    ref: `H2:H${sorted.length + 1}`,
    rules: Object.entries(COLORS).map(([s, c]) => ({
      type: 'cellIs', operator: 'equal', formulae: [`"${s}"`], priority: 1,
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: c.fill } }, font: { color: { argb: c.font }, bold: true } },
    })),
  });

  await wb.xlsx.writeFile(file);
  return file;
}

module.exports = { writeReport };
