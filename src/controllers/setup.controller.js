const models = require("../models");
const { publicStatus, resolveSetupState } = require("../services/first-run-setup-state.service");
const { bootstrapFirstRun } = require("../services/first-run-bootstrap.service");

class SetupController {
  status = async (req, res, next) => {
    try {
      const resolved = await resolveSetupState(models);
      res.set("Cache-Control", "no-store");
      return res.status(200).json({ success: true, data: publicStatus(resolved.state) });
    } catch (error) {
      next(error);
    }
  };

  bootstrap = async (req, res, next) => {
    try {
      const result = await bootstrapFirstRun({
        models,
        body: req.body || {},
        token: req.get("X-First-Run-Setup-Token"),
        idempotencyKey: req.get("Idempotency-Key")
      });
      res.set("Cache-Control", "no-store");
      return res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new SetupController();
