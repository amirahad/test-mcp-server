// import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'; // ✅ use stdio
// import { z } from 'zod';
// import axios from 'axios';

// // Step 1: Create the MCP server
// const server = new McpServer({
//   name: 'My Server',
//   version: '1.0.0',
// });

// // Step 2: Define tools
// server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => {
//   return { content: [{ type: 'text', text: String(a + b) }] };
// });

// server.tool('weather', { city: z.string() }, async ({ city }) => {
//   const res = await axios.get(`https://wttr.in/${city}?format=%C+%t`, {
//     responseType: 'text',
//     timeout: 5000,
//   });
//   return { content: [{ type: 'text', text: res.data }] };
// });

// // Step 3: Setup transport for Smithery
// const transport = new StdioServerTransport(); // ✅ updated transport

// // Step 4: Connect and run
// await server.connect(transport);




import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import axios from 'axios';
import express from 'express';

// Detect environment - if PORT is set or explicitly remote, use HTTP mode
const IS_REMOTE = process.env.PORT || process.env.MCP_MODE === 'remote' || process.argv.includes('--remote');
const PORT = process.env.PORT || 3000;

// Logging helper that works for both environments
const log = (message, ...args) => {
  const timestamp = new Date().toISOString();
  if (IS_REMOTE) {
    console.log(`[${timestamp}] ${message}`, ...args);
  } else {
    console.error(`[${timestamp}] ${message}`, ...args); // Use stderr for stdio mode
  }
};

// Create the MCP server
const server = new McpServer({
  name: IS_REMOTE ? 'Remote MCP Server' : 'Cursor MCP Server',
  version: '1.0.0',
});

// Tool handlers storage (needed for HTTP mode)
const toolHandlers = new Map();

// Define tool schemas
const addTool = {
  name: 'add',
  description: 'Add two numbers together',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number', description: 'First number' },
      b: { type: 'number', description: 'Second number' }
    },
    required: ['a', 'b']
  }
};

const weatherTool = {
  name: 'weather',
  description: 'Get current weather for a city',
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' }
    },
    required: ['city']
  }
};

// Tool implementations
const addHandler = async ({ a, b }) => {
  log(`Executing add: ${a} + ${b}`);
  return { content: [{ type: 'text', text: String(a + b) }] };
};

const weatherHandler = async ({ city }) => {
  log(`Fetching weather for: ${city}`);

  try {
    const res = await axios.get(`https://wttr.in/${city}?format=%C+%t`, {
      responseType: 'text',
      timeout: 5000,
    });

    log(`Weather API response for ${city}: ${res.data}`);
    return { content: [{ type: 'text', text: res.data }] };
  } catch (error) {
    log(`Weather API error for ${city}:`, {
      message: error.message,
      code: error.code,
      status: error.response?.status
    });

    return {
      content: [{
        type: 'text',
        text: `Unable to fetch weather for ${city}. Please try again later.`
      }]
    };
  }
};

// Register tools with the MCP server
server.tool('add', { a: z.number(), b: z.number() }, addHandler);
server.tool('weather', { city: z.string() }, weatherHandler);

// Store tool definitions for HTTP mode
toolHandlers.set('add', { tool: addTool, handler: addHandler });
toolHandlers.set('weather', { tool: weatherTool, handler: weatherHandler });

// STDIO MODE (for Cursor)
async function startStdioMode() {
  log('Starting MCP server in STDIO mode for Cursor...');

  const transport = new StdioServerTransport();

  try {
    await server.connect(transport);
    log('MCP server connected via STDIO and ready for Cursor!');
  } catch (error) {
    log('Failed to start STDIO MCP server:', error);
    process.exit(1);
  }
}

