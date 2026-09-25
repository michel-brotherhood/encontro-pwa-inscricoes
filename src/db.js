import pg from 'pg';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ...(process.env.PGSSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {})
});

pool.on('error', (error) => {
  console.error('Erro inesperado no pool do PostgreSQL:', error.message);
});
