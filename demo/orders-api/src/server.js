const { createDb } = require('./db');
const { createApp } = require('./app');

const db = createDb(process.env.DB_PATH || './data.sqlite');
createApp(db).listen(3000, () => console.log('listening on :3000'));
