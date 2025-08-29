const database = require('../config/database')
const redis = require('../config/redis')
const cacheService = require('./cacheService')
const logger = require('../utils/logger')

class SchemaService {
  constructor () {
    this.cachePrefix = 'schema:'
    this.tableCachePrefix = 'table:'
    this.schemaCacheTTL = 3600 // 1 hour
  }

  /**
   * Get complete database schema with caching
   */
  async getSchema () {
    const cacheKey = `${this.cachePrefix}complete`

    try {
      // Try to get from cache first
      const cachedSchema = await cacheService.get(cacheKey)
      if (cachedSchema) {
        logger.debug('Schema retrieved from cache')
        return cachedSchema
      }

      // Fetch fresh schema from database
      const schema = await this.fetchSchemaFromDatabase()

      // Cache the schema
      await cacheService.set(cacheKey, schema, this.schemaCacheTTL)

      logger.info(`Schema fetched and cached: ${schema.tables.length} tables`)
      return schema
    } catch (error) {
      logger.error('Error getting schema:', error)
      throw error
    }
  }

  /**
   * Get filtered schema based on relevant tables for a query
   */
  async getRelevantSchema (userQuery, maxTables = 10) {
    try {
      const fullSchema = await this.getSchema()
      const relevantTables = this.findRelevantTables(userQuery, fullSchema.tables, maxTables)

      return {
        ...fullSchema,
        tables: relevantTables,
        filtered: true,
        originalTableCount: fullSchema.tables.length
      }
    } catch (error) {
      logger.error('Error getting relevant schema:', error)
      throw error
    }
  }

  /**
   * Fetch schema directly from database
   */
  async fetchSchemaFromDatabase () {
    try {
      const dbType = process.env.DB_TYPE || 'postgresql'

      if (dbType === 'postgresql') {
        return await this.fetchPostgreSQLSchema()
      } else if (dbType === 'mysql') {
        return await this.fetchMySQLSchema()
      } else {
        throw new Error(`Unsupported database type: ${dbType}`)
      }
    } catch (error) {
      logger.error('Error fetching schema from database:', error)
      throw error
    }
  }

  /**
   * Fetch PostgreSQL schema
   */
  async fetchPostgreSQLSchema () {
    const tablesQuery = `
      SELECT 
        t.table_name,
        t.table_type,
        obj_description(c.oid) as table_comment
      FROM information_schema.tables t
      LEFT JOIN pg_class c ON c.relname = t.table_name
      WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name;
    `

    const columnsQuery = `
      SELECT 
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        col_description(pgc.oid, c.ordinal_position) as column_comment
      FROM information_schema.columns c
      LEFT JOIN pg_class pgc ON pgc.relname = c.table_name
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position;
    `

    const foreignKeysQuery = `
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public';
    `

    const [tablesResult, columnsResult, foreignKeysResult] = await Promise.all([
      database.query(tablesQuery),
      database.query(columnsQuery),
      database.query(foreignKeysQuery)
    ])

    return this.buildSchemaObject(tablesResult.rows, columnsResult.rows, foreignKeysResult.rows)
  }

  /**
   * Fetch MySQL schema
   */
  async fetchMySQLSchema () {
    const dbName = process.env.DB_NAME

    const tablesQuery = `
      SELECT 
        TABLE_NAME as table_name,
        TABLE_TYPE as table_type,
        TABLE_COMMENT as table_comment
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME;
    `

    const columnsQuery = `
      SELECT 
        TABLE_NAME as table_name,
        COLUMN_NAME as column_name,
        DATA_TYPE as data_type,
        IS_NULLABLE as is_nullable,
        COLUMN_DEFAULT as column_default,
        CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
        NUMERIC_PRECISION as numeric_precision,
        NUMERIC_SCALE as numeric_scale,
        COLUMN_COMMENT as column_comment
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `

    const foreignKeysQuery = `
      SELECT
        TABLE_NAME as table_name,
        COLUMN_NAME as column_name,
        REFERENCED_TABLE_NAME as foreign_table_name,
        REFERENCED_COLUMN_NAME as foreign_column_name,
        CONSTRAINT_NAME as constraint_name
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
      AND REFERENCED_TABLE_NAME IS NOT NULL;
    `

    const [tablesResult, columnsResult, foreignKeysResult] = await Promise.all([
      database.query(tablesQuery, [dbName]),
      database.query(columnsQuery, [dbName]),
      database.query(foreignKeysQuery, [dbName])
    ])

    return this.buildSchemaObject(tablesResult.rows, columnsResult.rows, foreignKeysResult.rows)
  }

