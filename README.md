# Gun-ob PWD Registry

The project has a Next.js frontend and an Express API. PostgreSQL data is stored in Neon; the backend creates the required tables on startup.

## Tech stack

- **Frontend:** Next.js 15 and React 19
- **Backend:** Node.js 20+ and Express 5
- **Database:** PostgreSQL hosted on Neon, accessed with `@neondatabase/serverless`
- **Language and modules:** JavaScript with ES modules
- **Authentication:** Admin credentials from environment variables and signed, HttpOnly session cookies
- **Configuration:** Environment variables loaded with `dotenv`

## Configure Neon and admin access

In `backend`, copy `.env.example` to `.env` and set:

- `DATABASE_URL`: the connection string from your Neon project. Use the pooled connection string for serverless workloads.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD`: the admin login credentials.
- `SESSION_SECRET`: a long random secret used to sign the HttpOnly session cookie.

Keep `.env` private. It is excluded from Git. For a separately hosted frontend and backend, set `NEXT_PUBLIC_API_URL` in the frontend build environment to the backend's base URL (for example, `https://api.example.com`) and set the backend's `FRONTEND_URL` to the frontend origin to allow credentialed browser requests. If `NEXT_PUBLIC_API_URL` is unset, the frontend defaults to `http://localhost:4000`.

## Run the applications

Start the backend in one terminal:

```powershell
cd backend
npm install
npm run dev
```

Start the frontend in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Next.js, usually http://localhost:3000. If that port is busy, Next.js chooses another port; the default backend proxy target is `http://localhost:4000` and can be changed with `BACKEND_URL`.

## Access

Members land on the public payment-history lookup and verify with their registered name and date of birth. They can see their membership start date and paid membership/yearly records only.

Admins select **Admin login** in the upper-right corner. After successful login, they must confirm **Who is on Duty Today** before entering the admin workspace. Duty changes and registry activity are stored in Neon.

On the first admin login, existing browser-local member/activity data is offered to the backend importer and merged without replacing records already in Neon. After import, the browser copies are removed.