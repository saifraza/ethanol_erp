
const { Client } = require('pg');
const fs = require('fs');

const DATABASE_URL = 'postgresql://postgres:DrENyRNbBLtcdBMKzgIbIhHSMDiiXvBu@shuttle.proxy.rlwy.net:15470/railway';

async function runSqlScript() {
    const client = new Client({
        connectionString: DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('Connected to Railway database.');

        // Set search_path to public
        await client.query("SET search_path TO public;");
        console.log('Search path set to public.');

        const sql = fs.readFileSync('update_db.sql', 'utf8');
        const statements = sql.split(';').filter(s => s.trim().length > 0);

        for (const statement of statements) {
            await client.query(statement);
        }
        console.log('SQL script executed successfully on Railway database.');
    } catch (err) {
        console.error('Error executing SQL script on Railway database:', err);
    } finally {
        await client.end();
        console.log('Disconnected from Railway database.');
    }
}

runSqlScript();

