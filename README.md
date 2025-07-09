# OpenAI Deep Research MCP Server

A TypeScript MCP (Model Context Protocol) server that provides access to OpenAI's Deep Research API.

## Features

- **openai_deep_research_create**: Create new research requests
- **openai_deep_research_check_status**: Check the status of research requests  
- **openai_deep_research_get_results**: Retrieve completed research results with citations

## Quick Start

```bash
npx github:fbettag/openai-deep-research-mcp
```

## Quick Setup with Claude CLI

```bash
claude mcp add openai-deep-research -s user npx github:fbettag/openai-deep-research-mcp -e OPENAI_API_KEY=sk-your-openai-api-key-here
```

Replace `sk-your-openai-api-key-here` with your actual OpenAI API key.

## Claude Desktop Setup (Manual)

Add to your Claude Desktop configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "openai-deep-research": {
      "command": "npx",
      "args": ["github:fbettag/openai-deep-research-mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-your-openai-api-key-here"
      }
    }
  }
}
```

## Available Functions

### Create Research Request
```typescript
openai_deep_research_create({
  query: "Your research question",
  system_message?: "Optional guidance",
  model?: "o3-deep-research-2025-06-26",
  include_code_interpreter?: false
})
```

### Check Status
```typescript
openai_deep_research_check_status({
  request_id: "req_123..."
})
```

### Get Results
```typescript
openai_deep_research_get_results({
  request_id: "req_123..."
})
```

## Models

- `o3-deep-research-2025-06-26`: Full research model (5-30 min)
- `o4-mini-deep-research-2025-06-26`: Faster, lightweight model

## Requirements

- Node.js >= 18.0.0
- OpenAI API key with Deep Research access

## Development

```bash
npm install
npm run dev
```

## License

MIT