"use strict";

// 01D authority boundary.  The values below are only the literal, reusable
// controlled values that are present in the approved client documents or the
// already accepted barcode policy.  This module does not invent profile
// screens, free-text fallbacks, or operational defaults.
const profileMasterData = require("./profile-master-data.service");

const FINAL_PROFILE_CODES = Object.freeze([
  "GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K", "GOLD_BY_PIECE",
  "DIAMOND_JEWELLERY", "LOOSE_DIAMOND", "GEMSTONE_JEWELLERY",
  "LOOSE_GEMSTONE", "PEARL_JEWELLERY", "LOOSE_PEARL",
]);

const CLIENT_KARAT_CODES = Object.freeze(["24", "22", "21", "18", "14", "12", "10", "9"]);
const GOLD_ITEM_DESCRIPTIONS = Object.freeze([
  "Gold Anklet", "Gold Bangle", "Gold Bar", "Gold Bracelet", "Gold Brooch",
  "Gold Chain", "Gold Choker", "Gold Coin", "Gold Crown", "Gold Earrings",
  "Gold Full Set", "Gold Necklace", "Gold Pendant", "Gold Pendant Chain",
  "Gold Ring", "Gold Twins Ring", "Gold Wedding Band",
]);
const GOLD_COLORS = Object.freeze(["Yellow Gold", "White Gold", "Rose Gold"]);
const PEARL_TYPES = Object.freeze(["Abalone", "Akoya", "Conch", "Cortez", "Freshwater", "Keshi", "Mabe", "Melo", "South Sea", "Tahitian"]);
const CERTIFICATE_AUTHORITIES = Object.freeze([
  "AGS", "AIGS", "Bellerophon", "EGL", "GCAL", "GIA", "GIT", "GRS",
  "Gubelin", "HRD", "ICA", "IGI", "Lotus Gemology", "SSEF",
]);
const DIAMOND_TYPES = Object.freeze(["Natural Diamond", "Lab Grown Diamond", "Treated / Enhanced Diamond"]);
const DIAMOND_TREATMENTS = Object.freeze(["Clarity Enhanced", "Coated", "Color Enhanced", "Composite Diamond", "Fracture Filled", "HPHT", "Irradiated", "Laser Drilled", "Other"]);
const DIAMOND_COLORS = Object.freeze(["D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "Champagne", "Cognac", "Fancy Black", "Fancy Blue", "Fancy Pink", "Fancy Red", "Fancy Yellow"]);
const DIAMOND_CLARITIES = Object.freeze(["FL", "IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "I1", "I2", "I3"]);
const DIAMOND_CUTS = Object.freeze(["Excellent", "Fair", "Good", "Poor", "Very Good"]);
const DIAMOND_SHAPES = Object.freeze(["Asscher", "Baguette", "Briolette", "Bullet", "Cabochon", "Crescent", "Cushion", "Emerald Cut", "Freeform", "Half Moon", "Heart", "Hexagon", "Kite", "Lozenge", "Marquise", "Octagon", "Oval", "Pear", "Pentagon", "Princess", "Radiant", "Round", "Shield", "Square", "Tapered Baguette", "Tapered Trapezoid", "Trapezoid", "Triangle", "Trillion"]);
const GEMSTONE_NAMES = Object.freeze(["Agate", "Alexandrite", "Amazonite", "Amber", "Amethyst", "Andalusite", "Apatite", "Aquamarine", "Aventurine", "Benitoite", "Black Opal", "Bloodstone", "Boulder Opal", "Carnelian", "Charoite", "Chrome Diopside", "Chrysoberyl", "Chrysoprase", "Citrine", "Coral", "Diopside", "Emerald", "Ethiopian Opal", "Fire Opal", "Fluorite", "Rock Crystal", "Rose Quartz", "Ruby", "Sapphire", "Seraphinite", "Smoky Quartz", "Spinel", "Sphene", "Sunstone", "Tanzanite", "Tsavorite", "Tiger Eye", "Topaz", "Tourmaline", "Turquoise", "Zircon", "Zoisite"]);
const GEMSTONE_TYPES = Object.freeze(["Composite", "Imitation", "Lab Grown", "Natural", "Reconstructed", "Synthetic"]);
const GEMSTONE_SHAPES = Object.freeze(["Asscher", "Baguette", "Briolette", "Cabochon", "Marquise", "Octagon", "Oval", "Pear", "Princess", "Radiant", "Round", "Square", "Triangle", "Trillion"]);
const GEMSTONE_COLORS = Object.freeze(["Bi Color", "Black", "Blue", "Blue Green", "Brown", "Burgundy", "Canary Yellow", "Champagne", "Chocolate Brown", "Cognac", "Colorless", "Cornflower Blue", "Cream", "Emerald Green", "Golden Yellow", "Gray", "Green", "Greenish Blue", "Honey", "Hot Pink", "Ivory", "Lavender", "Lilac", "Mint Green", "Multicolor", "Olive Green", "Orange", "Purplish Red", "Red", "Rose Pink", "Royal Blue", "Salmon", "Silver", "Sky Blue", "Teal", "Tri Color", "Violet", "White", "Yellow", "Yellow Green"]);
const GEMSTONE_TONES = Object.freeze(["Bright", "Cool", "Deep", "Earthy", "Iridescent", "Metallic", "Neon", "Neutral", "Other", "Pastel", "Rich", "Smoky", "Soft", "Warm"]);
const GEMSTONE_TONE_LEVELS = Object.freeze(["Light", "Medium", "Medium Dark", "Medium Light", "Very Dark", "Very Light"]);
const GEMSTONE_SATURATIONS = Object.freeze(["Grayish", "Brownish", "Faint", "Weak", "Moderate", "Moderately Strong", "Strong", "Very Strong", "Vivid", "Exceptional Vivid"]);
const GEMSTONE_OPTICAL_EFFECTS = Object.freeze(["None", "Adularescence", "Asterism", "Chatoyancy", "Iridescence", "Labradorescence", "Orient", "Play Of Color", "Other"]);
const GEMSTONE_ORIGINS = Object.freeze(["Afghanistan", "Australia", "Brazil", "Burma", "Cambodia", "China", "Colombia", "Ethiopia", "India", "Kenya", "Madagascar", "Mozambique", "Myanmar", "Nepal", "Nigeria", "Pakistan", "Russia", "Sri Lanka", "Tanzania", "Thailand", "USA", "Vietnam", "Zambia", "Zimbabwe", "Other Approved Values"]);

const PROFILE_CATEGORIES = Object.freeze(Object.fromEntries(
  FINAL_PROFILE_CODES.map((profile) => [profile, Object.freeze(profileMasterData.categoriesForProfile(profile))]),
));

// A deliberately small initial dataset.  It is sufficient to prove the
// authority and lifecycle paths without pretending that every client value
// has an owner-approved production label yet.
const INITIAL_DATASET = Object.freeze([
  { category: profileMasterData.CATEGORIES.GOLD_ITEM_DESCRIPTION, values: GOLD_ITEM_DESCRIPTIONS, source: "Gold By Weight.docx / Gold By Piece.docx" },
  { category: profileMasterData.CATEGORIES.GOLD_COLOR, values: GOLD_COLORS, source: "Gold By Weight.docx / Gold By Piece.docx" },
  { category: profileMasterData.CATEGORIES.PEARL_TYPE, values: PEARL_TYPES, source: "Pearl.docx" },
  { category: profileMasterData.CATEGORIES.CERTIFICATE_AUTHORITY, values: CERTIFICATE_AUTHORITIES, source: "Pearl.docx / Diamond (Jewellery  Loose Stone).docx / Gem Stone (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.DIAMOND_TYPE, values: DIAMOND_TYPES, source: "Diamond (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.DIAMOND_TREATMENT, values: DIAMOND_TREATMENTS, source: "Diamond (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.DIAMOND_COLOR, values: DIAMOND_COLORS, source: "Diamond (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.DIAMOND_CLARITY, values: DIAMOND_CLARITIES, source: "Diamond (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.DIAMOND_CUT, values: DIAMOND_CUTS, source: "Diamond (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.DIAMOND_SHAPE, values: DIAMOND_SHAPES, source: "Diamond (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.GEMSTONE_NAME, values: GEMSTONE_NAMES, source: "Gem Stone (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.GEMSTONE_TYPE, values: GEMSTONE_TYPES, source: "Gem Stone (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.GEMSTONE_SHAPE, values: GEMSTONE_SHAPES, source: "Gem Stone (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.GEMSTONE_COLOR, values: GEMSTONE_COLORS, source: "Gem Stone (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.GEMSTONE_TONE, values: GEMSTONE_TONES, source: "Gem Stone (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.GEMSTONE_TONE_LEVEL, values: GEMSTONE_TONE_LEVELS, source: "Gem Stone (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.GEMSTONE_SATURATION, values: GEMSTONE_SATURATIONS, source: "Gem Stone (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.GEMSTONE_OPTICAL_EFFECT, values: GEMSTONE_OPTICAL_EFFECTS, source: "Gem Stone (Jewellery  Loose Stone).docx" },
  { category: profileMasterData.CATEGORIES.GEMSTONE_ORIGIN, values: GEMSTONE_ORIGINS, source: "Gem Stone (Jewellery  Loose Stone).docx" },
]);

function isFinalProfile(profile) {
  return FINAL_PROFILE_CODES.includes(String(profile || "").trim().toUpperCase());
}

function initialRows() {
  return INITIAL_DATASET.flatMap(({ category, values, source }) => values.map((value, index) => ({ category, value, sortOrder: (index + 1) * 10, source })));
}

module.exports = {
  FINAL_PROFILE_CODES,
  CLIENT_KARAT_CODES,
  GOLD_ITEM_DESCRIPTIONS,
  GOLD_COLORS,
  PEARL_TYPES,
  CERTIFICATE_AUTHORITIES,
  DIAMOND_TYPES, DIAMOND_TREATMENTS, DIAMOND_COLORS, DIAMOND_CLARITIES, DIAMOND_CUTS, DIAMOND_SHAPES,
  GEMSTONE_NAMES, GEMSTONE_TYPES, GEMSTONE_SHAPES, GEMSTONE_COLORS, GEMSTONE_TONES, GEMSTONE_TONE_LEVELS, GEMSTONE_SATURATIONS, GEMSTONE_OPTICAL_EFFECTS, GEMSTONE_ORIGINS,
  PROFILE_CATEGORIES,
  INITIAL_DATASET,
  initialRows,
  isFinalProfile,
};
