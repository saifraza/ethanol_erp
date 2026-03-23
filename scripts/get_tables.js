
const { Client } = require('pg');

const DATABASE_URL = 'postgresql://postgres:DrENyRNbBLtcdBMKzgIbIhHSMDiiXvBu@shuttle.proxy.rlwy.net:15470/railway';

async function listTables() {
    const client = new Client({
        connectionString: DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('Connected to Railway database.');

        const result = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public';");
        console.log('Tables in public schema:', result.rows.map(row => row.tablename));
    } catch (err) {
        console.error('Error querying Railway database:', err);
    } finally {
        await client.end();
        console.log('Disconnected from Railway database.');
    }
}

listTables();

