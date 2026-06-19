const fs = require("fs");
const path = require("path");

function moveUploadedFileSafe(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error.code === "EXDEV") {
      fs.copyFileSync(sourcePath, targetPath);
      fs.unlinkSync(sourcePath);
      return;
    }

    throw error;
  }
}

module.exports = {
  moveUploadedFileSafe
};
