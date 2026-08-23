function normalizePhone(phone) {
  if (phone === null || phone === undefined) return "";
  return String(phone).replace(/[^0-9]/g, "").replace(/^0+/, "");
}

module.exports = { normalizePhone };
