# Dares and Truths — minimal personal site

Minimal white background, black text site. Content is loaded from your Notion database (or page).

## Setup

1. **Share the Notion page with your integration**
   - In Notion, open the page/database you use as content.
   - Click `...` (top right) → **Connections** → **Connect to** → select the integration that owns `NOTION_TOKEN`.
   - Without this, the API will return "object not found".

2. **Run the site**
   ```bash
   npm install
   npm start
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Test Notion connection

```bash
node test-connection.js
```

## Env

- **Local:** `.env` must include `NOTION_TOKEN=...` (from your Notion integration).
- **Vercel:** Add the same variable in the dashboard: Project → **Settings** → **Environment Variables** → add `NOTION_TOKEN` with your integration token → **Redeploy**.
