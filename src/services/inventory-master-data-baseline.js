"use strict";

// V1 canonical profile master-data snapshot captured from the approved
// post-03A baseline. It is used only for exact key reconciliation; bootstrap
// never rewrites these rows.
const V1_PROFILE_MASTER_DATA_ROWS = Object.freeze([
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "fl",
    "displayLabel": "FL",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "i1",
    "displayLabel": "I1",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "i2",
    "displayLabel": "I2",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "i3",
    "displayLabel": "I3",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "if",
    "displayLabel": "IF",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "si1",
    "displayLabel": "SI1",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "si2",
    "displayLabel": "SI2",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "vs1",
    "displayLabel": "VS1",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "vs2",
    "displayLabel": "VS2",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "vvs1",
    "displayLabel": "VVS1",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CLARITY",
    "canonicalValue": "vvs2",
    "displayLabel": "VVS2",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "champagne",
    "displayLabel": "Champagne",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "cognac",
    "displayLabel": "Cognac",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "d",
    "displayLabel": "D",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "e",
    "displayLabel": "E",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "f",
    "displayLabel": "F",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "fancy black",
    "displayLabel": "Fancy Black",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "fancy blue",
    "displayLabel": "Fancy Blue",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "fancy pink",
    "displayLabel": "Fancy Pink",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "fancy red",
    "displayLabel": "Fancy Red",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "fancy yellow",
    "displayLabel": "Fancy Yellow",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "g",
    "displayLabel": "G",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "h",
    "displayLabel": "H",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "i",
    "displayLabel": "I",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "j",
    "displayLabel": "J",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "k",
    "displayLabel": "K",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "l",
    "displayLabel": "L",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "m",
    "displayLabel": "M",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "n",
    "displayLabel": "N",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "o",
    "displayLabel": "O",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "p",
    "displayLabel": "P",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "q",
    "displayLabel": "Q",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "r",
    "displayLabel": "R",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "s",
    "displayLabel": "S",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "t",
    "displayLabel": "T",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "u",
    "displayLabel": "U",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "v",
    "displayLabel": "V",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "w",
    "displayLabel": "W",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "x",
    "displayLabel": "X",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "y",
    "displayLabel": "Y",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_COLOR",
    "canonicalValue": "z",
    "displayLabel": "Z",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CUT",
    "canonicalValue": "excellent",
    "displayLabel": "Excellent",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CUT",
    "canonicalValue": "fair",
    "displayLabel": "Fair",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CUT",
    "canonicalValue": "good",
    "displayLabel": "Good",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CUT",
    "canonicalValue": "poor",
    "displayLabel": "Poor",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_CUT",
    "canonicalValue": "very good",
    "displayLabel": "Very Good",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "angola",
    "displayLabel": "Angola",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "australia",
    "displayLabel": "Australia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "botswana",
    "displayLabel": "Botswana",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "brazil",
    "displayLabel": "Brazil",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "canada",
    "displayLabel": "Canada",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "congo",
    "displayLabel": "Congo",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "india",
    "displayLabel": "India",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "lesotho",
    "displayLabel": "Lesotho",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "namibia",
    "displayLabel": "Namibia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "other",
    "displayLabel": "Other",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "russia",
    "displayLabel": "Russia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "sierra leone",
    "displayLabel": "Sierra Leone",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "south africa",
    "displayLabel": "South Africa",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "tanzania",
    "displayLabel": "Tanzania",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_ORIGIN",
    "canonicalValue": "zimbabwe",
    "displayLabel": "Zimbabwe",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "asscher",
    "displayLabel": "Asscher",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "baguette",
    "displayLabel": "Baguette",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "briolette",
    "displayLabel": "Briolette",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "bullet",
    "displayLabel": "Bullet",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "cabochon",
    "displayLabel": "Cabochon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "crescent",
    "displayLabel": "Crescent",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "cushion",
    "displayLabel": "Cushion",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "emerald cut",
    "displayLabel": "Emerald Cut",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "freeform",
    "displayLabel": "Freeform",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "half moon",
    "displayLabel": "Half Moon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "heart",
    "displayLabel": "Heart",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "hexagon",
    "displayLabel": "Hexagon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "kite",
    "displayLabel": "Kite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "lozenge",
    "displayLabel": "Lozenge",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "marquise",
    "displayLabel": "Marquise",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "octagon",
    "displayLabel": "Octagon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "oval",
    "displayLabel": "Oval",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "pear",
    "displayLabel": "Pear",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "pentagon",
    "displayLabel": "Pentagon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "princess",
    "displayLabel": "Princess",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "radiant",
    "displayLabel": "Radiant",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "round",
    "displayLabel": "Round",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "shield",
    "displayLabel": "Shield",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "square",
    "displayLabel": "Square",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "tapered baguette",
    "displayLabel": "Tapered Baguette",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "tapered trapezoid",
    "displayLabel": "Tapered Trapezoid",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "trapezoid",
    "displayLabel": "Trapezoid",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "triangle",
    "displayLabel": "Triangle",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_SHAPE",
    "canonicalValue": "trillion",
    "displayLabel": "Trillion",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TREATMENT",
    "canonicalValue": "clarity enhanced",
    "displayLabel": "Clarity Enhanced",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TREATMENT",
    "canonicalValue": "coated",
    "displayLabel": "Coated",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TREATMENT",
    "canonicalValue": "color enhanced",
    "displayLabel": "Color Enhanced",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TREATMENT",
    "canonicalValue": "composite diamond",
    "displayLabel": "Composite Diamond",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TREATMENT",
    "canonicalValue": "fracture filled",
    "displayLabel": "Fracture Filled",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TREATMENT",
    "canonicalValue": "hpht",
    "displayLabel": "HPHT",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TREATMENT",
    "canonicalValue": "irradiated",
    "displayLabel": "Irradiated",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TREATMENT",
    "canonicalValue": "laser drilled",
    "displayLabel": "Laser Drilled",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TREATMENT",
    "canonicalValue": "other",
    "displayLabel": "Other",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TYPE",
    "canonicalValue": "lab grown diamond",
    "displayLabel": "Lab Grown Diamond",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TYPE",
    "canonicalValue": "natural diamond",
    "displayLabel": "Natural Diamond",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "DIAMOND_TYPE",
    "canonicalValue": "treated / enhanced diamond",
    "displayLabel": "Treated / Enhanced Diamond",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "bi color",
    "displayLabel": "Bi Color",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "black",
    "displayLabel": "Black",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "blue",
    "displayLabel": "Blue",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "blue green",
    "displayLabel": "Blue Green",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "brown",
    "displayLabel": "Brown",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "burgundy",
    "displayLabel": "Burgundy",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "canary yellow",
    "displayLabel": "Canary Yellow",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "champagne",
    "displayLabel": "Champagne",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "chocolate brown",
    "displayLabel": "Chocolate Brown",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "cognac",
    "displayLabel": "Cognac",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "colorless",
    "displayLabel": "Colorless",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "cornflower blue",
    "displayLabel": "Cornflower Blue",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "cream",
    "displayLabel": "Cream",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "emerald green",
    "displayLabel": "Emerald Green",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "golden yellow",
    "displayLabel": "Golden Yellow",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "gray",
    "displayLabel": "Gray",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "green",
    "displayLabel": "Green",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "greenish blue",
    "displayLabel": "Greenish Blue",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "honey",
    "displayLabel": "Honey",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "hot pink",
    "displayLabel": "Hot Pink",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "ivory",
    "displayLabel": "Ivory",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "lavender",
    "displayLabel": "Lavender",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "lilac",
    "displayLabel": "Lilac",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "mint green",
    "displayLabel": "Mint Green",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "multicolor",
    "displayLabel": "Multicolor",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "olive green",
    "displayLabel": "Olive Green",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "orange",
    "displayLabel": "Orange",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "other",
    "displayLabel": "Other",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "peach",
    "displayLabel": "Peach",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "pigeon blood red",
    "displayLabel": "Pigeon Blood Red",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "pink",
    "displayLabel": "Pink",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "purple",
    "displayLabel": "Purple",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "purplish red",
    "displayLabel": "Purplish Red",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "red",
    "displayLabel": "Red",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "rose pink",
    "displayLabel": "Rose Pink",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "royal blue",
    "displayLabel": "Royal Blue",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "salmon",
    "displayLabel": "Salmon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "silver",
    "displayLabel": "Silver",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "sky blue",
    "displayLabel": "Sky Blue",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "teal",
    "displayLabel": "Teal",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "tri color",
    "displayLabel": "Tri Color",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "violet",
    "displayLabel": "Violet",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "white",
    "displayLabel": "White",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "yellow",
    "displayLabel": "Yellow",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_COLOR",
    "canonicalValue": "yellow green",
    "displayLabel": "Yellow Green",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "agate",
    "displayLabel": "Agate",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "alexandrite",
    "displayLabel": "Alexandrite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "amazonite",
    "displayLabel": "Amazonite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "amber",
    "displayLabel": "Amber",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "amethyst",
    "displayLabel": "Amethyst",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "andalusite",
    "displayLabel": "Andalusite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "apatite",
    "displayLabel": "Apatite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "aquamarine",
    "displayLabel": "Aquamarine",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "aventurine",
    "displayLabel": "Aventurine",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "benitoite",
    "displayLabel": "Benitoite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "black opal",
    "displayLabel": "Black Opal",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "bloodstone",
    "displayLabel": "Bloodstone",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "boulder opal",
    "displayLabel": "Boulder Opal",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "carnelian",
    "displayLabel": "Carnelian",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "charoite",
    "displayLabel": "Charoite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "chrome diopside",
    "displayLabel": "Chrome Diopside",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "chrysoberyl",
    "displayLabel": "Chrysoberyl",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "chrysoprase",
    "displayLabel": "Chrysoprase",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "citrine",
    "displayLabel": "Citrine",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "coral",
    "displayLabel": "Coral",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "diopside",
    "displayLabel": "Diopside",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "emerald",
    "displayLabel": "Emerald",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "ethiopian opal",
    "displayLabel": "Ethiopian Opal",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "fire opal",
    "displayLabel": "Fire Opal",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "fluorite",
    "displayLabel": "Fluorite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "garnet",
    "displayLabel": "Garnet",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "iolite",
    "displayLabel": "Iolite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "ivory substitute",
    "displayLabel": "Ivory Substitute",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "jade",
    "displayLabel": "Jade",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "jadeite",
    "displayLabel": "Jadeite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "jasper",
    "displayLabel": "Jasper",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "jet",
    "displayLabel": "Jet",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "kunzite",
    "displayLabel": "Kunzite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "labradorite",
    "displayLabel": "Labradorite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "lapis lazuli",
    "displayLabel": "Lapis Lazuli",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "larimar",
    "displayLabel": "Larimar",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "malachite",
    "displayLabel": "Malachite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "mexican opal",
    "displayLabel": "Mexican Opal",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "moonstone",
    "displayLabel": "Moonstone",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "morganite",
    "displayLabel": "Morganite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "mother of pearl",
    "displayLabel": "Mother Of Pearl",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "nephrite",
    "displayLabel": "Nephrite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "obsidian",
    "displayLabel": "Obsidian",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "onyx",
    "displayLabel": "Onyx",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "opal",
    "displayLabel": "Opal",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "other",
    "displayLabel": "Other",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "peridot",
    "displayLabel": "Peridot",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "prehnite",
    "displayLabel": "Prehnite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "quartz",
    "displayLabel": "Quartz",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "rhodonite",
    "displayLabel": "Rhodonite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "rock crystal",
    "displayLabel": "Rock Crystal",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "rose quartz",
    "displayLabel": "Rose Quartz",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "ruby",
    "displayLabel": "Ruby",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "sapphire",
    "displayLabel": "Sapphire",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "seraphinite",
    "displayLabel": "Seraphinite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "smoky quartz",
    "displayLabel": "Smoky Quartz",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "sphene",
    "displayLabel": "Sphene",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "spinel",
    "displayLabel": "Spinel",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "sunstone",
    "displayLabel": "Sunstone",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "tanzanite",
    "displayLabel": "Tanzanite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "tiger eye",
    "displayLabel": "Tiger Eye",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "topaz",
    "displayLabel": "Topaz",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "tourmaline",
    "displayLabel": "Tourmaline",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "tsavorite",
    "displayLabel": "Tsavorite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "turquoise",
    "displayLabel": "Turquoise",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "zircon",
    "displayLabel": "Zircon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_NAME",
    "canonicalValue": "zoisite",
    "displayLabel": "Zoisite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "adularescence",
    "displayLabel": "Adularescence",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "asterism",
    "displayLabel": "Asterism",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "aventurescence",
    "displayLabel": "Aventurescence",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "chatoyancy",
    "displayLabel": "Chatoyancy",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "color change",
    "displayLabel": "Color Change",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "iridescence",
    "displayLabel": "Iridescence",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "labradorescence",
    "displayLabel": "Labradorescence",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "none",
    "displayLabel": "None",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "orient",
    "displayLabel": "Orient",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "other",
    "displayLabel": "Other",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_OPTICAL_EFFECT",
    "canonicalValue": "play of color",
    "displayLabel": "Play Of Color",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "afghanistan",
    "displayLabel": "Afghanistan",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "australia",
    "displayLabel": "Australia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "brazil",
    "displayLabel": "Brazil",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "burma",
    "displayLabel": "Burma",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "cambodia",
    "displayLabel": "Cambodia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "china",
    "displayLabel": "China",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "colombia",
    "displayLabel": "Colombia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "ethiopia",
    "displayLabel": "Ethiopia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "india",
    "displayLabel": "India",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "kenya",
    "displayLabel": "Kenya",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "madagascar",
    "displayLabel": "Madagascar",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "mozambique",
    "displayLabel": "Mozambique",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "myanmar",
    "displayLabel": "Myanmar",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "nepal",
    "displayLabel": "Nepal",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "nigeria",
    "displayLabel": "Nigeria",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "other approved values",
    "displayLabel": "Other Approved Values",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "pakistan",
    "displayLabel": "Pakistan",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "russia",
    "displayLabel": "Russia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "sri lanka",
    "displayLabel": "Sri Lanka",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "tanzania",
    "displayLabel": "Tanzania",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "thailand",
    "displayLabel": "Thailand",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "usa",
    "displayLabel": "USA",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "vietnam",
    "displayLabel": "Vietnam",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "zambia",
    "displayLabel": "Zambia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_ORIGIN",
    "canonicalValue": "zimbabwe",
    "displayLabel": "Zimbabwe",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "brownish",
    "displayLabel": "Brownish",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "exceptional vivid",
    "displayLabel": "Exceptional Vivid",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "faint",
    "displayLabel": "Faint",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "grayish",
    "displayLabel": "Grayish",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "moderate",
    "displayLabel": "Moderate",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "moderately strong",
    "displayLabel": "Moderately Strong",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "strong",
    "displayLabel": "Strong",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "very strong",
    "displayLabel": "Very Strong",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "vivid",
    "displayLabel": "Vivid",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SATURATION",
    "canonicalValue": "weak",
    "displayLabel": "Weak",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "asscher",
    "displayLabel": "Asscher",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "baguette",
    "displayLabel": "Baguette",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "briolette",
    "displayLabel": "Briolette",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "cabochon",
    "displayLabel": "Cabochon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "cushion",
    "displayLabel": "Cushion",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "emerald cut",
    "displayLabel": "Emerald Cut",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "freeform",
    "displayLabel": "Freeform",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "heart",
    "displayLabel": "Heart",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "hexagon",
    "displayLabel": "Hexagon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "marquise",
    "displayLabel": "Marquise",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "octagon",
    "displayLabel": "Octagon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "oval",
    "displayLabel": "Oval",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "pear",
    "displayLabel": "Pear",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "princess",
    "displayLabel": "Princess",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "radiant",
    "displayLabel": "Radiant",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "round",
    "displayLabel": "Round",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "square",
    "displayLabel": "Square",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "triangle",
    "displayLabel": "Triangle",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_SHAPE",
    "canonicalValue": "trillion",
    "displayLabel": "Trillion",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "bright",
    "displayLabel": "Bright",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "cool",
    "displayLabel": "Cool",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "deep",
    "displayLabel": "Deep",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "earthy",
    "displayLabel": "Earthy",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "iridescent",
    "displayLabel": "Iridescent",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "metallic",
    "displayLabel": "Metallic",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "neon",
    "displayLabel": "Neon",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "neutral",
    "displayLabel": "Neutral",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "other",
    "displayLabel": "Other",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "pastel",
    "displayLabel": "Pastel",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "rich",
    "displayLabel": "Rich",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "smoky",
    "displayLabel": "Smoky",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "soft",
    "displayLabel": "Soft",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE",
    "canonicalValue": "warm",
    "displayLabel": "Warm",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE_LEVEL",
    "canonicalValue": "dark",
    "displayLabel": "Dark",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE_LEVEL",
    "canonicalValue": "extremely dark",
    "displayLabel": "Extremely Dark",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE_LEVEL",
    "canonicalValue": "extremely light",
    "displayLabel": "Extremely Light",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE_LEVEL",
    "canonicalValue": "light",
    "displayLabel": "Light",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE_LEVEL",
    "canonicalValue": "medium",
    "displayLabel": "Medium",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE_LEVEL",
    "canonicalValue": "medium dark",
    "displayLabel": "Medium Dark",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE_LEVEL",
    "canonicalValue": "medium light",
    "displayLabel": "Medium Light",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE_LEVEL",
    "canonicalValue": "very dark",
    "displayLabel": "Very Dark",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TONE_LEVEL",
    "canonicalValue": "very light",
    "displayLabel": "Very Light",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TYPE",
    "canonicalValue": "composite",
    "displayLabel": "Composite",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TYPE",
    "canonicalValue": "imitation",
    "displayLabel": "Imitation",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TYPE",
    "canonicalValue": "lab grown",
    "displayLabel": "Lab Grown",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TYPE",
    "canonicalValue": "natural",
    "displayLabel": "Natural",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TYPE",
    "canonicalValue": "reconstructed",
    "displayLabel": "Reconstructed",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GEMSTONE_TYPE",
    "canonicalValue": "synthetic",
    "displayLabel": "Synthetic",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_COLOR",
    "canonicalValue": "multi-colour",
    "displayLabel": "Multi-colour",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_COLOR",
    "canonicalValue": "rose gold",
    "displayLabel": "Rose Gold",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_COLOR",
    "canonicalValue": "white gold",
    "displayLabel": "White Gold",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_COLOR",
    "canonicalValue": "yellow gold",
    "displayLabel": "Yellow Gold",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "custom design",
    "displayLabel": "Custom Design",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold anklet",
    "displayLabel": "Gold Anklet",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold bangle",
    "displayLabel": "Gold Bangle",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold bar",
    "displayLabel": "Gold Bar",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold bracelet",
    "displayLabel": "Gold Bracelet",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold brooch",
    "displayLabel": "Gold Brooch",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold chain",
    "displayLabel": "Gold Chain",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold choker",
    "displayLabel": "Gold Choker",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold coin",
    "displayLabel": "Gold Coin",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold crown",
    "displayLabel": "Gold Crown",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold earrings",
    "displayLabel": "Gold Earrings",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold full set",
    "displayLabel": "Gold Full Set",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold necklace",
    "displayLabel": "Gold Necklace",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold pendant",
    "displayLabel": "Gold Pendant",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold pendant chain",
    "displayLabel": "Gold Pendant Chain",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold ring",
    "displayLabel": "Gold Ring",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold rosary",
    "displayLabel": "Gold Rosary",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold twins ring",
    "displayLabel": "Gold Twins Ring",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "GOLD_ITEM_DESCRIPTION",
    "canonicalValue": "gold wedding band",
    "displayLabel": "Gold Wedding Band",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "black",
    "displayLabel": "Black",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "blue",
    "displayLabel": "Blue",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "bronze",
    "displayLabel": "Bronze",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "champagne",
    "displayLabel": "Champagne",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "chocolate",
    "displayLabel": "Chocolate",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "copper",
    "displayLabel": "Copper",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "cream",
    "displayLabel": "Cream",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "golden",
    "displayLabel": "Golden",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "gray",
    "displayLabel": "Gray",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "green",
    "displayLabel": "Green",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "lavender",
    "displayLabel": "Lavender",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "peach",
    "displayLabel": "Peach",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "peacock",
    "displayLabel": "Peacock",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "pink",
    "displayLabel": "Pink",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "purple",
    "displayLabel": "Purple",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "silver",
    "displayLabel": "Silver",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_COLOR",
    "canonicalValue": "white",
    "displayLabel": "White",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "loose pearl",
    "displayLabel": "Loose Pearl",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl anklet",
    "displayLabel": "Pearl Anklet",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl bangle",
    "displayLabel": "Pearl Bangle",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl bar",
    "displayLabel": "Pearl Bar",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl bracelet",
    "displayLabel": "Pearl Bracelet",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl brooch",
    "displayLabel": "Pearl Brooch",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl chain",
    "displayLabel": "Pearl Chain",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl choker",
    "displayLabel": "Pearl Choker",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl coin",
    "displayLabel": "Pearl Coin",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl crown",
    "displayLabel": "Pearl Crown",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl earrings",
    "displayLabel": "Pearl Earrings",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl full set",
    "displayLabel": "Pearl Full Set",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl necklace",
    "displayLabel": "Pearl Necklace",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl pendant",
    "displayLabel": "Pearl Pendant",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl pendant chain",
    "displayLabel": "Pearl Pendant Chain",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl ring",
    "displayLabel": "Pearl Ring",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl twins ring",
    "displayLabel": "Pearl Twins Ring",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ITEM_DESCRIPTION",
    "canonicalValue": "pearl wedding band",
    "displayLabel": "Pearl Wedding Band",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "bright",
    "displayLabel": "Bright",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "chalky",
    "displayLabel": "Chalky",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "clear",
    "displayLabel": "Clear",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "crisp",
    "displayLabel": "Crisp",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "deep",
    "displayLabel": "Deep",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "diffuse",
    "displayLabel": "Diffuse",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "dull",
    "displayLabel": "Dull",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "glassy",
    "displayLabel": "Glassy",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "glossy",
    "displayLabel": "Glossy",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "high",
    "displayLabel": "High",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "intense",
    "displayLabel": "Intense",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "low",
    "displayLabel": "Low",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "medium",
    "displayLabel": "Medium",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "metallic",
    "displayLabel": "Metallic",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "mirror",
    "displayLabel": "Mirror",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "mirror-like",
    "displayLabel": "Mirror-Like",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "muted",
    "displayLabel": "Muted",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "radiant",
    "displayLabel": "Radiant",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "reflective",
    "displayLabel": "Reflective",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "satiny",
    "displayLabel": "Satiny",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "sharp",
    "displayLabel": "Sharp",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "silky",
    "displayLabel": "Silky",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "soft",
    "displayLabel": "Soft",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "strong",
    "displayLabel": "Strong",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "subdued",
    "displayLabel": "Subdued",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_LUSTER",
    "canonicalValue": "weak",
    "displayLabel": "Weak",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "chalky",
    "displayLabel": "Chalky",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "compact",
    "displayLabel": "Compact",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "consistent",
    "displayLabel": "Consistent",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "cracked",
    "displayLabel": "Cracked",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "durable",
    "displayLabel": "Durable",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "even",
    "displayLabel": "Even",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "excellent",
    "displayLabel": "Excellent",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "good",
    "displayLabel": "Good",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "heavy",
    "displayLabel": "Heavy",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "high",
    "displayLabel": "High",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "layered",
    "displayLabel": "Layered",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "medium",
    "displayLabel": "Medium",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "moderate",
    "displayLabel": "Moderate",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "nucleus visible",
    "displayLabel": "Nucleus Visible",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "patchy",
    "displayLabel": "Patchy",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "poor",
    "displayLabel": "Poor",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "smooth",
    "displayLabel": "Smooth",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "solid",
    "displayLabel": "Solid",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "strong",
    "displayLabel": "Strong",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "thick",
    "displayLabel": "Thick",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "thin",
    "displayLabel": "Thin",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "translucent",
    "displayLabel": "Translucent",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "transparent",
    "displayLabel": "Transparent",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "uneven",
    "displayLabel": "Uneven",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "uniform",
    "displayLabel": "Uniform",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "weak",
    "displayLabel": "Weak",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_NACRE_QUALITY",
    "canonicalValue": "well layered",
    "displayLabel": "Well Layered",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIENT",
    "canonicalValue": "excellent",
    "displayLabel": "Excellent",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIENT",
    "canonicalValue": "fair",
    "displayLabel": "Fair",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIENT",
    "canonicalValue": "good",
    "displayLabel": "Good",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIENT",
    "canonicalValue": "none",
    "displayLabel": "None",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIENT",
    "canonicalValue": "poor",
    "displayLabel": "Poor",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIENT",
    "canonicalValue": "very good",
    "displayLabel": "Very Good",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "australia",
    "displayLabel": "Australia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "bahrain",
    "displayLabel": "Bahrain",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "china",
    "displayLabel": "China",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "cook islands",
    "displayLabel": "Cook Islands",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "french polynesia",
    "displayLabel": "French Polynesia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "hong kong",
    "displayLabel": "Hong Kong",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "indonesia",
    "displayLabel": "Indonesia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "japan",
    "displayLabel": "Japan",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "malaysia",
    "displayLabel": "Malaysia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "mexico",
    "displayLabel": "Mexico",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "myanmar",
    "displayLabel": "Myanmar",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "oman",
    "displayLabel": "Oman",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "philippines",
    "displayLabel": "Philippines",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "saudi arabia",
    "displayLabel": "Saudi Arabia",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "sri lanka",
    "displayLabel": "Sri Lanka",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "tahiti",
    "displayLabel": "Tahiti",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "thailand",
    "displayLabel": "Thailand",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "tonga",
    "displayLabel": "Tonga",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "united arab emirates",
    "displayLabel": "United Arab Emirates",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_ORIGIN",
    "canonicalValue": "vietnam",
    "displayLabel": "Vietnam",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "aubergine",
    "displayLabel": "Aubergine",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "blue",
    "displayLabel": "Blue",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "blue-green",
    "displayLabel": "Blue-Green",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "champagne",
    "displayLabel": "Champagne",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "cherry",
    "displayLabel": "Cherry",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "copper",
    "displayLabel": "Copper",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "cream",
    "displayLabel": "Cream",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "gold",
    "displayLabel": "Gold",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "green",
    "displayLabel": "Green",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "ivory",
    "displayLabel": "Ivory",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "none",
    "displayLabel": "None",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "peacock",
    "displayLabel": "Peacock",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "pink",
    "displayLabel": "Pink",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "purple",
    "displayLabel": "Purple",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "rose",
    "displayLabel": "Rose",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "silver",
    "displayLabel": "Silver",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "steel",
    "displayLabel": "Steel",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "violet",
    "displayLabel": "Violet",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_OVERTONE",
    "canonicalValue": "white",
    "displayLabel": "White",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "baroque",
    "displayLabel": "Baroque",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "button",
    "displayLabel": "Button",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "circle",
    "displayLabel": "Circle",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "drop",
    "displayLabel": "Drop",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "near round",
    "displayLabel": "Near Round",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "oval",
    "displayLabel": "Oval",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "pear",
    "displayLabel": "Pear",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "round",
    "displayLabel": "Round",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "semi-baroque",
    "displayLabel": "Semi-Baroque",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SHAPE",
    "canonicalValue": "semi-round",
    "displayLabel": "Semi-Round",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "blemished",
    "displayLabel": "Blemished",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "clean",
    "displayLabel": "Clean",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "cracked",
    "displayLabel": "Cracked",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "dimpled",
    "displayLabel": "Dimpled",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "flawless",
    "displayLabel": "Flawless",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "grooved",
    "displayLabel": "Grooved",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "heavily blemished",
    "displayLabel": "Heavily Blemished",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "indented",
    "displayLabel": "Indented",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "lightly blemished",
    "displayLabel": "Lightly Blemished",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "moderately blemished",
    "displayLabel": "Moderately Blemished",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "pitted",
    "displayLabel": "Pitted",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "ridged",
    "displayLabel": "Ridged",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "ringed",
    "displayLabel": "Ringed",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "rough",
    "displayLabel": "Rough",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "scratched",
    "displayLabel": "Scratched",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "smooth",
    "displayLabel": "Smooth",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "spotted",
    "displayLabel": "Spotted",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_SURFACE_QUALITY",
    "canonicalValue": "wrinkled",
    "displayLabel": "Wrinkled",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "abalone",
    "displayLabel": "Abalone",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "akoya",
    "displayLabel": "Akoya",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "conch",
    "displayLabel": "Conch",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "cortez",
    "displayLabel": "Cortez",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "freshwater",
    "displayLabel": "Freshwater",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "keshi",
    "displayLabel": "Keshi",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "mabe",
    "displayLabel": "Mabe",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "melo",
    "displayLabel": "Melo",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "south sea",
    "displayLabel": "South Sea",
    "isActive": true,
    "sortOrder": 100000
  },
  {
    "category": "PEARL_TYPE",
    "canonicalValue": "tahitian",
    "displayLabel": "Tahitian",
    "isActive": true,
    "sortOrder": 100000
  }
]);

module.exports = { V1_PROFILE_MASTER_DATA_ROWS };
