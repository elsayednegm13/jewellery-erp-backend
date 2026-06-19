const express = require("express");
const goldController = require("../controllers/gold.controller");

const router = express.Router();

router.get("/live", goldController.getLivePrice);

module.exports = router;
