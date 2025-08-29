require('dotenv').config()

const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')

const logger = require('./utils/logger')
const database = require('./config/database')
const redis = require('./config/redis')

// Import services
const schemaService = require('./services/schemaService')
const llmService = require('./services/llmService')
const queryExecutionService = require('./services/queryExecutionService')
const cacheService = require('./services/cacheService')
const historyService = require('./services/historyService')

const app = express()
const PORT = process.env.PORT || 3000

// Import metrics middleware
const { trackHttpMetrics, metricsEndpoint } = require('./middleware/metrics')

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  }
}))
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
})

app.use('/api/', limiter)

// Metrics tracking middleware
app.use(trackHttpMetrics)

// Serve static files
app.use(express.static('public'))

// Metrics endpoint
app.get('/metrics', metricsEndpoint)

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.method === 'POST' ? req.body : undefined
  })
  next()
})

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbConnected = await database.testConnection()
    const redisConnected = redis.isConnected

    const health = {
      status: dbConnected && redisConnected ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbConnected ? 'connected' : 'disconnected',
        redis: redisConnected ? 'connected' : 'disconnected'
      }
    }

    res.status(health.status === 'healthy' ? 200 : 503).json(health)
  } catch (error) {
    logger.error('Health check failed:', error)
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// API Routes

/**
 * Get database schema
 */
app.get('/api/v1/schema', async (req, res) => {
  try {
    const { relevant, query, maxTables } = req.query

    let schema
    if (relevant && query) {
      schema = await schemaService.getRelevantSchema(query, parseInt(maxTables) || 10)
    } else {
      schema = await schemaService.getSchema()
    }

    res.json({
      success: true,
      data: schema
    })
  } catch (error) {
    logger.error('Schema endpoint error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve schema',
      message: error.message
    })
  }
})

/**
 * Generate SQL from natural language
 */
app.post('/api/v1/generate-sql', async (req, res) => {
  try {
    const { query, useRelevantSchema = true, maxTables = 10 } = req.body

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Query is required and must be a string'
      })
    }

    // Get appropriate schema
    let schema
    if (useRelevantSchema) {
      schema = await schemaService.getRelevantSchema(query, maxTables)
    } else {
      schema = await schemaService.getSchema()
    }

    // Generate SQL using LLM
    const result = await llmService.generateSQL(query, schema)

    res.json({
      success: true,
      data: {
        sql: result.sql,
        reasoning: result.reasoning,
        assumptions: result.assumptions,
        confidence: result.confidence,
        schemaUsed: {
          tableCount: schema.tables.length,
          filtered: schema.filtered || false
        }
      }
    })
  } catch (error) {
    logger.error('Generate SQL endpoint error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to generate SQL',
      message: error.message
    })
  }
})

/**
 * Execute SQL query
 */
app.post('/api/v1/execute-sql', async (req, res) => {
  try {
    const {
      sql,
      page = 1,
      pageSize = 50,
      useCache = true,
      dryRun = false
    } = req.body

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'SQL query is required and must be a string'
      })
    }

    const result = await queryExecutionService.executeQuery(sql, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      useCache,
      dryRun
    })

    res.json({
      success: true,
      data: result
    })
  } catch (error) {
    logger.error('Execute SQL endpoint error:', error)
    res.status(400).json({
      success: false,
      error: 'Failed to execute SQL query',
      message: error.message
    })
  }
})

/**
 * Complete natural language to SQL workflow
 */
app.post('/api/v1/query', async (req, res) => {
  try {
    const {
      query,
      page = 1,
      pageSize = 50,
      useCache = true,
      dryRun = false,
      useRelevantSchema = true,
      maxTables = 10
    } = req.body

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Natural language query is required and must be a string'
      })
    }

    // Step 1: Get relevant schema
    let schema
    if (useRelevantSchema) {
      schema = await schemaService.getRelevantSchema(query, maxTables)
    } else {
      schema = await schemaService.getSchema()
    }

    // Step 2: Generate SQL
    const llmResult = await llmService.generateSQL(query, schema)

    // Step 3: Execute SQL (if not dry run)
    let executionResult = null
    if (!dryRun) {
      executionResult = await queryExecutionService.executeQuery(llmResult.sql, {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        useCache
      })
    } else {
      executionResult = await queryExecutionService.executeQuery(llmResult.sql, {
        dryRun: true
      })
    }

    const responseData = {
      originalQuery: query,
      generatedSQL: llmResult.sql,
      reasoning: llmResult.reasoning,
      assumptions: llmResult.assumptions,
      confidence: llmResult.confidence,
      result: executionResult,
      schemaInfo: {
        tableCount: schema.tables.length,
        filtered: schema.filtered || false,
        originalTableCount: schema.originalTableCount
      }
    }

    // Save to history (async, don't wait)
    const userId = req.headers['x-user-id'] || req.ip || 'anonymous'
    historyService.saveQuery(responseData, userId).catch(error => {
      logger.warn('Failed to save query to history:', error)
    })

    res.json({
      success: true,
      data: responseData
    })
  } catch (error) {
    logger.error('Complete query endpoint error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to process natural language query',
      message: error.message
    })
  }
})

/**
 * Get system statistics
 */
app.get('/api/v1/stats', async (req, res) => {
  try {
    const [schemaStats, executionStats, cacheHealth] = await Promise.all([
      schemaService.getTableStats(),
      queryExecutionService.getExecutionStats(),
      cacheService.healthCheck()
    ])

    res.json({
      success: true,
      data: {
        schema: schemaStats,
        execution: executionStats,
        cache: cacheHealth,
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version
        }
      }
    })
  } catch (error) {
    logger.error('Stats endpoint error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics',
      message: error.message
    })
  }
})

/**
 * Get cache statistics
 */
