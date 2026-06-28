#!/usr/bin/env node

/**
 * Swagger UI Server for 6MD Management Platform API
 * Serves the OpenAPI specification at http://localhost:3001
 */

import express from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Load OpenAPI specification
const specPath = resolve(__dirname, '../openapi.yaml');
const spec = YAML.parse(readFileSync(specPath, 'utf8'));

// Configure Swagger UI
app.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: '6MD Management Platform API',
  })
);

// Serve the OpenAPI YAML file directly
app.get('/openapi.yaml', (req, res) => {
  res.type('text/yaml').sendFile(specPath);
});

app.listen(PORT, () => {
  console.log(`\n  Swagger UI running at: http://localhost:${PORT}`);
  console.log(`  OpenAPI spec available at: http://localhost:${PORT}/openapi.yaml`);
  console.log('  Press Ctrl+C to stop the server\n');
});
