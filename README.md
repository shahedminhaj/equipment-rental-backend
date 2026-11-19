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
32-character `JWT_SECRET` are required. The API listens on port 5000 by default.
Set `CLIENT_URL` to the frontend origin; multiple origins can be comma-separated.

To provision an administrator on startup, configure both `ADMIN_EMAIL` and
`ADMIN_PASSWORD`. The configured email is assigned the admin role; keep these
credentials private and unset them after provisioning if the deployment does
not require automatic provisioning.

Google sign-in requires `GOOGLE_CLIENT_ID`. Stripe Checkout requires
`STRIPE_SECRET_KEY` and webhook signature verification requires
`STRIPE_WEBHOOK_SECRET`. Point the Stripe webhook at
`/api/payments/webhook` and subscribe to Checkout Session completed, expired,
async payment succeeded, and async payment failed events. Configure
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
| GET | `/api/health` | Public | Health check |
| POST | `/api/auth/register` | Public | Register a customer |
| POST | `/api/auth/login` | Public | Email/password login |
| POST | `/api/auth/google` | Public | Verify a Google ID token; new accounts are customers |
| GET | `/api/auth/me` | Signed in | Current user |
| GET | `/api/equipment` | Public | Search, filter, sort, paginate approved listings |
| GET | `/api/equipment/featured` | Public | Six latest approved listings |
| GET | `/api/equipment/:id` | Public | Approved listing details and owner |
| POST | `/api/equipment` | Owner | Create a pending listing |
| GET | `/api/equipment/owner/mine` | Owner | Owner's listings |
| PATCH/DELETE | `/api/equipment/:id` | Owner/Admin | Update or delete a listing |
| GET/POST/DELETE | `/api/favorites[/:equipmentId]` | Customer | List, add, or remove favorites |
| GET/PATCH | `/api/profile` | Signed in | View or update profile |
| POST | `/api/bookings` | Customer | Create booking and Stripe Checkout session |
| GET | `/api/bookings/mine` | Customer | Customer's bookings |
| GET | `/api/bookings/owner` | Owner | Rentals for owner's listings |
| GET | `/api/bookings/admin` | Admin | All bookings |
| PATCH | `/api/bookings/:id/status` | Owner/Admin | Manage a paid booking |
| POST | `/api/payments/webhook` | Stripe | Verify payment events and record transactions |
| GET | `/api/payments/mine` | Customer | Customer's payment transactions |
| GET | `/api/payments/admin` | Admin | All payment transactions |
| GET | `/api/admin/users` | Admin | Paginated user management |
| PATCH | `/api/admin/users/:id/role` | Admin | Assign customer, owner, or admin role |
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
`checkoutUrl`. The booking's payment status and the `payments` collection are
updated only after a verified Stripe webhook.

## Frontend integration

Set the frontend API base URL to the deployed server origin, for example
`http://localhost:5000/api`, and send the returned JWT as a Bearer token for
protected requests. Public listing objects include `id`, `name`, `category`,
`location`, `price`, `rentalType`, `image`, `availableQuantity`, and `status`.

## Packages

Express, MongoDB Node.js driver, bcryptjs, jsonwebtoken, Google Auth Library,
Stripe, Helmet, CORS, express-rate-limit, and dotenv.
