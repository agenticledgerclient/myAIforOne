---
description: Create or update the product overview document with all domains, features, and architecture
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Bash(git:*)
argument-hint: [project-path]
---

# Product Overview Generator

You are tasked with creating or updating a comprehensive **Platform Overview** document for the project.

## Target File
- Look for an existing overview document (e.g., `00-PLATFORM-OVERVIEW.md`, `PLATFORM-OVERVIEW.md`, `PRODUCT-OVERVIEW.md`) in:
  - `platform-definition/` folder
  - `docs/` folder
  - Project root
- If none exists, create `platform-definition/00-PLATFORM-OVERVIEW.md`

## Project Path
$ARGUMENTS

If no path provided, use the current working directory.

## Document Structure

The overview document MUST follow this structure:

```markdown
# Platform Overview: [Product Name]

**Document Version:** X.Y
**Last Updated:** [Current Date]
**Document Type:** Master Platform Definition

**Recent Updates:**
- [Bullet list of recent changes with dates]

---

## Table of Contents
1. [Functional Overview](#functional-overview)
2. [Technical Overview](#technical-overview)
3. [Domain Architecture](#domain-architecture)
4. [Cross-Domain Integration Map](#cross-domain-integration-map)

---

# FUNCTIONAL OVERVIEW
*Audience: Product Managers, Business Stakeholders, Executive Leadership*

## Platform Vision
[High-level description of what the platform does]

### Core Value Proposition
**For Businesses:** [Benefits]
**For End Users:** [Benefits]

## Platform Capabilities Summary
### 1. [Capability Name]
- Feature details
- Sub-features

[Continue for all major capabilities]

## User Personas & Workflows
### Persona 1: [Role]
**Goal:** [What they want to achieve]
**Typical Workflow:**
1. Step 1
2. Step 2
...

## Business Model & Monetization
[Revenue model, cost structure]

## Competitive Differentiation
[Unique strengths, market position]

---

# TECHNICAL OVERVIEW
*Audience: Technical Product Managers, Engineering Leads, Solution Architects*

## Technology Stack
### Frontend
- Framework, UI Library, Styling, State Management, etc.

### Backend
- Runtime, Framework, ORM, Database, Authentication, etc.

### External Integrations
- APIs, services, third-party tools

### Infrastructure
- Hosting, Database, File Storage, etc.

## System Architecture
### Directory Structure
[Monorepo or multi-repo structure]

### Architectural Principles
1. Principle 1 - Description
2. Principle 2 - Description

## Database Architecture
### Core Schema Organization
[Tables organized by domain]

### Key Design Patterns
[Soft deletes, composite keys, JSONB usage, etc.]

## API Architecture
### RESTful Conventions
### Authentication Flow
### Error Handling

## Security Architecture
[Multi-layered security, encryption, etc.]

## Performance Optimization Strategies
[Current optimizations, monitoring, scalability]

---

# DOMAIN ARCHITECTURE
*Comprehensive breakdown of platform domains and ownership*

## Domain 1: [Domain Name]
**Team Focus:** [What this domain handles]

### Module Groups
- **D1-MG1: [Module Group Name]** - Description
- **D1-MG2: [Module Group Name]** - Description

### Ownership Scope
- What this domain owns

### Key Interfaces
- **Provides to [Domain X]:** What it provides
- **Consumes from [Domain Y]:** What it consumes

[Continue for all domains]

---

# CROSS-DOMAIN INTEGRATION MAP

## Dependency Matrix
| Domain | Depends On | Provides To | Integration Type |
|--------|-----------|-------------|------------------|
| D1 | None | D2, D3 | Auth, context |
...

## Critical Data Flows
### Flow 1: [Flow Name]
1. Step 1
2. Step 2
...

## API Contract Standards
### Standard Headers
### Standard Response Format
### Standard Error Format

## Shared Data Models
[Common interfaces used across domains]

---

## Version History
| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | [Date] | Initial overview | [Author] |

---

## Next Steps
1. Item 1
2. Item 2
```

## Your Task

1. **Explore the codebase** thoroughly:
   - Identify all major features and capabilities
   - Map out the domain architecture
   - Understand the tech stack
   - Find existing documentation to reference

2. **If document exists**:
   - Read the current version
   - Increment the version number
   - Add recent changes to the "Recent Updates" section
   - Update any sections that have changed
   - Preserve existing content that's still accurate

3. **If document doesn't exist**:
   - Create a new comprehensive overview
   - Start at version 1.0

4. **Be comprehensive but concise**:
   - Include ALL domains/features
   - Use tables for structured data
   - Include code examples where helpful
   - Document integrations and dependencies

5. **Update version info**:
   - Increment version (e.g., 1.8 -> 1.9)
   - Update "Last Updated" date
   - Add summary of changes to "Recent Updates"

Start by exploring the project structure and existing documentation, then create or update the overview document.
