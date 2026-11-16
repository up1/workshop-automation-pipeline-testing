# Demo with Customer segmentation

## Requirements
ภาพรวมของ Workflow (Data Pipeline)
* Extract (อ่านและตรวจสอบข้อมูล CSV): ใช้ Stream-based parser เพื่อรองรับไฟล์ขนาดใหญ่โดยไม่กิน RAM
* Transform & Aggregate (รวมยอดรายลูกค้า): คำนวณ Total Orders (Frequency) และ Total Spend (Monetary) แยกรายลูกค้า พร้อมเก็บประวัติสินค้าที่ซื้อ
* Segment & Product Mapping (จัดกลุ่มและจับคู่สินค้า): ใช้เกณฑ์ (Rule-based / RFM Scoring) เพื่อแบ่งเกรดลูกค้า (เช่น VIP / ดี / ทั่วไป / เสี่ยง) และดึง Top Product หรือกลุ่มสินค้าที่ลูกค้าซื้อมาจับคู่ (Mapping)
* Report Routing (แยกเส้นทางรายงาน): ส่งข้อมูลออกไปตามประเภท Report ที่กำหนด (เช่น Executive Summary, CRM Retention, Marketing Upsell)

## Data format in folder `inputs`
```
order_id,customer_id,customer_name,department,product_id,product_name,price,quantity
```

## Report Routing Matrix
| กลุ่มลูกค้า (Segment) | เกณฑ์ (Orders / Spend) | Report ปลายทาง | วัตถุประสงค์การใช้งาน |
| --- | --- | --- | --- |
| **VIP (ชั้นดีเยี่ยม)** | $\ge 10$ ครั้ง และ $\ge 20,000$ บาท | `REPORT_VIP_LOYALTY` | ส่งให้ทีม Key Account ดูแลพิเศษ / มอบสิทธิประโยชน์ |
| **Standard Good (ชั้นดี)** | $\ge 3$ ครั้ง และ $\ge 5,000$ บาท | `REPORT_GENERAL_SALES` | ติดตามยอดขายปกติและเสนอสินค้าที่เกี่ยวข้อง (Upsell) |
| **At-Risk / Low (กลุ่มเสี่ยง)** | $1$ ครั้ง และ $< 1,000$ บาท | `REPORT_RETENTION_ACTION` | ส่งให้ทีม CRM ยิงแคมเปญดึงลูกค้ากลับมาซื้อซ้ำ |

## Initial project
* csv-parser: อ่านไฟล์ CSV แบบ Stream (ทำงานเร็วและจัดการ Memory ได้ดี)
* csv-writer: สร้างไฟล์ CSV แยกตามแต่ละ Report
```
npm init -y
npm install csv-parser csv-writer
```

## Demo code without database
```
node segment-workflow.js
```

Outputs
* Generated REPORT_VIP_LOYALTY: 2 records
* Generated REPORT_GENERAL_SALES: 5 records
* Generated REPORT_RETENTION_ACTION: 3 records
