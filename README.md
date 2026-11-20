# Fieldkit Equipment Rental API

REST API for the Fieldkit equipment-rental marketplace. It supports the
frontend in `equipment-rental-frontend` and provides MongoDB-backed equipment,
customer accounts, owner listings, bookings, Stripe Checkout payments, and
administrative tools.

## Getting started

Requirements: Node.js 20+ and MongoDB.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Set the values in `.env` before starting the server. `MONGODB_URI` and a
32-character `JWT_SECRET` are required. Set `MONGODB_DB=fieldkit` to isolate
Fieldkit data from other projects on the same cluster; without a database name
in either setting, MongoDB's default database may be selected. The API listens
on port 5000 by default. Set `CLIENT_URL` to the frontend origin; multiple
origins can be comma-separated.

For the Admin, configure both `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least six
characters). On startup the server creates or promotes that exact account and
syncs its password, so the credentials can be used on the normal
`/api/auth/login` route immediately. Public registration and Google sign-in
always create customer accounts. A unique partial MongoDB index enforces one
Admin; the startup migration demotes any extra Admin roles. Keep the
credentials private. The legacy `/api/auth/admin/setup` endpoints remain for
compatibility but are no longer needed.

When the `equipment` collection is empty, startup seeds twelve approved demo
listings from a verified demo owner so the public catalog, featured section,
admin analytics, and owner tools have meaningful data immediately. Seeding is
idempotent: existing catalog data is never overwritten. A daily job also marks
paid rentals as completed after their end date passes.

Google sign-in requires `GOOGLE_CLIENT_ID`. Set the same OAuth client ID as
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the frontend. This uses Google Identity
Services ID-token verification; authorize the frontend JavaScript origin
(`http://localhost:3000`) in Google Cloud. No redirect URI is used.

Stripe Checkout requires `STRIPE_SECRET_KEY`. Card payments are verified
server-side when the signed-in renter returns to the success page, so a local
webhook listener and `STRIPE_WEBHOOK_SECRET` are not required for basic testing.
Webhooks are recommended for production so payments are recorded even if the
renter does not return to the site. For local webhook testing, run
`stripe listen --forward-to localhost:5000/api/payments/webhook`, then set
`STRIPE_WEBHOOK_SECRET` to the signing secret printed by the CLI. Configure
`STRIPE_CURRENCY` for a currency supported by the Stripe account.

## Scripts

- `npm run dev` — start with Node's watch mode
- `npm start` — start the production server
- `npm test` — run unit tests

## API

All JSON responses use `{ "message": "..." }` for errors. Protected routes use
`Authorization: Bearer <JWT>`. Equipment and booking IDs are MongoDB ObjectIds.

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/` | Public | API service status and health-check path |
| GET | `/api/health` | Public | Health check including MongoDB connectivity |
| GET | `/api/config` | Public | Public currency and enabled sign-in/payment features |
| POST | `/api/auth/register` | Public | Register a customer |
| POST | `/api/auth/login` | Public | Email/password login |
| POST | `/api/auth/google` | Public | Verify a Google ID token; new accounts are customers |
| GET | `/api/auth/admin/setup-status` | Public | Check whether first-admin setup is available |
| POST | `/api/auth/admin/setup` | Public, rate-limited | Create the one configured Admin account |
| GET | `/api/auth/me` | Signed in | Current user |
| GET | `/api/equipment` | Public | Search, filter, sort, paginate approved listings |
| GET | `/api/equipment/featured` | Public | Six latest approved listings |
| GET | `/api/equipment/categories` | Public | Approved categories with listing counts |
| GET | `/api/equipment/:id` | Public | Approved listing details and owner |
| POST | `/api/equipment` | Owner | Create a pending listing |
| GET | `/api/equipment/owner/mine` | Owner | Owner's listings |
| PATCH/DELETE | `/api/equipment/:id` | Owner/Admin | Update or delete a listing |
| GET/POST/DELETE | `/api/favorites[/:equipmentId]` | Customer | List, add, or remove favorites |
| GET/PATCH | `/api/profile` | Signed in | View or update profile |
| POST | `/api/bookings/quote` | Public | Authoritative rental total for the selected dates and quantity |
| POST | `/api/bookings` | Customer | Create booking and Stripe Checkout session |
| GET | `/api/bookings/mine` | Customer | Customer's bookings |
| GET | `/api/bookings/checkout/:sessionId` | Customer | Payment status for the signed-in renter's checkout |
| POST | `/api/bookings/:id/cancel-checkout` | Customer | Expire checkout and release its reservation |
| GET | `/api/bookings/owner` | Owner | Rentals for owner's listings |
| GET | `/api/bookings/admin` | Admin | All bookings |
| PATCH | `/api/bookings/:id/status` | Owner/Admin | Manage a paid booking |
| POST | `/api/payments/webhook` | Stripe | Verify payment events and record transactions |
| GET | `/api/payments/mine` | Customer | Customer's payment transactions |
| GET | `/api/payments/admin` | Admin | All payment transactions |
| GET | `/api/admin/users` | Admin | Paginated user management |
| PATCH | `/api/admin/users/:id/role` | Admin | Assign customer or owner role; Admin is provisioned from environment |
| PATCH | `/api/admin/users/:id/status` | Admin | Enable or disable a user |
| GET | `/api/admin/equipment` | Admin | Review all listings |
| PATCH | `/api/admin/equipment/:id/status` | Admin | Approve or reject a listing |
| GET | `/api/analytics/admin` | Admin | Platform metrics and monthly bookings/revenue |
| GET | `/api/analytics/owner` | Owner | Listing, rental, and monthly earning metrics |

### Equipment search parameters

`GET /api/equipment` accepts `search` (or `q`), `category`, `rentalType`
(`Daily`, `Weekly`, or `Monthly`), `minPrice`, `maxPrice`, `available`
(`true`/`false`), `sort` (`recent`, `price-low`, `price-high`), `page`, and
`limit`. Search matches listing name, category, and location. The response
includes `items`, `total`, `page`, `limit`, and `pages`.

### Booking request

```json
{
  "equipmentId": "MongoDB ObjectId",
  "rentalStartDate": "2026-12-01",
  "rentalEndDate": "2026-12-03",
  "quantity": 1,
  "contactNumber": "+880...",
  "deliveryAddress": "Dhaka",
  "notes": ""
}
```

The backend calculates the total from the approved listing's current price,
checks overlapping reservations, creates a pending booking, and returns a
`checkoutUrl`. Payment is confirmed on the signed-in renter's return through
`GET /api/bookings/checkout/:sessionId`, which retrieves the Stripe session
server-side, and may also be confirmed by a verified Stripe webhook. Both paths
update the booking payment status and the `payments` collection idempotently.

## Frontend integration

Set the frontend API base URL to the deployed server origin, for example
`http://localhost:5000/api`, and send the returned JWT as a Bearer token for
protected requests. Public listing objects include `id`, `name`, `category`,
`location`, `price`, `rentalType`, `image`, `availableQuantity`, and `status`.

## Packages

Express, MongoDB Node.js driver, bcryptjs, jsonwebtoken, Google Auth Library,
Stripe, Helmet, CORS, express-rate-limit, and dotenv.
