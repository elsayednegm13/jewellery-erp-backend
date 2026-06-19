const goldService = require("../services/gold.service");

class GoldController {
  getLivePrice = async (req, res, next) => {
    try {
      const livePrice = await goldService.getLivePrice();
      return res.status(200).json(livePrice);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new GoldController();