app.get('/api/v1/cache/stats', async (req, res) => {
  try {
    const stats = cacheService.getStats()
    const health = await cacheService.healthCheck()

    res.json({
      success: true,
      data: {
        statistics: stats,
        health,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    logger.error('Cache stats endpoint error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve cache statistics',
      message: error.message
    })
  }
})

/**
 * Invalidate caches
 */
app.post('/api/v1/cache/invalidate', async (req, res) => {
  try {
    const { type = 'all', pattern } = req.body

    let deletedCount = 0

    if (pattern) {
      // Delete by pattern
      deletedCount = await cacheService.delPattern(pattern)
    } else if (type === 'schema' || type === 'all') {
      await schemaService.invalidateCache()
      deletedCount++
    }

    if (type === 'queries') {
      deletedCount += await cacheService.delPattern('query:result:*')
    }

    if (type === 'llm') {
      deletedCount += await cacheService.delPattern('llm:query:*')
    }

    if (type === 'all' && !pattern) {
      await redis.flush()
      deletedCount = 'all'
    }

    res.json({
      success: true,
      message: `Cache invalidated: ${type}`,
      deletedCount
    })
  } catch (error) {
    logger.error('Cache invalidation error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to invalidate cache',
      message: error.message
    })
  }
})

/**
 * Warm cache with frequently accessed data
 */
app.post('/api/v1/cache/warm', async (req, res) => {
  try {
    const warmupFunctions = [
      {
        key: 'schema:complete',
        fetchFn: () => schemaService.fetchSchemaFromDatabase(),
        ttl: 3600
      }
    ]

    const results = await cacheService.warmCache(warmupFunctions)
    const successful = results.filter(r => r.success).length

    res.json({
      success: true,
      message: `Cache warmup completed: ${successful}/${results.length} successful`,
      results
    })
  } catch (error) {
    logger.error('Cache warmup error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to warm cache',
      message: error.message
    })
  }
})

// History API Routes

/**
 * Get user's query history
 */
app.get('/api/v1/history', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.ip || 'anonymous'
    const {
      limit = 20,
      offset = 0,
      includeErrors = 'true',
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query

    const options = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      includeErrors: includeErrors === 'true',
      sortBy,
      sortOrder
    }

    const history = await historyService.getUserHistory(userId, options)

    res.json({
      success: true,
      data: history
    })
  } catch (error) {
    logger.error('History endpoint error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve history',
      message: error.message
    })
  }
})

/**
 * Search query history
 */
app.get('/api/v1/history/search', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.ip || 'anonymous'
    const { q: searchTerm, limit = 10 } = req.query

    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        error: 'Search term is required'
      })
    }

    const results = await historyService.searchHistory(searchTerm, userId, {
      limit: parseInt(limit)
    })

    res.json({
      success: true,
      data: results
    })
  } catch (error) {
    logger.error('History search endpoint error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to search history',
      message: error.message
    })
  }
})

/**
 * Get a specific history entry
 */
app.get('/api/v1/history/:historyId', async (req, res) => {
  try {
    const { historyId } = req.params
    const entry = await historyService.getHistoryEntry(historyId)

    res.json({
      success: true,
      data: entry
    })
  } catch (error) {
    logger.error('Get history entry error:', error)
    res.status(404).json({
      success: false,
      error: 'History entry not found',
      message: error.message
    })
  }
})

/**
 * Delete a history entry
 */
app.delete('/api/v1/history/:historyId', async (req, res) => {
  try {
    const { historyId } = req.params
    const userId = req.headers['x-user-id'] || req.ip || 'anonymous'

    await historyService.deleteHistoryEntry(historyId, userId)

    res.json({
      success: true,
      message: 'History entry deleted'
    })
  } catch (error) {
    logger.error('Delete history entry error:', error)
    res.status(400).json({
      success: false,
      error: 'Failed to delete history entry',
      message: error.message
    })
  }
})

/**
 * Clear user's history
 */
app.delete('/api/v1/history', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.ip || 'anonymous'
    const deletedCount = await historyService.clearUserHistory(userId)

    res.json({
      success: true,
      message: `Cleared ${deletedCount} history entries`
    })
  } catch (error) {
    logger.error('Clear history error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to clear history',
      message: error.message
    })
  }
})

/**
 * Get history statistics
 */
app.get('/api/v1/history/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.ip || 'anonymous'
    const stats = await historyService.getHistoryStats(userId)

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    logger.error('History stats error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get history statistics',
      message: error.message
    })
  }
})

/**
 * Get popular queries (analytics)
 */
app.get('/api/v1/analytics/popular-queries', async (req, res) => {
  try {
    const { limit = 10, timeframe = '7d' } = req.query
    const popularQueries = await historyService.getPopularQueries({
      limit: parseInt(limit),
      timeframe
    })

    res.json({
      success: true,
      data: popularQueries
    })
  } catch (error) {
    logger.error('Popular queries error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get popular queries',
      message: error.message
    })
  }
})

// Error handling middleware
app.use((error, req, res, _next) => {
  logger.error('Unhandled error:', error)
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  })
})

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `${req.method} ${req.originalUrl} not found`
  })
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully')

  try {
    await database.close()
    await redis.close()
    process.exit(0)
  } catch (error) {
    logger.error('Error during shutdown:', error)
    process.exit(1)
  }
})

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully')

  try {
    await database.close()
    await redis.close()
    process.exit(0)
  } catch (error) {
    logger.error('Error during shutdown:', error)
    process.exit(1)
  }
})

// Start server
app.listen(PORT, () => {
  logger.info(`Natural Language to SQL API server started on port ${PORT}`)
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`)
  logger.info(`API Documentation available at http://localhost:${PORT}/api/v1`)
})

module.exports = app
