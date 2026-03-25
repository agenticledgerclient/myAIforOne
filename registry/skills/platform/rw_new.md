# New Project / Service / Database

Create Railway projects, services, and databases with proper configuration.

## When to Use

- User says "deploy to railway" (add service if linked, init if not)
- User says "create a railway project", "init", "new project" (explicit new project)
- User says "link to railway", "connect to railway"
- User says "create a service", "add a backend", "new api service"
- User says "create a vite app", "create a react website", "make a python api"
- User says "deploy from github.com/user/repo", "create service from this repo"
- User says "add postgres", "add a database", "add redis", "add mysql", "add mongo"
- User says "connect to postgres", "wire up the database", "connect my api to redis"
- User says "add postgres and connect to the server"
- Setting up code + Railway service together

## Prerequisites

Check CLI installed:
```bash
command -v railway
```

If not installed:
> Install Railway CLI:
> ```
> npm install -g @railway/cli
> ```
> or
> ```
> brew install railway
> ```

Check authenticated:
```bash
railway whoami --json
```

If not authenticated:
> Run `railway login` to authenticate.

## Decision Flow

```
railway status --json (in current dir)
         |
    +----+----+
  Linked    Not Linked
    |           |
    |      Check parent: cd .. && railway status --json
    |           |
    |      +----+----+
    |    Parent    Not linked
    |    Linked    anywhere
    |      |           |
    |   Add service  railway list
    |   Set rootDir       |
    |   Deploy       +----+----+
    |              Match?   No match
    |                |         |
    |                |         |
    |              Link     Init new
    +-------+-------+----------+
            |
    User wants service?
            |
       +----+----+
      Yes       No
       |         |
  Scaffold code  Done
       |
  railway add --service
       |
  Configure if needed
       |
  Ready to deploy
```

## Check Current State

```bash
railway status --json
```

- **If linked**: Add a service to the existing project (see below)
- **If not linked**: Check if a PARENT directory is linked (see below)

### When Already Linked

**Default behavior**: "deploy to railway" = add a service to the linked project.

Do NOT create a new project unless user EXPLICITLY says:
- "new project", "create a project", "init a project"
- "separate project", "different project"

App names like "flappy-bird" or "my-api" are SERVICE names, not project names.

```
User: "create a vite app called foo and deploy to railway"
Project: Already linked to "my-project"

WRONG: railway init -n foo
RIGHT: railway add --service foo
```

### Parent Directory Linking

Railway CLI walks up the directory tree to find a linked project. If you're in a subdirectory:

```bash
cd .. && railway status --json
```

**If parent is linked**, you don't need to init/link the subdirectory. Instead:
1. Create service: `railway add --service <name>`
2. Set `rootDirectory` to subdirectory path via rw_environment skill
3. Deploy from root: `railway up`

**If no parent is linked**, proceed with init or link flow.

## Init vs Link Decision

**Skip this section if already linked** - just add a service instead.

Only use this section when NO project is linked (directly or via parent).

### Check User's Projects

The output can be large. Run in a subagent and extract only:
- Project `id` and `name`
- Workspace `id` and `name`

```bash
railway list --json
```

### Decision Logic

1. **User explicitly says "new project"** - Use `railway init`
2. **User names an existing project** - Use `railway link`
3. **Directory name matches existing project** - Ask: link existing or create new?
4. **No matching projects** - Use `railway init`
5. **Ambiguous** - Ask user

## Create New Project

```bash
railway init -n <name>
```

Options:
- `-n, --name` - Project name (auto-generated if omitted in non-interactive mode)
- `-w, --workspace` - Workspace name or ID (required if multiple workspaces exist)

### Multiple Workspaces

If the user has multiple workspaces, `railway init` requires the `--workspace` flag.

Get workspace IDs from:
```bash
railway whoami --json
```

The `workspaces` array contains `{ id, name }` for each workspace.

**Inferring workspace from user input:**

If user says "deploy into xxx workspace" or "create project in my-team", match the name against the workspaces array and use the corresponding ID:

```bash
# User says: "create a project in my personal workspace"
railway whoami --json | jq '.workspaces[] | select(.name | test("personal"; "i"))'
# Use the matched ID:
railway init -n myapp --workspace <matched-id>
```

## Link Existing Project

```bash
railway link -p <project>
```

