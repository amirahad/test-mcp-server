import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'; // ✅ use stdio
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
const transport = new StdioServerTransport(); // ✅ updated transport

// Step 4: Connect and run
await server.connect(transport);