  /**
   * Build schema object from query results
   */
  buildSchemaObject (tables, columns, foreignKeys) {
    const schema = {
      tables: [],
      relationships: [],
      metadata: {
        fetchedAt: new Date().toISOString(),
        tableCount: tables.length,
        totalColumns: columns.length
      }
    }

    // Group columns by table
    const columnsByTable = columns.reduce((acc, col) => {
      if (!acc[col.table_name]) {
        acc[col.table_name] = []
      }
      acc[col.table_name].push({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES',
        default: col.column_default,
        maxLength: col.character_maximum_length,
        precision: col.numeric_precision,
        scale: col.numeric_scale,
        comment: col.column_comment
      })
      return acc
    }, {})

    // Build table objects
    schema.tables = tables.map(table => ({
      name: table.table_name,
      type: table.table_type,
      comment: table.table_comment,
      columns: columnsByTable[table.table_name] || []
    }))

    // Build relationships
    schema.relationships = foreignKeys.map(fk => ({
      fromTable: fk.table_name,
      fromColumn: fk.column_name,
      toTable: fk.foreign_table_name,
      toColumn: fk.foreign_column_name,
      constraintName: fk.constraint_name
    }))

    return schema
  }

  /**
   * Find relevant tables based on user query
   */
  findRelevantTables (userQuery, tables, maxTables) {
    const queryLower = userQuery.toLowerCase()
    const scoredTables = tables.map(table => {
      let score = 0

      // Score based on table name match
      if (queryLower.includes(table.name.toLowerCase())) {
        score += 10
      }

      // Score based on table comment match
      if (table.comment && queryLower.includes(table.comment.toLowerCase())) {
        score += 5
      }

      // Score based on column name matches
      table.columns.forEach(column => {
        if (queryLower.includes(column.name.toLowerCase())) {
          score += 3
        }
        if (column.comment && queryLower.includes(column.comment.toLowerCase())) {
          score += 2
        }
      })

      // Boost score for common business tables
      const commonTables = ['user', 'customer', 'order', 'product', 'sale', 'invoice', 'payment']
      if (commonTables.some(common => table.name.toLowerCase().includes(common))) {
        score += 2
      }

      return { ...table, _relevanceScore: score }
    })

    // Sort by relevance score and return top tables
    return scoredTables
      .sort((a, b) => b._relevanceScore - a._relevanceScore)
      .slice(0, maxTables)
      .map(({ _relevanceScore, ...table }) => table)
  }

  /**
   * Invalidate schema cache
   */
  async invalidateCache () {
    try {
      const cacheKey = `${this.cachePrefix}complete`
      await redis.del(cacheKey)
      logger.info('Schema cache invalidated')
    } catch (error) {
      logger.error('Error invalidating schema cache:', error)
    }
  }

  /**
   * Get table statistics for monitoring
   */
  async getTableStats () {
    try {
      const schema = await this.getSchema()
      return {
        totalTables: schema.tables.length,
        totalColumns: schema.tables.reduce((sum, table) => sum + table.columns.length, 0),
        totalRelationships: schema.relationships.length,
        lastFetched: schema.metadata.fetchedAt
      }
    } catch (error) {
      logger.error('Error getting table stats:', error)
      throw error
    }
  }
}

module.exports = new SchemaService()
