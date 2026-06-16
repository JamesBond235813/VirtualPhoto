import mysql from "mysql2/promise";

import { config } from "./config.mjs";

let pool;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...config.mysql,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      timezone: "Z",
    });
  }
  return pool;
}

export async function query(sql, params = {}) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

export async function withTransaction(callback) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