Options:
- `-p, --project` - Project name or ID
- `-e, --environment` - Environment (default: production)
- `-s, --service` - Service to link
- `-t, --team` - Team/workspace

## Create Service

After project is linked, create a service:

```bash
railway add --service <name>
```

**For GitHub repo sources**: Create an empty service, then invoke the `rw_environment` skill to configure the source via staged changes API. Do NOT use `railway add --repo` - it requires GitHub app integration which often fails.

Flow:
1. `railway add --service my-api`
2. Invoke `rw_environment` skill to set `source.repo` and `source.branch`
3. Apply changes to trigger deployment

### Configure Based on Project Type

**Static site (Vite, CRA, Astro static):**
- Railpack auto-detects common output dirs (dist, build)
- If non-standard output dir: invoke `rw_environment` skill to set `RAILPACK_STATIC_FILE_ROOT`
- Do NOT use `railway variables` CLI - always use the rw_environment skill

**Node.js SSR (Next.js, Nuxt, Express):**
- Verify `start` script exists in package.json
- If custom start needed: invoke `rw_environment` skill to set `startCommand`

**Python (FastAPI, Django, Flask):**
- Verify `requirements.txt` or `pyproject.toml` exists
- Auto-detected by Railpack, usually no config needed

**Go:**
- Verify `go.mod` exists
- Auto-detected, no config needed

### Monorepo Configuration

**Critical decision:** Root directory vs custom commands.

**Isolated monorepo** (apps don't share code):
- Set Root Directory to the app's subdirectory (e.g., `/frontend`)
- Only that directory's code is available during build

**Shared monorepo** (TypeScript workspaces, shared packages):
- Do NOT set root directory
- Set custom build/start commands to filter the package:
  - pnpm: `pnpm --filter <package> build`
  - npm: `npm run build --workspace=packages/<package>`
  - yarn: `yarn workspace <package> build`
  - Turborepo: `turbo run build --filter=<package>`
- Set watch paths to prevent unnecessary rebuilds

## Databases

For adding databases (Postgres, Redis, MySQL, MongoDB), use the `rw_database` skill.

The `rw_database` skill handles:
- Creating database services
- Connection variable references
- Wiring services to databases

## Composability

- **After service created**: Use `rw_deploy` skill to push code
- **For advanced config**: Use `rw_environment` skill (buildCommand, startCommand)
- **For domains**: Use `rw_domain` skill
- **For status checks**: Use `rw_status` skill
- **For service operations** (rename, delete, status): Use `rw_service` skill

## Error Handling

### CLI Not Installed
```
Railway CLI not installed. Install with: npm install -g @railway/cli or brew install railway
```

### Not Authenticated
```
Not logged in to Railway. Run: railway login
```

### No Workspaces
```
No workspaces found. Create one at railway.com or verify authentication.
```

### Project Name Taken
```
Project name already exists. Either:
- Link to existing: railway link -p <name>
- Use different name: railway init -n <other-name>
```

### Service Name Taken
```
Service name already exists in this project. Use a different name: railway add --service <other-name>
```

## Examples

### Create HTML Static Site
```
User: "create a simple html site and deploy to railway"

1. Check status - not linked
2. railway init -n my-site
3. Guide: create index.html
4. railway add --service my-site
5. No config needed (index.html in root auto-detected)
6. Use rw_deploy skill: railway up
7. Use rw_domain skill for public URL
```

### Create Vite React Service
```
User: "create a vite react service"

1. Check status - linked (or init/link first)
2. Scaffold: npm create vite@latest frontend -- --template react
3. railway add --service frontend
4. No config needed (Vite dist output auto-detected)
5. Use rw_deploy skill: railway up
```

### Add Python API to Project
```
User: "add a python api to my project"

1. Check status - linked
2. Guide: create main.py with FastAPI, requirements.txt
3. railway add --service api
4. No config needed (FastAPI auto-detected)
5. Use rw_deploy skill
```

### Link and Add Service
```
User: "connect to my backend project and add a worker service"

1. railway list --json - find "backend"
2. railway link -p backend
3. railway add --service worker
4. Guide setup based on worker type
```

### Deploy to Railway (Ambiguous)
```
User: "deploy to railway"

1. railway status - not linked
2. railway list - has projects
3. Directory is "my-app", found project "my-app"
4. Ask: "Found existing project 'my-app'. Link to it or create new?"
5. User: "link"
6. railway link -p my-app
7. Ask: "Create a service for this code?"
```
