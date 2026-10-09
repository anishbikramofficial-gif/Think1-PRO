# Think1.0 Pro – public website

```
public/index.html   the website (chat, history, images, video)
api/chat.js         backend function – holds your API key, adds limits
vercel.json         function settings
```

## Deploy on Vercel (free plan works)

1. Get an API key at https://console.anthropic.com (API Keys → Create Key) and add some credit under Billing.
   **Set a monthly spend limit there.** Public AI apps are paid by you, per message.
2. Put this folder on GitHub (or skip this and use the CLI: `npx vercel` inside the folder).
3. On https://vercel.com: Add New → Project → import the repo. No build settings needed.
4. Project → Settings → Environment Variables → add:
   - `ANTHROPIC_API_KEY` = your key (required)
   - optional: `CHAT_PER_HOUR` (default 40), `GEN_PER_HOUR` (image/video, default 10)
   - optional: `ALLOWED_ORIGIN` = `https://yourdomain.com` (only your site may call the API)
   - optional: `MODEL` (default `claude-sonnet-5-5`; a cheaper/faster model lowers cost)
5. Deploy. Add your own domain under Settings → Domains.

Never put the API key in index.html – anyone could copy it.

## Before you launch
- Add a Privacy Policy and Terms page (chats are sent to an AI provider; history is stored in the visitor's browser).
- The rate limiter is per server instance and resets on restarts. For strict limits use Vercel Firewall rate limiting or Upstash Redis.
- Images and videos are AI-drawn vector art (SVG), not photos or MP4 files.
- Test with your own spending limit first, then watch the usage dashboard.
