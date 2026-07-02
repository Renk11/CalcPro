# Beget Deployment Notes

## Vercel vs Beget

Vercel and Beget run this project in different ways.

- Vercel uses [vercel.json](./vercel.json):
  - static frontend is built into `dist`
  - each file in `api/*.js` runs as a separate serverless function
  - routing to `/api/*` is handled by Vercel itself
- Beget should run one Node.js process:
  - build command: `npm run build`
  - start command: `npm start`
  - entrypoint: [server/index.js](./server/index.js)
  - the Node server itself serves `dist` and handles `/api/*`

Because of that, `vercel.json` is useful on Vercel, but Beget does not use it directly.

## What Must Be Configured On Beget

Set these variables in the Beget Node.js app settings or in the server `.env` file:

```env
PUBLIC_APP_URL=https://app.example.com
CALCPRO_APP_HOSTS=app.example.com,www.app.example.com
VK_APP_SECRET=replace_with_vk_app_secret
VK_GROUP_TOKEN=replace_with_vk_group_token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace_with_supabase_service_role_key
YOOKASSA_SHOP_ID=replace_with_shop_id
YOOKASSA_SECRET_KEY=replace_with_secret_key
VK_CALLBACK_CONFIRMATION_TOKEN=replace_with_vk_callback_confirmation_token
```

Notes:

- `PUBLIC_APP_URL` is used for YooKassa `return_url`.
- `CALCPRO_APP_HOSTS` is used by the Node server to understand which hosts should open the app entry (`index.html`) instead of the marketing landing (`landing.html`).
- `PORT` should usually be left to Beget if the platform injects it automatically.
- Use only one VK app secret source with the same value: `VK_APP_SECRET` or `VK_MINI_APP_SECRET` or `VK_CLIENT_SECRET`.
- A ready-to-fill template is available in [beget.env.example](./beget.env.example).

## Ready Mapping From Current Vercel Setup

Copy the same server-side values you already use on Vercel for these keys:

- `VK_APP_SECRET`
- `VK_GROUP_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`
- `VK_CALLBACK_CONFIRMATION_TOKEN`
- `CALCPRO_CONNECT_RECIPIENT_ID`

Change these values for Beget:

- `PUBLIC_APP_URL`
  - set it to the final Beget HTTPS app URL
- `CALCPRO_APP_HOSTS`
  - set it to the same Beget hostname
  - if you use aliases, list them with commas

Example:

```env
PUBLIC_APP_URL=https://app.your-domain.ru
CALCPRO_APP_HOSTS=app.your-domain.ru,www.app.your-domain.ru
```

## Important Difference Fixed In Code

Previously the Node server treated only `app.calcpro.su` as the application host.

That works for one specific domain, but it can break the Beget deployment if:

- Beget serves the app from another domain
- you use a temporary Beget domain during setup
- you add `www` or another alias

Now [server/index.js](./server/index.js) supports:

- `CALCPRO_APP_HOSTS`
- host auto-detection from `PUBLIC_APP_URL`

So Beget can serve the correct app page without hardcoding a single production hostname.

## Beget Checklist

1. Upload the project.
2. Run `npm install`.
3. Run `npm run build`.
4. Configure the Node.js app start command as `npm start`.
5. Set the environment variables listed above.
6. Restart the Node.js app after every env change.
7. Open the VK Mini App from the VK community, not from a raw direct URL.

## If Something Still Fails

Check these symptoms first:

- `invalid_signature`
  - wrong VK app secret on Beget
  - app process was not restarted after env changes
- app opens landing instead of admin/app screen
  - wrong `PUBLIC_APP_URL`
  - missing or wrong `CALCPRO_APP_HOSTS`
- YooKassa returns to the wrong domain
  - wrong `PUBLIC_APP_URL`
- API errors for templates/requests/support
  - missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`
