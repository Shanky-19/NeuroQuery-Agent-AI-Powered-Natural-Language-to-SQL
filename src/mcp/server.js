const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} = require('@modelcontextprotocol/sdk/types.js')

const schemaService = require('../services/schemaService')
const queryExecutionService = require('../services/queryExecutionService')
const logger = require('../utils/logger')

class DatabaseMCPServer {
  constructor () {
    this.server = new Server(
      {
        name: 'nl-to-sql-database',
        version: '1.0.0'
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    )

    this.setupHandlers()
  }

  setupHandlers () {
    // List available resources (database schema information)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const schema = await schemaService.getSchema()

        const resources = [
          {
            uri: 'database://schema/complete',
            mimeType: 'application/json',
            name: 'Complete Database Schema',
            description: 'Full database schema including all tables, columns, and relationships'
          },
          {
            uri: 'database://schema/tables',
            mimeType: 'application/json',
            name: 'Database Tables',
            description: 'List of all database tables with basic information'
          },
          {
            uri: 'database://schema/relationships',
            mimeType: 'application/json',
            name: 'Table Relationships',
            description: 'Foreign key relationships between tables'
          }
        ]

        // Add individual table resources
        schema.tables.forEach(table => {
          resources.push({
            uri: `database://table/${table.name}`,
            mimeType: 'application/json',
            name: `Table: ${table.name}`,
            description: `Schema and data information for table ${table.name}`
          })
        })

        return { resources }
      } catch (error) {
        logger.error('MCP ListResources error:', error)
        throw new McpError(ErrorCode.InternalError, `Failed to list resources: ${error.message}`)
      }
    })

    // Read specific resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params

      try {
        if (uri === 'database://schema/complete') {
          const schema = await schemaService.getSchema()
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(schema, null, 2)
              }
            ]
          }
        }

        if (uri === 'database://schema/tables') {
          const schema = await schemaService.getSchema()
          const tables = schema.tables.map(table => ({
            name: table.name,
            comment: table.comment,
            columnCount: table.columns.length
          }))

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(tables, null, 2)
              }
            ]
          }
        }

        if (uri === 'database://schema/relationships') {
          const schema = await schemaService.getSchema()
          const relationships = []

          schema.tables.forEach(table => {
            table.foreignKeys?.forEach(fk => {
              relationships.push({
                fromTable: table.name,
                fromColumn: fk.column,
                toTable: fk.referencedTable,
                toColumn: fk.referencedColumn,
                constraintName: fk.name
              })
            })
          })

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(relationships, null, 2)
              }
            ]
          }
        }

        // Handle individual table resources
        const tableMatch = uri.match(/^database:\/\/table\/(.+)$/)
        if (tableMatch) {
          const tableName = tableMatch[1]
          const schema = await schemaService.getSchema()
          const table = schema.tables.find(t => t.name === tableName)

          if (!table) {
            throw new McpError(ErrorCode.InvalidRequest, `Table ${tableName} not found`)
          }

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(table, null, 2)
              }
            ]
          }
        }

        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`)
      } catch (error) {
        logger.error('MCP ReadResource error:', error)
        if (error instanceof McpError) throw error
        throw new McpError(ErrorCode.InternalError, `Failed to read resource: ${error.message}`)
      }
    })

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'execute_sql_query',
            description: 'Execute a read-only SQL query against the database',
            inputSchema: {
              type: 'object',
              properties: {
                sql: {
                  type: 'string',
                  description: 'The SQL query to execute (SELECT statements only)'
                },
                page: {
                  type: 'number',
                  description: 'Page number for pagination (default: 1)',
                  default: 1
                },
                pageSize: {
                  type: 'number',
                  description: 'Number of rows per page (default: 50, max: 1000)',
                  default: 50,
                  maximum: 1000
                },
                dryRun: {
                  type: 'boolean',
                  description: 'If true, validate query without executing (default: false)',
                  default: false
                }
              },
              required: ['sql']
            }
          },
          {
            name: 'get_relevant_schema',
            description: 'Get database schema relevant to a natural language query',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Natural language description of what you want to query'
                },
                maxTables: {
                  type: 'number',
                  description: 'Maximum number of tables to include (default: 10)',
                  default: 10
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get_table_sample_data',
            description: 'Get sample data from a specific table',
            inputSchema: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: 'Name of the table to sample'
                },
                limit: {
                  type: 'number',
                  description: 'Number of sample rows to return (default: 5, max: 100)',
                  default: 5,
                  maximum: 100
                }
              },
              required: ['tableName']
            }
          }
        ]
      }
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      try {
        switch (name) {
          case 'execute_sql_query':
            return await this.handleExecuteSQL(args)

          case 'get_relevant_schema':
            return await this.handleGetRelevantSchema(args)

          case 'get_table_sample_data':
            return await this.handleGetSampleData(args)

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
        }
      } catch (error) {
        logger.error(`MCP Tool ${name} error:`, error)
        if (error instanceof McpError) throw error
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error.message}`)
      }
    })
  }

  async handleExecuteSQL (args) {
    const { sql, page = 1, pageSize = 50, dryRun = false } = args

    // Validate SQL is read-only
    const trimmedSQL = sql.trim().toLowerCase()
    if (!trimmedSQL.startsWith('select') && !trimmedSQL.startsWith('with')) {
      throw new McpError(ErrorCode.InvalidRequest, 'Only SELECT queries are allowed')
    }

    const result = await queryExecutionService.executeQuery(sql, {
      page: parseInt(page),
      pageSize: Math.min(parseInt(pageSize), 1000),
      useCache: true,
      dryRun
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: sql,
            result,
            executedAt: new Date().toISOString()
          }, null, 2)
        }
      ]
    }
  }

  async handleGetRelevantSchema (args) {
    const { query, maxTables = 10 } = args

    const schema = await schemaService.getRelevantSchema(query, maxTables)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            relevantSchema: schema,
            retrievedAt: new Date().toISOString()
          }, null, 2)
        }
      ]
    }
  }

  async handleGetSampleData (args) {
    const { tableName, limit = 5 } = args

    const sampleLimit = Math.min(parseInt(limit), 100)
    const sql = `SELECT * FROM ${tableName} LIMIT ${sampleLimit}`

    const result = await queryExecutionService.executeQuery(sql, {
      page: 1,
      pageSize: sampleLimit,
      useCache: true
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            tableName,
            sampleData: result,
            retrievedAt: new Date().toISOString()
          }, null, 2)
        }
      ]
    }
  }

  async start () {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    logger.info('MCP Database Server started on stdio transport')
  }
}

module.exports = DatabaseMCPServer

// If this file is run directly, start the MCP server
if (require.main === module) {
  const server = new DatabaseMCPServer()
  server.start().catch(error => {
    logger.error('Failed to start MCP server:', error)
    process.exit(1)
  })
}
