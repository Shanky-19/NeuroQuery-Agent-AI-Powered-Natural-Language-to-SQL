const database = require('../config/database')
const cacheService = require('./cacheService')
const logger = require('../utils/logger')

class QueryExecutionService {
  constructor () {
    this.cachePrefix = 'query:result:'
    this.cacheTTL = 300 // 5 minutes for query results
    this.maxResultRows = 1000
    this.defaultPageSize = 50
  }

  /**
   * Execute SQL query with security validation and pagination
   */
  async executeQuery (sql, options = {}) {
    try {
      const {
        page = 1,
        pageSize = this.defaultPageSize,
        useCache = true,
        dryRun = false
      } = options

      // Security validation
      this.validateQuery(sql)

      // Check cache first (if not dry run)
      if (useCache && !dryRun) {
        const cacheKey = this.generateCacheKey(sql, page, pageSize)
        const cachedResult = await cacheService.get(cacheKey)

        if (cachedResult) {
          logger.debug('Query result retrieved from cache')
          return { ...cachedResult, fromCache: true }
        }
      }

      // Dry run - explain plan only
      if (dryRun) {
        return await this.explainQuery(sql)
      }

      // Execute the actual query
      const result = await this.executeWithPagination(sql, page, pageSize)

      // Cache the result
      if (useCache && result.rows.length > 0) {
        const cacheKey = this.generateCacheKey(sql, page, pageSize)
        await cacheService.set(cacheKey, result, this.cacheTTL)
      }

      logger.info('Query executed successfully', {
        sql: sql.substring(0, 100),
        rowCount: result.rows.length,
        executionTime: result.executionTime
      })

      return result
    } catch (error) {
      logger.error('Query execution error:', {
        sql: sql.substring(0, 200),
        error: error.message
      })
      throw error
    }
  }

  /**
   * Validate SQL query for security
   */
  validateQuery (sql) {
    const trimmedSQL = sql.trim().toLowerCase()

    // Check if it's a SELECT statement
    if (!trimmedSQL.startsWith('select')) {
      throw new Error('Only SELECT statements are allowed')
    }

    // Note: Whitelist validation could be added here in the future if needed

    // Blacklist of dangerous keywords
    const blacklistedKeywords = [
      'insert', 'update', 'delete', 'drop', 'create', 'alter', 'truncate',
      'grant', 'revoke', 'exec', 'execute', 'call', 'declare', 'set',
      'use', 'backup', 'restore', 'shutdown', 'xp_', 'sp_', 'fn_',
      'openrowset', 'opendatasource', 'bulk', 'into', 'outfile',
      'dumpfile', 'load_file', 'pg_', 'mysql',
      'performance_schema', 'sys'
    ]

    // Check for blacklisted keywords (whole words only)
    for (const keyword of blacklistedKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i')
      if (regex.test(trimmedSQL)) {
        throw new Error(`Forbidden keyword detected: ${keyword}`)
      }
    }

    // Check for SQL injection patterns
    const injectionPatterns = [
      /;\s*(drop|delete|update|insert|create|alter)/i,
      /union\s+select/i,
      /\/\*.*\*\//,
      /--\s/,
      /#/,
      /xp_cmdshell/i,
      /sp_executesql/i
    ]

    for (const pattern of injectionPatterns) {
      if (pattern.test(sql)) {
        throw new Error('Potential SQL injection detected')
      }
    }

    // Check query length (prevent extremely long queries)
    if (sql.length > 10000) {
      throw new Error('Query too long')
    }

    // Validate parentheses are balanced
    const openParens = (sql.match(/\(/g) || []).length
    const closeParens = (sql.match(/\)/g) || []).length
    if (openParens !== closeParens) {
      throw new Error('Unbalanced parentheses in query')
    }
  }

  /**
   * Execute query with pagination
   */
  async executeWithPagination (sql, page, pageSize) {
    const startTime = Date.now()

    // Validate pagination parameters
    if (page < 1) page = 1
    if (pageSize < 1 || pageSize > 100) pageSize = this.defaultPageSize

    const offset = (page - 1) * pageSize

    // Add LIMIT and OFFSET to the query
    const paginatedSQL = this.addPaginationToSQL(sql, pageSize, offset)

    try {
      // Execute the paginated query
      const result = await database.query(paginatedSQL)

      // Get total count (for pagination info)
      const totalCount = await this.getTotalCount(sql)

      const executionTime = Date.now() - startTime

      return {
        rows: result.rows,
        pagination: {
          page,
          pageSize,
          totalRows: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
          hasNextPage: page < Math.ceil(totalCount / pageSize),
          hasPreviousPage: page > 1
        },
        metadata: {
          executionTime,
          rowCount: result.rows.length,
          fields: result.fields?.map(field => ({
            name: field.name,
            type: field.dataTypeID || field.type
          })) || []
        },
        fromCache: false
      }
    } catch (error) {
      throw new Error(`Query execution failed: ${error.message}`)
    }
  }

