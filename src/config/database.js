const { Pool } = require('pg')
const mysql = require('mysql2/promise')
const logger = require('../utils/logger')

class DatabaseConfig {
  constructor () {
    this.dbType = process.env.DB_TYPE || 'postgresql'
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'sample_db',
      user: process.env.DB_USER || 'readonly_user',
      password: process.env.DB_PASSWORD || 'readonly_pass',
      ssl: process.env.DB_SSL === 'true'
    }

    this.pool = null
    this.initializePool()
  }

  initializePool () {
    try {
      if (this.dbType === 'postgresql') {
        this.pool = new Pool({
          ...this.config,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000
        })

        this.pool.on('error', (err) => {
          logger.error('PostgreSQL pool error:', err)
        })
      } else if (this.dbType === 'mysql') {
        this.pool = mysql.createPool({
          ...this.config,
          waitForConnections: true,
          connectionLimit: 20,
          queueLimit: 0
        })
      }

      logger.info(`Database pool initialized for ${this.dbType}`)
    } catch (error) {
      logger.error('Failed to initialize database pool:', error)
      throw error
    }
  }

  async query (text, params = []) {
    const start = Date.now()
    try {
      if (this.dbType === 'postgresql') {
        const result = await this.pool.query(text, params)
        return {
          rows: result.rows,
          rowCount: result.rowCount,
          fields: result.fields
        }
      } else if (this.dbType === 'mysql') {
        const [rows, fields] = await this.pool.execute(text, params)
        return {
          rows,
          rowCount: rows.length,
          fields
        }
      }

      throw new Error(`Unsupported database type: ${this.dbType}`)
    } catch (error) {
      logger.error('Database query error:', {
        query: text,
        params,
        error: error.message
      })
      throw error
    } finally {
      const duration = Date.now() - start
      logger.debug(`Query executed in ${duration}ms`)
    }
  }

  async testConnection () {
    try {
      await this.query('SELECT 1 as test')
      logger.info('Database connection test successful')
      return true
    } catch (error) {
      logger.error('Database connection test failed:', error)
      return false
    }
  }

  async close () {
    if (this.pool) {
      if (this.dbType === 'postgresql') {
        await this.pool.end()
      } else if (this.dbType === 'mysql') {
        await this.pool.end()
      }
      logger.info('Database pool closed')
    }
  }
}

module.exports = new DatabaseConfig()
