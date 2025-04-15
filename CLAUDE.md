# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- Build: `npm run build` (TypeScript compilation)
- Run: `npm run server:dev` (Run with tsx directly)
- The server receives commands via stdio

## Code Style Guidelines
- TypeScript with strict mode enabled
- ES modules (import/export syntax)
- Target: ES2022, Node16 module resolution
- Consistent casing in filenames required

## Structure
- Source code in `src/` directory
- Built files output to `build/` directory

## Dependencies
- Primary: `@modelcontextprotocol/sdk` for MCP server implementation
- Validation: `zod` for schema validation
- No testing framework currently configured

## Restate API Integration
- Service management is done via Restate Admin API (default: http://localhost:9070)
- API schemas defined following the OpenAPI spec in resources/openapi-admin.json
- All API requests include `User-Agent: restate-mcp-server/0.0.1`

## Formatting & Naming
- Prefer camelCase for variables and functions
- PascalCase for classes and types
- Use descriptive names for variables and functions
- Add type annotations for function parameters and return values