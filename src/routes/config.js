const { Router } = require("express");
const config = require("../config");

const router = Router();

router.get("/", (_request, response) => {
  response.json({
    currency: config.stripeCurrency,
    googleSignInEnabled: Boolean(config.googleClientId),
    paymentsEnabled: Boolean(config.stripeSecretKey),
  });
});

module.exports = router;