  /**
   * Add pagination to SQL query
   */
  addPaginationToSQL (sql, limit, offset) {
    const dbType = process.env.DB_TYPE || 'postgresql'

    // Remove trailing semicolon if present
    let cleanSQL = sql.trim().replace(/;+$/, '')

    // Debug logging
    logger.debug('Original SQL:', sql)
    logger.debug('Clean SQL:', cleanSQL)

    // Check if SQL already has LIMIT clause and extract it
    const limitRegex = /\s+LIMIT\s+(\d+)(\s+OFFSET\s+\d+)?$/i
    const limitMatch = cleanSQL.match(limitRegex)
    let finalLimit = limit

    if (limitMatch) {
      const existingLimit = parseInt(limitMatch[1])
      logger.debug('Found existing LIMIT:', existingLimit)
      // Use the smaller of the existing limit or pagination limit
      finalLimit = Math.min(existingLimit, limit)
      // Remove the existing LIMIT clause
      cleanSQL = cleanSQL.replace(limitRegex, '')
      logger.debug('Using final limit:', finalLimit)
    } else {
      logger.debug('No existing LIMIT found, using pagination limit:', limit)
    }

    const finalSQL = dbType === 'postgresql'
      ? `${cleanSQL} LIMIT ${finalLimit} OFFSET ${offset}`
      : `${cleanSQL} LIMIT ${offset}, ${finalLimit}`

    logger.debug('Final SQL with pagination:', finalSQL)
    return finalSQL
  }

  /**
   * Get total count for pagination
   */
  async getTotalCount (originalSQL) {
    try {
      // Remove trailing semicolon from original SQL before wrapping
      const cleanSQL = originalSQL.trim().replace(/;+$/, '')
      // Wrap the original query in a COUNT query
      const countSQL = `SELECT COUNT(*) as total_count FROM (${cleanSQL}) as count_query`
      const result = await database.query(countSQL)

      return parseInt(result.rows[0].total_count || result.rows[0].TOTAL_COUNT || 0)
    } catch (error) {
      logger.warn('Could not get total count, using estimated count', error)
      return 0
    }
  }

  /**
   * Explain query execution plan (dry run)
   */
  async explainQuery (sql) {
    try {
      const dbType = process.env.DB_TYPE || 'postgresql'
      let explainSQL

      if (dbType === 'postgresql') {
        explainSQL = `EXPLAIN (FORMAT JSON, ANALYZE false) ${sql}`
      } else if (dbType === 'mysql') {
        explainSQL = `EXPLAIN FORMAT=JSON ${sql}`
      } else {
        throw new Error(`Explain not supported for database type: ${dbType}`)
      }

      const result = await database.query(explainSQL)

      return {
        explainPlan: result.rows,
        isValid: true,
        estimatedCost: this.extractCostFromPlan(result.rows),
        warnings: this.analyzeExecutionPlan(result.rows)
      }
    } catch (error) {
      return {
        explainPlan: null,
        isValid: false,
        error: error.message,
        warnings: ['Query validation failed']
      }
    }
  }

  /**
   * Extract cost information from execution plan
   */
  extractCostFromPlan (planRows) {
    try {
      if (planRows && planRows.length > 0) {
        let plan
        try {
          plan = typeof planRows[0] === 'string'
            ? JSON.parse(planRows[0])
            : planRows[0]
        } catch (parseError) {
          logger.warn('Failed to parse execution plan JSON:', parseError)
          return { estimatedRows: 0, totalCost: 0 }
        }

        // PostgreSQL format
        if (plan.Plan) {
          return {
            startupCost: plan.Plan['Startup Cost'],
            totalCost: plan.Plan['Total Cost'],
            estimatedRows: plan.Plan['Plan Rows']
          }
        }

        // MySQL format
        if (plan.query_block) {
          return {
            estimatedRows: plan.query_block.cost_info?.read_cost || 0,
            totalCost: plan.query_block.cost_info?.eval_cost || 0
          }
        }
      }

      return { estimatedRows: 0, totalCost: 0 }
    } catch (error) {
      logger.warn('Could not extract cost from execution plan:', error)
      return { estimatedRows: 0, totalCost: 0 }
    }
  }

  /**
   * Analyze execution plan for warnings
   */
  analyzeExecutionPlan (planRows) {
    const warnings = []

    try {
      const planText = JSON.stringify(planRows).toLowerCase()

      if (planText.includes('seq scan') || planText.includes('table scan')) {
        warnings.push('Query performs full table scan - consider adding indexes')
      }

      if (planText.includes('nested loop') && planText.includes('large')) {
        warnings.push('Query uses nested loops on large datasets - performance may be slow')
      }

      if (planText.includes('sort') && planText.includes('disk')) {
        warnings.push('Query requires disk-based sorting - consider optimizing')
      }
    } catch (error) {
      logger.warn('Could not analyze execution plan:', error)
    }

    return warnings
  }

  /**
   * Generate cache key for query results
   */
  generateCacheKey (sql, page, pageSize) {
    const crypto = require('crypto')
    const queryHash = crypto.createHash('md5')
      .update(`${sql}:${page}:${pageSize}`)
      .digest('hex')
    return `${this.cachePrefix}${queryHash}`
  }

  /**
   * Get execution statistics
   */
  async getExecutionStats () {
    // This would typically track metrics in Redis
    return {
      totalQueries: 0,
      averageExecutionTime: 0,
      cacheHitRate: 0,
      errorRate: 0
    }
  }
}

module.exports = new QueryExecutionService()
