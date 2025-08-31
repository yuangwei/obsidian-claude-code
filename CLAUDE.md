# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin called "Claude Code" that provides AI-powered writing assistance with semantic search capabilities. The plugin vectorizes the user's vault content and uses similarity matching to provide relevant context for AI-powered text rewriting.

## Development Commands

- **Development mode**: `npm run dev` - Starts esbuild in watch mode with inline sourcemaps
- **Build for production**: `npm run build` - Type checks with TypeScript and builds minified bundle
- **Version bump**: `npm run version` - Updates manifest.json and versions.json, then stages them for commit

## Architecture

### Core Components

**ClaudeCodePlugin** (`src/main.ts:26`) - Main plugin class that extends Obsidian's Plugin base class
- Manages plugin settings and vector storage
- Provides two main commands: "Vectorize Vault" and "Vibe Write Selection"
- Automatically vectorizes vault on first load

**VibeSettingTab** (`src/main.ts:158`) - Settings interface for configuring API endpoints and models
- Configures API base URL, API token, embedding model, and completion model
- Defaults to OpenAI API endpoints but supports custom endpoints

### Key Functionality

**Vectorization System**:
- `vectorizeVault()` (`src/main.ts:62`) - Processes all markdown files in vault and stores embeddings
- `getEmbedding()` (`src/main.ts:75`) - Makes API calls to get text embeddings
- Vectors are persisted in plugin data storage

**Semantic Writing Assistant**:
- `vibeWrite()` (`src/main.ts:128`) - Core feature that rewrites selected text
- Uses cosine similarity (`similarity()` at `src/main.ts:116`) to find most relevant vault content
- Provides top 3 most similar documents as context for AI rewriting

**Settings Management**:
- Settings stored in VibeSettings interface with API configuration
- Plugin data includes both settings and vector storage
- Supports custom API endpoints beyond OpenAI

### Build System

Uses esbuild with TypeScript for bundling:
- Entry point: `src/main.ts`
- Output: `dist/main.js`  
- Excludes Obsidian API and CodeMirror dependencies (provided by Obsidian)
- Development builds include inline sourcemaps and watch mode
- Production builds are minified without sourcemaps

### Plugin Manifest

Standard Obsidian plugin structure with manifest.json defining plugin metadata and minimum app version (0.15.0).