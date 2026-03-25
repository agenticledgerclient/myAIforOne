# /opAgentHubAddFeatureLicense - Add a Feature to AgentHub Licensing

Add a new license feature flag to the AgentHub licensing system. This updates both the Admin App (where licenses are generated) and AgentHub (where licenses are enforced).

## Prerequisites

- Feature name decided (camelCase, e.g. `widgetEmbed`, `analytics`, `customDomain`)
- Know if it's a top-level feature or sub-feature (requires a parent)
- Know if it needs backend route gating, frontend tab gating, or both

## Steps

### 1. Admin App — Schema (`AgentHub_Administration/lib/db/schema.ts`)

Add the new flag to the `LicenseFeatures` interface in the appropriate section:

```typescript
// Top-level access
widgetEmbed: boolean;    // ← add here for top-level
// OR in sub-features section
mySubFeature: boolean;   // ← add here if it depends on a parent
```

### 2. Admin App — Constants (`AgentHub_Administration/lib/license-constants.ts`)

Add to THREE places:

**BLANK_FEATURES** (all false):
```typescript
myFeature: false,
```

**FULL_FEATURES** (all true):
```typescript
myFeature: true,
```

**FEATURE_SECTIONS** (UI metadata):
```typescript
// For top-level features, add to the 'top-level' section:
{ key: 'myFeature', label: 'My Feature', description: 'What this feature does' },

// For sub-features, add to the section with matching parentKey:
// Or create a new section:
{
  id: 'my-section',
  label: 'My Feature — Sub-features',
  parentKey: 'myFeature',
  features: [
    { key: 'mySubFeature', label: 'Sub Feature', description: '...' },
  ],
},
```

### 3. AgentHub — License Service (`server/src/license/licenseService.ts`)

**Add to `LicenseFeatures` interface** (mirrors Admin App):
```typescript
myFeature: boolean;
```

**Add backward compat default** in `initializeLicense()` (so existing JWTs without this flag still work):
```typescript
if (decoded.features && decoded.features.myFeature === undefined) {
  decoded.features.myFeature = true;
}
```

**If sub-feature, add to `DEPENDENCY_RULES`:**
```typescript
mySubFeature: 'myFeature',  // sub-feature requires parent
```

### 4. AgentHub — Backend Route Gating (if needed)

**In `server/src/http/app.ts`** or **`server/src/http/adminRoutes.ts`**:
```typescript
// On a router mount:
app.use('/api/myFeature', requireFeature('myFeature'), myRouter);

// Or on individual routes:
router.get('/endpoint', requireFeature('myFeature'), handler);
```

### 5. AgentHub — Frontend Tab/UI Gating (`web/src/AdminPage.tsx`)

**Add to `LicenseFeatures` interface:**
```typescript
myFeature: boolean;
```

**Add to `activeTab` union type** (if adding a new tab):
```typescript
const [activeTab, setActiveTab] = useState<'settings' | 'mcp' | ... | 'myTab'>('settings');
```

**Add tab entry:**
```typescript
{ key: 'myTab', label: 'My Feature', show: lf?.myFeature ?? true },
```

**Add render condition:**
```typescript
{agent && activeTab === 'myTab' && renderMyFeature()}
```

**For sub-feature gating within existing tabs:**
```typescript
{(lf?.mySubFeature ?? true) && (
  <div>Sub-feature content</div>
)}
```

### 6. TypeScript Check

```bash
cd server && npx tsc --noEmit
cd web && npx tsc --noEmit
```

### 7. Commit & Push Both Repos

```bash
# Admin App
cd AgentHub_Administration
git add lib/db/schema.ts lib/license-constants.ts
git commit -m "Add myFeature license feature flag"
git push origin main_dev
git checkout main && git merge main_dev --no-edit && git push origin main && git checkout main_dev

# AgentHub
cd AgentHub
git add server/src/license/licenseService.ts web/src/AdminPage.tsx [other files]
git commit -m "Add myFeature with license gating"
git push origin main_dev
git checkout main && git merge main_dev --no-edit && git push origin main && git checkout main_dev
```

## Key File Paths

| File | Repo | What to edit |
|------|------|-------------|
| `lib/db/schema.ts` | Admin App | `LicenseFeatures` interface |
| `lib/license-constants.ts` | Admin App | `BLANK_FEATURES`, `FULL_FEATURES`, `FEATURE_SECTIONS` |
| `server/src/license/licenseService.ts` | AgentHub | `LicenseFeatures` interface, backward compat, `DEPENDENCY_RULES` |
| `server/src/middleware/licenseGuard.ts` | AgentHub | `requireFeature()` — already exists, just use it |
| `server/src/http/app.ts` | AgentHub | Route-level `requireFeature('flag')` |
| `server/src/http/adminRoutes.ts` | AgentHub | Route-level gating for admin endpoints |
| `web/src/AdminPage.tsx` | AgentHub | `LicenseFeatures` interface, tab config, render functions |

## Project Locations

| Project | Path |
|---------|------|
| Admin App | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub_Administration` |
| AgentHub | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub` |

## Important Notes

- **Backward compat:** Always default new flags to `true` in `initializeLicense()` so existing JWTs (without the new field) keep working
- **Existing licenses:** Customers with existing licenses won't have the new flag. It defaults to `true` until they regenerate their license
- **Admin App auto-deploys:** Both `main_dev` and `main` auto-deploy via Railway
- **The `[key: string]: boolean | number` index signature** on the frontend `LicenseFeatures` allows dynamic flags, but explicit properties are preferred for type safety
- **Feature count:** Currently 40 features (39 booleans + 1 numeric `maxAgents`). Each new feature increments this.