// HTTP MODE (for remote deployment)
async function startHttpMode() {
  log(`Starting MCP server in HTTP mode on port ${PORT}...`);

  const app = express();

  // Middleware
  app.use(express.json());
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      mode: 'remote',
      server: 'Universal MCP Server',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      tools: Array.from(toolHandlers.keys())
    });
  });

  // Server-Sent Events endpoint
  app.get('/sse', (req, res) => {
    log(`New SSE connection from ${req.ip}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const transport = new SSEServerTransport('/sse', res);

    server.connect(transport).then(() => {
      log('MCP server connected via SSE');
    }).catch(error => {
      log('MCP server SSE connection error:', error);
    });

    const keepAlive = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() })}\n\n`);
    }, 30000);

    req.on('close', () => {
      log('SSE connection closed');
      clearInterval(keepAlive);
    });

    req.on('error', (error) => {
      log('SSE connection error:', error);
      clearInterval(keepAlive);
    });
  });

  // HTTP MCP endpoint
  app.post('/mcp', async (req, res) => {
    log('MCP HTTP request:', req.body);

    try {
      const { method, params, id } = req.body;

      if (method === 'tools/list') {
        const tools = Array.from(toolHandlers.entries()).map(([name, { tool }]) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));

        log('Returning tools:', tools);

        res.json({
          jsonrpc: '2.0',
          id,
          result: { tools }
        });

      } else if (method === 'tools/call' && params?.name) {
        const { name, arguments: args } = params;

        log(`Calling tool ${name} with args:`, args);

        const toolData = toolHandlers.get(name);
        if (!toolData) {
          throw new Error(`Unknown tool: ${name}`);
        }

        const result = await toolData.handler(args);
        console.log("🚀 ~ app.post ~ result:", result)

        log(`Tool ${name} result:`, result);

        const resultText = result?.content
          ?.map(item => item.text)
          ?.join(" ");

        log(`Tool ${name} result text:`, resultText);
        if (!resultText) {
          throw new Error(`Tool ${name} returned no text content`);
        }

        res.json({
          jsonrpc: '2.0',
          id,
          result: resultText
        });

      } else if (method === 'initialize') {
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'Universal MCP Server',
              version: '1.0.0'
            }
          }
        });

      } else {
        log(`Unknown method: ${method}`);
        res.status(400).json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        });
      }

    } catch (error) {
      log('MCP HTTP error:', error);
      res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: {
          code: -32603,
          message: error.message
        }
      });
    }
  });

  // Test endpoint
  app.get('/test-tools', async (req, res) => {
    try {
      const testResults = {};

      for (const [name, { handler }] of toolHandlers) {
        try {
          let testArgs;
          if (name === 'add') {
            testArgs = { a: 5, b: 3 };
          } else if (name === 'weather') {
            testArgs = { city: 'London' };
          }

          const result = await handler(testArgs);
          testResults[name] = { success: true, result };
        } catch (error) {
          testResults[name] = { success: false, error: error.message };
        }
      }

      res.json({
        mode: 'remote',
        timestamp: new Date().toISOString(),
        tools: Array.from(toolHandlers.keys()),
        testResults
      });
    } catch (error) {
      res.status(500).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Start HTTP server
  app.listen(PORT, '0.0.0.0', () => {
    log(`🚀 Universal MCP Server running in HTTP mode on port ${PORT}`);
    log(`📡 SSE endpoint: http://localhost:${PORT}/sse`);
    log(`🏥 Health check: http://localhost:${PORT}/health`);
    log(`📬 MCP HTTP endpoint: http://localhost:${PORT}/mcp`);
    log(`🧪 Test tools: http://localhost:${PORT}/test-tools`);
    log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    log('');
    log('✅ Server ready for remote MCP connections!');
    log('');
    log('Available tools:');
    toolHandlers.forEach((toolData, name) => {
      log(`  - ${name}: ${toolData.tool.description}`);
    });
  });
}

// Main startup logic
async function main() {
  log(`🚀 Starting Universal MCP Server...`);
  log(`📊 Mode: ${IS_REMOTE ? 'REMOTE (HTTP)' : 'LOCAL (STDIO)'}`);
  log(`🛠️  Available tools: ${Array.from(toolHandlers.keys()).join(', ')}`);
  log('');

  if (IS_REMOTE) {
    await startHttpMode();
  } else {
    await startStdioMode();
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  log('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  log('Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
main().catch((error) => {
  log('Unhandled startup error:', error);
  process.exit(1);
});