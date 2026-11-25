# Daraja Production Engine

Secure Express/Prisma backend and React admin dashboard for Safaricom Daraja M-Pesa integrations.

## Structure

- `backend/` — Node.js/Express API, OAuth token manager, STK routes and Prisma models
- `frontend/` — React admin control center

## Heroku deployment

The repository is configured to build and serve both the frontend and backend from one Heroku web dyno.

1. Create a GitHub repository and push this project.
2. Create a Heroku app and connect it to the GitHub repository.
3. Add Heroku PostgreSQL and Heroku Redis add-ons to the app.
4. Configure the following Heroku Config Vars:
   - `DARAJA_CONSUMER_KEY`
   - `DARAJA_CONSUMER_SECRET`
   - `DARAJA_SHORTCODE`
   - `DARAJA_PASSKEY`
   - `ADMIN_API_TOKEN`
   - `AUDITOR_API_TOKEN`
   - `DARAJA_ENVIRONMENT=sandbox` or `production`
   - `DARAJA_API_BASE_URL=https://api.safaricom.co.ke`
   - `DARAJA_CALLBACK_URL=https://YOUR-APP.herokuapp.com/api/v1/callback/stk`
   - Optional C2B and B2C callback URLs using the corresponding `/api/v1/callback/...` routes
   - Optional `DARAJA_CALLBACK_SECRET` for signed callbacks
5. Enable automatic deploys or deploy the `main` branch manually.
6. Open `https://YOUR-APP.herokuapp.com/health` to verify the service.

Heroku provides `DATABASE_URL` and normally `REDIS_URL` through the database and Redis add-ons. The release process automatically runs `prisma migrate deploy`.

Daraja must receive an HTTPS callback URL. Heroku's generated app URL qualifies. After an app is created, update `DARAJA_CALLBACK_URL` and re-register C2B URLs if those features are used.

## Local development

1. Copy `backend/.env.example` to `backend/.env`.
2. Configure PostgreSQL and Redis.
3. Run `npm install` at the repository root.
4. Run `npm run prisma:generate --workspace=backend`.
5. Run `npm run prisma:migrate --workspace=backend`.
6. Start the backend with `npm run dev --workspace=backend`.
7. Start the frontend with `npm run dev --workspace=frontend`.
