# replit.md

## Overview

This is a minimalistic web-based CRM application for inventory and marketplace management, specifically designed to integrate with TME supplier API and manage listings on eBay and Amazon. The application is built as a full-stack web application using React for the frontend and Express.js for the backend, with PostgreSQL as the database.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **UI Library**: Shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design system
- **State Management**: TanStack React Query for server state management
- **Routing**: Wouter for lightweight client-side routing
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
- **Schema Management**: Drizzle Kit for migrations and schema management
- **Tables**: Users, Products, Categories, Marketplace Settings, Sync Logs
- **Authentication**: Session-based with bcrypt password hashing
- **Storage Layer**: DatabaseStorage class replaces MemStorage for production data persistence

## Key Components

### Authentication System
- Session-based authentication with secure cookie storage
- Role-based access control (Admin/User permissions)
- Password encryption and secure login/logout flow

### Product Management
- Complete CRUD operations for inventory items
- Advanced filtering by category, status, stock levels, and marketplace presence
- Bulk operations for efficient management
- SKU and EAN tracking for product identification

### Marketplace Integration Framework
- Structured for eBay and Amazon API integration
- Product listing status tracking per marketplace
- Bulk listing and unlisting capabilities
- Category mapping between supplier and marketplaces

### TME Supplier Integration
- API integration framework for TME supplier
- Automated sync capabilities with manual trigger option
- Product data synchronization (name, SKU, price, stock, images)
- Sync logging for audit trails

### Dashboard & Analytics
- Real-time metrics display (total products, marketplace listings, revenue)
- Quick action buttons for common operations
- Recent products overview with inline editing capabilities

## Data Flow

1. **User Authentication**: Session-based login → Role verification → Access control
2. **Product Management**: Frontend forms → Validation → API endpoints → Database operations
3. **TME Sync**: Manual/Scheduled trigger → TME API call → Data processing → Database update
4. **Marketplace Listing**: Product selection → Marketplace API → Status update → Database sync
5. **Real-time Updates**: Database changes → React Query invalidation → UI refresh

## External Dependencies

### Core Technologies
- **@neondatabase/serverless**: Serverless PostgreSQL database connection
- **drizzle-orm**: Type-safe database ORM
- **@tanstack/react-query**: Server state management
- **@radix-ui/***: Accessible UI component primitives
- **react-hook-form**: Form state management and validation
- **zod**: Runtime type validation and schema definition

### Development Tools
- **@replit/vite-plugin-***: Replit-specific development enhancements
- **tsx**: TypeScript execution for development
- **esbuild**: Fast JavaScript bundler for production builds

### Planned Integrations
- **TME API**: Electronics component supplier integration
- **eBay API**: Marketplace listing and management
- **Amazon SP-API**: Marketplace listing and management

## Deployment Strategy

### Development Environment
- Replit-hosted development with hot module replacement
- Vite development server with Express.js backend
- Environment variable management for API keys and database connections

### Production Build
- Vite builds optimized React frontend to `dist/public`
- esbuild bundles Express.js backend to `dist/index.js`
- Single deployment artifact with both frontend and backend

### Database Management
- Drizzle migrations for schema changes
- Environment-based configuration for different deployment stages
- Connection pooling via Neon Database for scalability

## Changelog

```
Changelog:
- June 28, 2025. Initial setup
- June 28, 2025. Added comprehensive sample product data (8 electronics products)
- June 28, 2025. Created full Categories management page with CRUD operations
- June 28, 2025. Created full Marketplace management page with bulk listing capabilities
- June 28, 2025. Fixed header component imports and improved navigation functionality
- June 28, 2025. Implemented complete TME Sync page with progress tracking and history
- June 28, 2025. Created comprehensive Settings page with all marketplace integrations
- June 28, 2025. Added session management with Express sessions and MemoryStore
- June 28, 2025. Added sample sync logs and improved application data completeness
- June 28, 2025. Replaced MemStorage with PostgreSQL database using Drizzle ORM
- June 28, 2025. Successfully migrated to production-ready database with all tables created
- June 28, 2025. Fixed authentication with bcrypt password verification
- June 28, 2025. Implemented bulk operations for product management (bulk listing to marketplaces)
- June 28, 2025. Added realistic TME sync simulation with price/stock updates
- June 28, 2025. Created comprehensive Reports & Analytics page with interactive charts
- June 28, 2025. Added advanced analytics endpoints for inventory and sales data
- June 28, 2025. Completed all core CRM features with production-ready functionality
- June 28, 2025. Integrated real TME API credentials with proper authentication framework
- June 28, 2025. Investigated TME API authentication - API key requires activation/permissions
- June 28, 2025. Implemented comprehensive error handling for API connectivity issues
- June 28, 2025. Successfully integrated eBay API with real credentials and authentication
- June 28, 2025. Implemented eBay product listing and bulk listing functionality
- June 28, 2025. Added eBay marketplace management features to CRM interface
- June 28, 2025. Fixed Select component runtime errors in both marketplace and products pages
- June 28, 2025. Added eye icons with marketplace links for listed products
- June 28, 2025. Reset product database with single test product for eBay listing validation
```

## User Preferences

```
Preferred communication style: Simple, everyday language.
```