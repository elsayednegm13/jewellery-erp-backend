const storageService = require("../services/storage.service");
const { ValidationError } = require("../utils/errors");

class UploadController {
  upload = async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw new ValidationError("لم يتم اختيار أي ملف لرفعه.");
      }

      const uploadResult = await storageService.uploadFile(file);

      return res.status(201).json({
        success: true,
        data: uploadResult
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new UploadController();
