const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// 1. กำหนดเกณฑ์การแบ่งกลุ่มลูกค้า (Rule-based Thresholds)
function evaluateCustomerSegment(totalOrders, totalSpend) {
  if (totalOrders >= 10 && totalSpend >= 20000) {
    return { tier: 'VIP (ชั้นดีเยี่ยม)', status: 'Good', reportType: 'REPORT_VIP_LOYALTY' };
  }
  if (totalOrders >= 3 && totalSpend >= 5000) {
    return { tier: 'Standard Good (ชั้นดี)', status: 'Good', reportType: 'REPORT_GENERAL_SALES' };
  }
  if (totalOrders === 1 && totalSpend < 1000) {
    return { tier: 'At-Risk / Low Value (กลุ่มเสี่ยง/ยอดน้อย)', status: 'Bad', reportType: 'REPORT_RETENTION_ACTION' };
  }
  return { tier: 'Regular (ทั่วไป)', status: 'Neutral', reportType: 'REPORT_GENERAL_SALES' };
}

// 2. อ่านข้อมูลจาก CSV และ Aggregate รายลูกค้า
async function processSegmentation(inputFilePath) {
  const customerMap = new Map();

  return new Promise((resolve, reject) => {
    fs.createReadStream(inputFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const customerId = row.customer_id;
        const orderTotal = parseFloat(row.price) * parseInt(row.quantity, 10);
        const productName = row.product_name;

        if (!customerMap.has(customerId)) {
          customerMap.set(customerId, {
            customerId,
            customerName: row.customer_name,
            department: row.department, // หน่วยงานที่ดูแล
            orderIds: new Set(),
            totalSpend: 0,
            products: {} // เก็บความถี่ของสินค้าที่ซื้อเพื่อทำ Product Mapping
          });
        }

        const customer = customerMap.get(customerId);
        customer.orderIds.add(row.order_id);
        customer.totalSpend += orderTotal;
        customer.products[productName] = (customer.products[productName] || 0) + parseInt(row.quantity, 10);
      })
      .on('end', () => {
        resolve(customerMap);
      })
      .on('error', reject);
  });
}

// 3. ประมวลผล Segment + Product Mapping และแยก Report
async function generateReports(inputFilePath) {
  const customerMap = await processSegmentation(inputFilePath);

  const reports = {
    REPORT_VIP_LOYALTY: [],
    REPORT_GENERAL_SALES: [],
    REPORT_RETENTION_ACTION: []
  };

  for (const [id, data] of customerMap.entries()) {
    const totalOrders = data.orderIds.size;
    const totalSpend = data.totalSpend;

    // จัดกลุ่มลูกค้า
    const segment = evaluateCustomerSegment(totalOrders, totalSpend);

    // Product Mapping: หาสินค้าที่ลูกค้าซื้อบ่อยที่สุด (Top Product) และรายการทั้งหมด
    const sortedProducts = Object.entries(data.products).sort((a, b) => b[1] - a[1]);
    const topProduct = sortedProducts.length > 0 ? `${sortedProducts[0][0]} (${sortedProducts[0][1]} ชิ้น)` : 'N/A';
    const allProducts = sortedProducts.map(([name, qty]) => `${name}:${qty}`).join(' | ');

    const record = {
      customerId: data.customerId,
      customerName: data.customerName,
      department: data.department,
      totalOrders,
      totalSpend: totalSpend.toFixed(2),
      segmentTier: segment.tier,
      status: segment.status,
      topProduct,
      mappedProducts: allProducts
    };

    // Routing เข้า Report ที่เหมาะสม
    if (reports[segment.reportType]) {
      reports[segment.reportType].push(record);
    }
  }

  // 4. Export เป็นไฟล์ CSV แยกตาม Report
  for (const [reportName, records] of Object.entries(reports)) {
    if (records.length === 0) continue;

    const csvWriter = createCsvWriter({
      path: `./outputs/output_${reportName.toLowerCase()}.csv`,
      header: [
        { id: 'customerId', title: 'Customer ID' },
        { id: 'customerName', title: 'Customer Name' },
        { id: 'department', title: 'Department' },
        { id: 'totalOrders', title: 'Total Orders' },
        { id: 'totalSpend', title: 'Total Spend' },
        { id: 'segmentTier', title: 'Segment Tier' },
        { id: 'status', title: 'Customer Status' },
        { id: 'topProduct', title: 'Top Product' },
        { id: 'mappedProducts', title: 'All Mapped Products' }
      ]
    });

    await csvWriter.writeRecords(records);
    console.log(`Generated ${reportName}: ${records.length} records`);
  }
}

// รัน Workflow
generateReports('./inputs/orders.csv').catch(console.error);