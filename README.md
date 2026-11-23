# Fieldkit Equipment Rental API

Backend REST API for the **Fieldkit Equipment Rental Marketplace**. Built with Node.js, Express, and MongoDB.

### Features
- User authentication (Email & Google)
- Customer, Owner, and Admin roles
- Equipment listing and management
- Search, filter, and favorites
- Equipment booking and availability checking
- Stripe Checkout payment integration
- Reviews and notifications
- Admin dashboard and analytics

### Tech Stack
- Node.js & Express.js
- MongoDB
- JWT & bcryptjs
- Stripe
- Google OAuth

### Getting Started

**Requirements:** Node.js 20+ and MongoDB.

```bash
npm install
```

Create a `.env` file using `.env.example` and configure:

```env
PORT=5000
MONGODB_URI=your_mongodb_uri
MONGODB_DB=fieldkit
JWT_SECRET=your_32_character_secret
CLIENT_URL=http://localhost:3000
```

Start the development server:

```bash
npm run dev
```

The API will run at `http://localhost:5000`.

### Available Scripts

```bash
npm run dev    # Development server
npm start      # Production server
npm test       # Run tests
```

### API Health Check

```http
GET /api/health
```

### Deployment

Deploy the backend to any Node.js hosting platform. Configure the required environment variables before deployment.

### Frontend

Connect this API with the **Fieldkit Equipment Rental Frontend** by setting the frontend API base URL to the backend URL.