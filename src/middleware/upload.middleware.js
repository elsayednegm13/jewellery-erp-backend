const multer = require("multer");
const os = require("os");
const path = require("path");

// Use OS temporary folder for incoming uploads before storage driver processing
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB file limit
  },
  fileFilter: (req, file, cb) => {
    // Basic type validation
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("نوع الملف غير مدعوم. المسموح به: صور، PDF، Excel، CSV، Word."));
    }
  }
});

module.exports = upload;
