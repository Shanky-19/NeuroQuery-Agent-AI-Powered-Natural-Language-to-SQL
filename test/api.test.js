const request = require('supertest');
const app = require('../src/server');

describe('Natural Language to SQL API', () => {
  
  describe('Health Check', () => {
    test('GET /health should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/);
      
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');
    });
  });

  describe('Schema Endpoints', () => {
    test('GET /api/v1/schema should return database schema', async () => {
      const response = await request(app)
        .get('/api/v1/schema')
        .expect(200)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('tables');
      expect(response.body.data).toHaveProperty('relationships');
      expect(response.body.data).toHaveProperty('metadata');
    });

    test('GET /api/v1/schema with relevant filter should return filtered schema', async () => {
      const response = await request(app)
        .get('/api/v1/schema?relevant=true&query=users&maxTables=5')
        .expect(200)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data.filtered).toBe(true);
      expect(response.body.data.tables.length).toBeLessThanOrEqual(5);
    });
  });

  describe('SQL Generation', () => {
    test('POST /api/v1/generate-sql should generate SQL from natural language', async () => {
      const response = await request(app)
        .post('/api/v1/generate-sql')
        .send({
          query: 'Show me all users who have placed orders',
          useRelevantSchema: true,
          maxTables: 10
        })
        .expect(200)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('sql');
      expect(response.body.data).toHaveProperty('reasoning');
      expect(response.body.data).toHaveProperty('confidence');
      expect(response.body.data.sql.toLowerCase()).toContain('select');
    });

    test('POST /api/v1/generate-sql should reject empty query', async () => {
      const response = await request(app)
        .post('/api/v1/generate-sql')
        .send({})
        .expect(400)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Query is required');
    });
  });

  describe('SQL Execution', () => {
    test('POST /api/v1/execute-sql should execute valid SELECT query', async () => {
      const response = await request(app)
        .post('/api/v1/execute-sql')
        .send({
          sql: 'SELECT id, email, first_name, last_name FROM users LIMIT 5',
          page: 1,
          pageSize: 5
        })
        .expect(200)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('rows');
      expect(response.body.data).toHaveProperty('pagination');
      expect(response.body.data).toHaveProperty('metadata');
    });

    test('POST /api/v1/execute-sql should reject non-SELECT queries', async () => {
      const response = await request(app)
        .post('/api/v1/execute-sql')
        .send({
          sql: 'DELETE FROM users WHERE id = 1'
        })
        .expect(400)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('SELECT statements are allowed');
    });

    test('POST /api/v1/execute-sql with dryRun should return execution plan', async () => {
      const response = await request(app)
        .post('/api/v1/execute-sql')
        .send({
          sql: 'SELECT * FROM users WHERE email = \'test@example.com\'',
          dryRun: true
        })
        .expect(200)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('explainPlan');
      expect(response.body.data).toHaveProperty('isValid');
    });
  });

  describe('Complete Query Workflow', () => {
    test('POST /api/v1/query should handle complete NL to SQL workflow', async () => {
      const response = await request(app)
        .post('/api/v1/query')
        .send({
          query: 'How many users do we have?',
          page: 1,
          pageSize: 10,
          dryRun: true // Use dry run for testing
        })
        .expect(200)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('originalQuery');
      expect(response.body.data).toHaveProperty('generatedSQL');
      expect(response.body.data).toHaveProperty('reasoning');
      expect(response.body.data).toHaveProperty('result');
      expect(response.body.data).toHaveProperty('schemaInfo');
    });
  });

  describe('Statistics', () => {
    test('GET /api/v1/stats should return system statistics', async () => {
      const response = await request(app)
        .get('/api/v1/stats')
        .expect(200)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('schema');
      expect(response.body.data).toHaveProperty('execution');
      expect(response.body.data).toHaveProperty('system');
    });
  });

  describe('Cache Management', () => {
    test('POST /api/v1/cache/invalidate should invalidate cache', async () => {
      const response = await request(app)
        .post('/api/v1/cache/invalidate')
        .send({ type: 'schema' })
        .expect(200)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Cache invalidated');
    });
  });

  describe('Error Handling', () => {
    test('Should return 404 for unknown endpoints', async () => {
      const response = await request(app)
        .get('/api/v1/unknown-endpoint')
        .expect(404)
        .expect('Content-Type', /json/);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Endpoint not found');
    });
  });
});