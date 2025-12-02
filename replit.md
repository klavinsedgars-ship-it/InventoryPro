# replit.md

## Overview

This project is a minimalistic web-based CRM application for inventory and marketplace management. It is specifically designed to integrate with the TME supplier API and manage listings on eBay and Amazon. The application functions as a full-stack web application, utilizing React for the frontend, Express.js for the backend, and PostgreSQL as the database. Its core purpose is to streamline product management, automate marketplace listings, and synchronize product data with a primary supplier, offering a comprehensive solution for e-commerce businesses.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **UI Library**: Shadcn/ui components (Radix UI primitives)
- **Styling**: Tailwind CSS with custom design system
- **State Management**: TanStack React Query
- **Routing**: Wouter
- **Form Handling**: React Hook Form with Zod validation

### Backend Architecture
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js for REST API
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Database Provider**: Neon Database (serverless PostgreSQL)
- **Session Management**: Express sessions with PostgreSQL storage
- **API Design**: RESTful endpoints with consistent error handling

### Database Design
- **Primary Database**: PostgreSQL (Replit Database)
- **Schema Management**: Drizzle Kit for migrations
- **Tables**: Users, Products, Categories, Marketplace Settings, Sync Logs
- **Authentication**: Session-based with bcrypt password hashing
- **Storage Layer**: DatabaseStorage class for data persistence

### Core Features
- **Authentication System**: Session-based with role-based access control. Development mode supports BYPASS_AUTH=true for testing.
- **Product Management**: CRUD operations, advanced filtering, bulk actions, SKU/EAN tracking.
- **Marketplace Integration Framework**: Structured for eBay and Amazon APIs, including listing status, bulk listing/unlisting, and category mapping.
- **TME Supplier Integration**: API integration for automated and manual product data synchronization (name, SKU, price, stock, images), with sync logging. Includes dynamic pricing integration, category browsing, and bulk sync capabilities. All credentials loaded from environment variables with fail-fast validation.
- **Dashboard & Analytics**: Real-time metrics, quick actions, recent product overview.
- **Dynamic Pricing System**: 7-tier margin-based pricing engine with bulk operations.
- **Enterprise Queue System**: Priority-based queue management for large product volumes, with rate-limiting, exponential backoff retry logic, and detailed monitoring metrics.
- **Unified Professional eBay Template System**: Consistent 9-section template for all eBay listings.
- **eBay Stock Limitation System**: Manages eBay listing quantities based on account limits.
- **Automatic TME to eBay Category Mapping**: Intelligent mapping system for correct eBay categorization across 180+ categories.
- **PostgreSQL-Backed TME Product Cache**: Replaces in-memory Map with 24-hour TTL database cache for 150k+ product scalability.
- **Daily Sync Engine**: Automatic 2 AM daily synchronization comparing local SKUs vs TME live data with diff-based updates. Includes manual trigger endpoints: POST /api/sync/trigger-daily for full sync, POST /api/sync/trigger-ebay for eBay-only sync. Scheduler starts automatically with server.
- **eBay Bulk Inventory Updates**: ReviseInventoryStatus API integration processing 4 items per call with automatic batching and rate limiting. Integrated into daily sync flow for automatic eBay inventory updates after TME changes are detected.
- **MOQ (Minimum Order Quantity) System**: Handles products sold in multiples from TME. Stores `moq` and `multiples` fields per product. Key behaviors:
  - TME sync extracts MinAmount/Multiples from API response
  - Database stores per-unit prices; eBay listings multiply by MOQ for package pricing
  - TME Browser shows purple MOQ badges (e.g., "Min: 10 pcs")
  - Products page shows MOQ column with quantity badges (e.g., "10x")
  - eBay templates prefix titles with quantity (e.g., "10x Resistor 1K...") and include pack notice in descriptions
  - Package pricing: Unit Sale Price × MOQ = eBay Listing Price
- **eBay Business Policies Management**: Full CRUD for eBay business policies via Account API (OAuth 2.0). Three policy types:
  - Payment Policies: Payment methods, immediate pay settings
  - Fulfillment (Shipping) Policies: Handling time, shipping options, global shipping
  - Return Policies: Return period, refund method, shipping cost payer
  - Sync from eBay: POST /api/ebay/business-policies/sync
  - Check OAuth status: GET /api/ebay/business-policies/status
  - Frontend: /ebay-policies page with tabs for each policy type
  - **OAuth Environment Variables** (separate from Trading API):
    - `EBAY_OAUTH_CLIENT_ID`: eBay App Client ID from Developer Portal
    - `EBAY_OAUTH_CLIENT_SECRET`: eBay App Client Secret from Developer Portal
    - `EBAY_OAUTH_REFRESH_TOKEN`: OAuth Refresh Token with `sell.account` scope
  - The system automatically refreshes access tokens and caches them for efficiency
  - Frontend displays OAuth configuration status and disables sync when not configured

## External Dependencies

- **@neondatabase/serverless**: Serverless PostgreSQL database connection.
- **drizzle-orm**: Type-safe database ORM.
- **@tanstack/react-query**: Server state management.
- **@radix-ui/***: Accessible UI component primitives.
- **react-hook-form**: Form state management and validation.
- **zod**: Runtime type validation and schema definition.
- **TME API**: Electronics component supplier integration.
- **eBay API**: Marketplace listing and management.
- **Amazon SP-API**: Marketplace listing and management (planned integration).