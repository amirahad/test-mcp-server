import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from 'zod';
import axios from 'axios';

// Step 1: Create the MCP server
const server = new McpServer({
  name: 'My Server',
  version: '1.0.0',
});

// Step 2: Define tools
server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => {
  return { content: [{ type: 'text', text: String(a + b) }] };
});

server.tool('weather', { city: z.string() }, async ({ city }) => {
  const res = await axios.get(`https://wttr.in/${city}?format=%C+%t`, {
    responseType: 'text',
    timeout: 5000,
  });
  return { content: [{ type: 'text', text: res.data }] };
});

// Step 3: Setup transport for Smithery
const transport = new StreamableHTTPServerTransport({
  path: '/mcp',
  cors: true,
});

// Step 4: Connect and serve
await server.connect(transport);
console.log('✅ MCP Server running (Smithery-compatible)');
