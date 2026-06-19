function normalizeCurrencyCode(value) {
  const raw = String(value || "").trim();
  const upper = raw.toUpperCase();

  const aliases = {
    AED: "AED",
    "د.إ": "AED",
    "درهم": "AED",
    "درهم إماراتي": "AED",
    "درهم اماراتي": "AED",

    EGP: "EGP",
    EGY: "EGP",
    "جنيه": "EGP",
    "جنيه مصري": "EGP",
    "ج.م": "EGP",

    SAR: "SAR",
    "ريال": "SAR",
    "ريال سعودي": "SAR",

    USD: "USD",
    "دولار": "USD",
    "دولار أمريكي": "USD",
    "دولار امريكي": "USD",

    EUR: "EUR",
    "يورو": "EUR",

    KWD: "KWD",
    "دينار كويتي": "KWD",

    QAR: "QAR",
    "ريال قطري": "QAR",

    BHD: "BHD",
    "دينار بحريني": "BHD",

    OMR: "OMR",
    "ريال عماني": "OMR"
  };

  return aliases[upper] || aliases[raw] || "AED";
}

module.exports = { normalizeCurrencyCode };
