# Natural Language to SQL API Documentation

## Overview

The Natural Language to SQL API allows users to query databases using natural language questions. The API translates these questions into safe, read-only SQL queries and returns paginated results with comprehensive history tracking.

## Base URL

```
http://localhost:3000/api/v1
```

## Authentication

Currently, the API does not require authentication. User identification is handled via the `X-User-ID` header or IP address fallback.

## Rate Limiting

- **Window**: 15 minutes
- **Max Requests**: 100 per IP address

## Core Endpoints

### Health Check

Check the health status of the API and its dependencies.

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2023-12-07T10:30:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

### Database Schema

Get database schema information with optional filtering.

```http
GET /api/v1/schema?relevant=true&query=users&maxTables=10
```

**Parameters:**
- `relevant` (boolean): Filter to relevant tables only
- `query` (string): Natural language query for relevance filtering
- `maxTables` (integer): Maximum number of tables to return (default: 10)

**Response:**
```json
{
  "success": true,
  "data": {
    "tables": [...],
    "relationships": [...],
    "metadata": {
      "tableCount": 8,
      "totalColumns": 45,
      "fetchedAt": "2023-12-07T10:30:00.000Z"
    }
  }
}
```

### Generate SQL

Convert natural language to SQL without execution.

```http
POST /api/v1/generate-sql
```

**Request Body:**
```json
{
  "query": "Show me the top 5 products by price",
  "useRelevantSchema": true,
  "maxTables": 10
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sql": "SELECT id, name, price FROM products ORDER BY price DESC LIMIT 5;",
    "reasoning": "This query selects the top 5 products ordered by price in descending order.",
    "assumptions": "Assuming you want the highest priced products.",
    "confidence": 90,
    "schemaUsed": {
      "tableCount": 3,
      "filtered": true
    }
  }
}
```

### Execute SQL

Execute a SQL query with pagination and caching.

```http
POST /api/v1/execute-sql
```

**Request Body:**
```json
{
  "sql": "SELECT * FROM users LIMIT 10",
  "page": 1,
  "pageSize": 50,
  "useCache": true,
  "dryRun": false
}
```

### Complete Query Workflow

Process natural language query end-to-end with automatic history saving.

```http
POST /api/v1/query
```

**Request Body:**
```json
{
  "query": "Show me the top 5 products by price",
  "page": 1,
  "pageSize": 50,
  "useCache": true,
  "dryRun": false,
  "useRelevantSchema": true,
  "maxTables": 10
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "originalQuery": "Show me the top 5 products by price",
    "generatedSQL": "SELECT id, name, price FROM products ORDER BY price DESC LIMIT 5;",
    "reasoning": "This query selects the top 5 products ordered by price in descending order.",
    "assumptions": "Assuming you want the highest priced products.",
    "confidence": 90,
    "result": {
      "rows": [...],
      "pagination": {...},
      "metadata": {...}
    },
    "schemaInfo": {
      "tableCount": 5,
      "filtered": true
    }
  }
}
```

## History Management

### Get User History

Retrieve user's query history with pagination and filtering.

```http
GET /api/v1/history?limit=20&offset=0&includeErrors=true&sortBy=timestamp&sortOrder=desc
```

**Headers:**
- `X-User-ID` (optional): User identifier

**Parameters:**
- `limit` (integer): Number of entries to return (default: 20)
- `offset` (integer): Pagination offset (default: 0)
- `includeErrors` (boolean): Include failed queries (default: true)
- `sortBy` (string): Sort field - timestamp, executionTime, confidence (default: timestamp)
- `sortOrder` (string): Sort order - asc, desc (default: desc)

**Response:**
```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "1701943800000_abc123def",
        "userId": "user123",
        "timestamp": "2023-12-07T10:30:00.000Z",
        "naturalLanguageQuery": "Show me all users",
        "generatedSQL": "SELECT * FROM users;",
        "reasoning": "Simple query to retrieve all user records",
        "confidence": 95,
        "executionTime": 45,
        "rowCount": 150,
        "totalRows": 150,
        "success": true,
        "schemaInfo": {...}
      }
    ],
    "total": 25,
    "hasMore": true,
    "pagination": {
      "limit": 20,
      "offset": 0,
      "total": 25
    }
  }
}
```

### Search History

Search through user's query history.

```http
GET /api/v1/history/search?q=users&limit=10
```

**Parameters:**
- `q` (string): Search term (required)
- `limit` (integer): Maximum results (default: 10)

### Get Specific History Entry

Retrieve a specific history entry by ID.

```http
GET /api/v1/history/{historyId}
```

### Delete History Entry

Delete a specific history entry.

```http
DELETE /api/v1/history/{historyId}
```

**Headers:**
- `X-User-ID` (optional): User identifier for ownership verification

### Clear All History

Clear all history for a user.

```http
DELETE /api/v1/history
```

### History Statistics

Get user's query statistics.

```http
GET /api/v1/history/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalQueries": 45,
    "successfulQueries": 42,
    "failedQueries": 3,
    "avgExecutionTime": 125,
    "mostRecentQuery": {...},
    "recentQueriesAnalyzed": 45
  }
}
```

## Cache Management

### Cache Statistics

Get cache performance metrics.

```http
GET /api/v1/cache/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "statistics": {
      "hits": 150,
      "misses": 45,
      "errors": 2,
      "totalRequests": 197,
      "hitRate": "76.14%",
      "errorRate": "1.02%"
    },
    "health": {
      "healthy": true,
      "connected": true,
      "timestamp": "2023-12-07T10:30:00.000Z"
    }
  }
}
```

### Cache Invalidation

Invalidate specific cache types or patterns.

```http
POST /api/v1/cache/invalidate
```

**Request Body:**
```json
{
  "type": "queries",  // Options: all, schema, queries, llm
  "pattern": "query:result:*"  // Optional: specific pattern
}
```

### Cache Warming

Preload frequently accessed data.

```http
POST /api/v1/cache/warm
```

## Analytics

### Popular Queries

Get analytics on popular queries.

```http
GET /api/v1/analytics/popular-queries?limit=10&timeframe=7d
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "query": "Show me all users",
      "count": 15,
      "lastUsed": "2023-12-07T10:30:00.000Z",
      "avgExecutionTime": 45
    }
  ]
}
```

### System Statistics

Get comprehensive system statistics.

```http
GET /api/v1/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "schema": {
      "totalTables": 12,
      "totalColumns": 156,
      "totalRelationships": 8,
      "lastFetched": "2023-12-07T10:00:00.000Z"
    },
    "execution": {
      "totalQueries": 0,
      "averageExecutionTime": 0,
      "cacheHitRate": 0,
      "errorRate": 0
    },
    "cache": {
      "healthy": true,
      "connected": true,
      "stats": {...}
    },
    "system": {
      "uptime": 3600,
      "memory": {...},
      "nodeVersion": "v18.17.0"
    }
  }
}
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found
- `429` - Rate Limited
- `500` - Internal Server Error

## Best Practices

1. **Use Relevant Schema**: Enable `useRelevantSchema` for better performance
2. **Implement Caching**: Use `useCache=true` for repeated queries
3. **Handle Pagination**: Process large result sets with appropriate page sizes
4. **Monitor Performance**: Use `/api/v1/stats` for system monitoring
5. **User Identification**: Send `X-User-ID` header for proper history tracking
6. **Handle Errors**: Implement proper error handling in your client applications

## Rate Limiting Headers

Responses include rate limiting information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1701943800
```