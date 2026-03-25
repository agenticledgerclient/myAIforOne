# Railway Docs

Fetch up-to-date Railway documentation to answer questions accurately.

## When to Use

- User asks how something works on Railway (projects, deployments, volumes, etc.)
- User shares a docs.railway.com URL
- User needs current info about Railway features or pricing
- Before answering Railway questions from memory - check the docs first

## LLM-Optimized Sources

Start here for comprehensive, up-to-date info:

| Source | URL |
|--------|-----|
| **Full docs** | `https://docs.railway.com/api/llms-docs.md` |
| **llms.txt index** | `https://railway.com/llms.txt` |
| **Templates** | `https://railway.com/llms-templates.md` |
| **Changelog** | `https://railway.com/llms-changelog.md` |
| **Blog** | `https://blog.railway.com/llms-blog.md` |

## Fetching Specific Pages

Append `.md` to any docs.railway.com URL:

```
https://docs.railway.com/guides/projects -> https://docs.railway.com/guides/projects.md
```

## Common Doc Paths

| Topic | URL |
|-------|-----|
| Projects | `https://docs.railway.com/guides/projects.md` |
| Deployments | `https://docs.railway.com/guides/deployments.md` |
| Volumes | `https://docs.railway.com/guides/volumes.md` |
| Variables | `https://docs.railway.com/guides/variables.md` |
| CLI | `https://docs.railway.com/reference/cli-api.md` |
| Pricing | `https://docs.railway.com/reference/pricing.md` |

## How to Use

When a user asks about Railway features:

1. **Fetch the relevant doc** using WebFetch tool with the appropriate URL
2. **Extract the relevant information** from the documentation
3. **Provide an accurate answer** based on current documentation

## Example Usage

User asks: "How do volumes work on Railway?"

1. Fetch `https://docs.railway.com/guides/volumes.md`
2. Read the content about volume creation, mounting, and limitations
3. Provide accurate, up-to-date information

## Tips

- Always prefer docs over memory for Railway-specific information
- The LLM-optimized endpoints (`llms-docs.md`, etc.) are specifically formatted for AI consumption
- Check the changelog for recent feature updates
- Use the blog for detailed feature announcements and tutorials
