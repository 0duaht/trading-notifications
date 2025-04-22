import { tool } from 'ai';
import { z } from 'zod';
import pg from 'pg';

if (!process.env.RATES_POSTGRES_URL) {
  throw new Error('Missing RATES_POSTGRES_URL environment variable');
}

// Create a connection pool that will be reused
const pool = new pg.Pool({
  connectionString: process.env.RATES_POSTGRES_URL,
});

export const getRates = tool({
  description: `
  Runs queries against a database table for exchange rates between currencies.

  The table is called "exchange_rates" and has the following columns:
  - from_currency_id: The currency code of the base currency e.g USDT, it's a text field

  - to_currency_id: The currency code of the target currency e.g NGN, it's a text field

  - rate: The exchange rate between the two currencies, it's a numeric field

  - side: Whether the rate is for buying or selling. It's a int4 field and is either 0 or 1
  e.g when from_currency_id is USDT and to_currency_id is NGN, and side is 0, the rate field is how much naira you get for buying 1 USDT,
  and when side is 1, the rate field is how much NGN you need to offer in exchange for 1 USDT

  - created_at: time inserted into db

  General guidelines:
  - You can optionally filter by date range using startDate and endDate parameters.
  - Remember to always convert the time to UTC before querying the database.
  - For when you're fetching rates from the past, only limit by the endDate unless the user specifies for rates between a range.
  - Rates are inserted into the database every minute. So factor that when trying to aggregate rates for a period, there'll be a lot of rate entries.
  - Try not to pull more than 100 records at a time, feel free to run multiple queries that pull smaller chunks instead of one giant one.
  `,
  parameters: z.object({
    fromCurrency: z.string().optional(),
    toCurrency: z.string().optional(),
    side: z.number().optional(),
    limit: z.number().optional(),
    startDate: z.string().optional().describe('ISO string date to start fetching rates from'),
    endDate: z.string().optional().describe('ISO string date to fetch rates until'),
    orderBy: z.object({
      column: z.string(),
      ascending: z.boolean()
    }).optional()
  }),
  execute: async ({ fromCurrency, toCurrency, side, limit = 100, startDate, endDate, orderBy }) => {
    console.log('querying with', { fromCurrency, toCurrency, side, limit, startDate, endDate, orderBy })
    const client = await pool.connect();
    try {
      // Build the query dynamically
      const conditions = [];
      const values = [];
      let paramCount = 1;

      if (fromCurrency) {
        conditions.push(`from_currency_id = $${paramCount}`);
        values.push(fromCurrency);
        paramCount++;
      }
      
      if (toCurrency) {
        conditions.push(`to_currency_id = $${paramCount}`);
        values.push(toCurrency);
        paramCount++;
      }

      if (typeof side === 'number') {
        conditions.push(`side = $${paramCount}`);
        values.push(side);
        paramCount++;
      }

      if (startDate) {
        conditions.push(`created_at >= $${paramCount}`);
        values.push(new Date(startDate));
        paramCount++;
      }

      if (endDate) {
        conditions.push(`created_at <= $${paramCount}`);
        values.push(new Date(endDate));
        paramCount++;
      }

      // Construct the WHERE clause if we have conditions
      const whereClause = conditions.length > 0 
        ? 'WHERE ' + conditions.join(' AND ') 
        : '';

      // Construct the ORDER BY clause
      const orderByClause = orderBy 
        ? `ORDER BY ${orderBy.column} ${orderBy.ascending ? 'ASC' : 'DESC'}`
        : 'ORDER BY created_at DESC';

      // Build the complete query
      const query = `
        SELECT * FROM exchange_rates 
        ${whereClause} 
        ${orderByClause}
        LIMIT $${paramCount}
      `;
      values.push(limit);

      const result = await client.query(query, values);
      return result.rows;
    } catch (error) {
      console.error('Error fetching rates:', error);
      throw error;
    } finally {
      client.release();
    }
  },
});
