# Seed data from scenario template


## Run
```
# ดูแผนก่อน ยังไม่เขียนข้อมูลลง DB
node seeder.mjs -t scenarios/bulk.template.json --dry-run

# seed ข้อมูลจาก template
node seeder.mjs -t scenarios/ecommerce.template.json --db seeded.db

# seed ซ้ำได้ (ลบเฉพาะแถวที่ scenario ใน template ที่สร้างมาก่อน)
node seeder.mjs -t scenarios/ecommerce.template.json --db seeded.db --clean

# seed เฉพาะบาง scenario / ลบข้อมูลทุกตารางแล้วสร้างใหม่
node seeder.mjs -t scenarios/ecommerce.template.json --only payment_retry --db seeded.db
node seeder.mjs -t scenarios/ecommerce.template.json --db seeded.db --reset
```