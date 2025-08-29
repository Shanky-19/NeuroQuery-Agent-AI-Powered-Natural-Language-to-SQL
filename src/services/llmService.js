const OpenAI = require('openai')
const logger = require('../utils/logger')
const cacheService = require('./cacheService')

class LLMService {
  constructor () {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
    this.model = process.env.OPENAI_MODEL || 'gpt-4'
    this.maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS) || 1000
    this.cachePrefix = 'llm:query:'
    this.cacheTTL = 1800 // 30 minutes
  }

  /**
   * Generate SQL query from natural language with function calling
   */
  async generateSQL (userQuery, schema) {
    try {
      // Check cache first
      const cacheKey = `${this.cachePrefix}${this.hashQuery(userQuery)}`
      const cachedResult = await cacheService.get(cacheKey)

      if (cachedResult) {
        logger.debug('LLM query result retrieved from cache')
        return { ...cachedResult, fromLLMCache: true }
      }

      const systemPrompt = this.buildSystemPrompt(schema)
      const userPrompt = this.buildUserPrompt(userQuery)

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        functions: [this.getSQLExecutionFunction()],
        function_call: { name: 'execute_sql' },
        max_tokens: this.maxTokens,
        temperature: 0.1 // Low temperature for consistent SQL generation
      })

      const result = this.parseResponse(response)

      // Cache the result
      await cacheService.set(cacheKey, result, this.cacheTTL)

      logger.info('SQL generated successfully', {
        userQuery: userQuery.substring(0, 100),
        generatedSQL: result.sql.substring(0, 200)
      })

      return result
    } catch (error) {
      logger.error('Error generating SQL:', error)
      throw new Error(`Failed to generate SQL: ${error.message}`)
    }
  }

  /**
   * Build system prompt with schema context
   */
  buildSystemPrompt (schema) {
    const tableDescriptions = schema.tables.map(table => {
      const columns = table.columns.map(col =>
        `  - ${col.name} (${col.type}${col.nullable ? ', nullable' : ', not null'})${col.comment ? ` - ${col.comment}` : ''}`
      ).join('\n')

      return `Table: ${table.name}${table.comment ? ` - ${table.comment}` : ''}\n${columns}`
    }).join('\n\n')

    const relationships = schema.relationships.length > 0
      ? '\n\nRelationships:\n' + schema.relationships.map(rel =>
          `${rel.fromTable}.${rel.fromColumn} -> ${rel.toTable}.${rel.toColumn}`
      ).join('\n')
      : ''

    return `You are a SQL expert that converts natural language questions into safe, read-only SQL queries.

IMPORTANT RULES:
1. ONLY generate SELECT statements - no INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, or any other modification commands
2. Always use proper SQL syntax for the database type
3. Include appropriate WHERE clauses to filter results
4. Use JOINs when querying multiple related tables
5. Add ORDER BY clauses when logical for the query
6. Limit results to reasonable amounts (use LIMIT/TOP)
7. Use aggregate functions (COUNT, SUM, AVG, etc.) when appropriate
8. Handle NULL values properly
9. Use proper date/time functions for date queries
10. Validate that all referenced tables and columns exist in the schema
11. Use DISTINCT when joining tables to avoid duplicate rows
12. Always use table aliases and qualify column names to avoid ambiguity
13. When joining multiple tables, select only necessary columns with meaningful aliases

Database Schema:
${tableDescriptions}${relationships}

${schema.filtered ? `\nNote: This is a filtered schema showing ${schema.tables.length} most relevant tables out of ${schema.originalTableCount} total tables.` : ''}

When generating SQL:
- Be precise and only query what's needed to answer the question
- Use meaningful aliases for tables and columns
- Include comments in the SQL to explain complex logic
- If the question is ambiguous, make reasonable assumptions and explain them
- If the question cannot be answered with the available schema, explain why`
  }

  /**
   * Build user prompt
   */
  buildUserPrompt (userQuery) {
    return `Convert this natural language question into a SQL query: "${userQuery}"

Please analyze the question and generate the most appropriate SELECT query to answer it. If you need to make assumptions, explain them in your reasoning.`
  }

  /**
   * Define the SQL execution function for OpenAI function calling
   */
  getSQLExecutionFunction () {
    return {
      name: 'execute_sql',
      description: 'Execute a read-only SQL SELECT query against the database',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'The SQL SELECT query to execute. Must be a valid SELECT statement only.'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation of how the SQL query answers the user\'s question'
          },
          assumptions: {
            type: 'string',
            description: 'Any assumptions made while generating the query'
          },
          confidence: {
            type: 'number',
            description: 'Confidence level in the query correctness (0-100)',
            minimum: 0,
            maximum: 100
          }
        },
        required: ['sql', 'reasoning', 'confidence']
      }
    }
  }

  /**
   * Parse OpenAI response
   */
  parseResponse (response) {
    try {
      const message = response.choices[0].message

      if (!message.function_call) {
        throw new Error('No function call in response')
      }

      let functionArgs
      try {
        functionArgs = JSON.parse(message.function_call.arguments)
      } catch (parseError) {
        logger.error('Failed to parse function call arguments:', {
          arguments: message.function_call.arguments,
          error: parseError.message
        })
        throw new Error(`Invalid JSON in function call arguments: ${parseError.message}`)
      }

      // Validate that it's a SELECT query
      const sql = functionArgs.sql.trim()
      if (!this.isSelectQuery(sql)) {
        throw new Error('Generated query is not a SELECT statement')
      }

      return {
        sql,
        reasoning: functionArgs.reasoning || '',
        assumptions: functionArgs.assumptions || '',
        confidence: functionArgs.confidence || 0,
        usage: response.usage,
        fromLLMCache: false
      }
    } catch (error) {
      logger.error('Error parsing LLM response:', error)
      throw new Error(`Failed to parse LLM response: ${error.message}`)
    }
  }

  /**
   * Validate that query is a SELECT statement
   */
  isSelectQuery (sql) {
    const trimmedSQL = sql.trim().toLowerCase()

    // Check if it starts with SELECT
    if (!trimmedSQL.startsWith('select')) {
      return false
    }

    // Check for dangerous keywords
    const dangerousKeywords = [
      'insert', 'update', 'delete', 'drop', 'create', 'alter',
      'truncate', 'grant', 'revoke', 'exec', 'execute', 'call'
    ]

    for (const keyword of dangerousKeywords) {
      if (trimmedSQL.includes(keyword)) {
        return false
      }
    }

    return true
  }

  /**
   * Generate a hash for caching queries
   */
  hashQuery (query) {
    const crypto = require('crypto')
    return crypto.createHash('md5').update(query.toLowerCase().trim()).digest('hex')
  }

  /**
   * Get usage statistics
   */
  async getUsageStats () {
    // This would typically integrate with OpenAI's usage API
    // For now, return basic stats
    return {
      totalRequests: 0, // Would track in Redis
      totalTokens: 0, // Would track in Redis
      cacheHitRate: 0 // Would calculate from cache hits/misses
    }
  }
}

module.exports = new LLMService()
