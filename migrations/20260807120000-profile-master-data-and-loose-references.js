"use strict";
const crypto = require("crypto");

const SOURCE_SEEDS = Object.freeze({
  PEARL_TYPE: ["Abalone","Akoya","Conch","Cortez","Freshwater","Keshi","Mabe","Melo","South Sea","Tahitian"],
  PEARL_COLOR: ["Black","Blue","Bronze","Champagne","Chocolate","Copper","Cream","Golden","Gray","Green","Lavender","Peach","Peacock","Pink","Purple","Silver","White"],
  PEARL_OVERTONE: ["Aubergine","Blue","Blue-Green","Champagne","Cherry","Copper","Cream","Gold","Green","Ivory","None","Peacock","Pink","Purple","Rose","Silver","Steel","Violet","White"],
  PEARL_ORIENT: ["Excellent","Very Good","Good","Fair","Poor","None"],
  PEARL_SHAPE: ["Baroque","Button","Circle","Drop","Near Round","Oval","Pear","Round","Semi-Baroque","Semi-Round"],
  PEARL_LUSTER: ["Bright","Chalky","Clear","Crisp","Deep","Diffuse","Dull","Glassy","Glossy","High","Intense","Low","Medium","Metallic","Mirror","Mirror-Like","Muted","Radiant","Reflective","Satiny","Sharp","Silky","Soft","Strong","Subdued","Weak"],
  PEARL_SURFACE_QUALITY: ["Blemished","Clean","Cracked","Dimpled","Flawless","Grooved","Heavily Blemished","Indented","Lightly Blemished","Moderately Blemished","Pitted","Ridged","Ringed","Rough","Scratched","Smooth","Spotted","Wrinkled"],
  PEARL_NACRE_QUALITY: ["Chalky","Compact","Consistent","Cracked","Durable","Even","Excellent","Good","Heavy","High","Layered","Medium","Moderate","Nucleus Visible","Patchy","Poor","Smooth","Solid","Strong","Thick","Thin","Translucent","Transparent","Uniform","Uneven","Weak","Well Layered"],
  PEARL_ORIGIN: ["Australia","Bahrain","China","Cook Islands","French Polynesia","Hong Kong","Indonesia","Japan","Malaysia","Mexico","Myanmar","Oman","Philippines","Saudi Arabia","Sri Lanka","Tahiti","Thailand","Tonga","United Arab Emirates","Vietnam"],
  GEMSTONE_NAME: ["Agate","Alexandrite","Amazonite","Amber","Amethyst","Andalusite","Apatite","Aquamarine","Aventurine","Benitoite","Black Opal","Bloodstone","Boulder Opal","Carnelian","Charoite","Chrome Diopside","Chrysoberyl","Chrysoprase","Citrine","Coral","Diopside","Emerald","Ethiopian Opal","Fire Opal","Fluorite","Garnet","Iolite","Ivory Substitute","Jade","Jadeite","Jasper","Jet","Kunzite","Labradorite","Lapis Lazuli","Larimar","Malachite","Mexican Opal","Moonstone","Morganite","Mother Of Pearl","Nephrite","Obsidian","Onyx","Opal","Other","Peridot","Prehnite","Quartz","Rhodonite","Rock Crystal","Rose Quartz","Ruby","Sapphire","Seraphinite","Smoky Quartz","Spinel","Sphene","Sunstone","Tanzanite","Tsavorite","Tiger Eye","Topaz","Tourmaline","Turquoise","Zircon","Zoisite"],
  GEMSTONE_TYPE: ["Composite","Imitation","Lab Grown","Natural","Reconstructed","Synthetic"],
  GEMSTONE_SHAPE: ["Asscher","Baguette","Briolette","Cabochon","Cushion","Emerald Cut","Freeform","Heart","Hexagon","Marquise","Octagon","Oval","Pear","Princess","Radiant","Round","Square","Triangle","Trillion"],
  GEMSTONE_COLOR: ["Bi Color","Black","Blue","Blue Green","Brown","Burgundy","Canary Yellow","Champagne","Chocolate Brown","Cognac","Colorless","Cornflower Blue","Cream","Emerald Green","Golden Yellow","Gray","Green","Greenish Blue","Honey","Hot Pink","Ivory","Lavender","Lilac","Mint Green","Multicolor","Olive Green","Orange","Other","Peach","Pigeon Blood Red","Pink","Purple","Purplish Red","Red","Rose Pink","Royal Blue","Salmon","Silver","Sky Blue","Teal","Tri Color","Violet","White","Yellow","Yellow Green"],
  GEMSTONE_TONE: ["Bright","Cool","Deep","Earthy","Iridescent","Metallic","Neon","Neutral","Other","Pastel","Rich","Smoky","Soft","Warm"],
  GEMSTONE_TONE_LEVEL: ["Dark","Extremely Dark","Extremely Light","Light","Medium","Medium Dark","Medium Light","Very Dark","Very Light"],
  GEMSTONE_SATURATION: ["Grayish","Brownish","Faint","Weak","Moderate","Moderately Strong","Strong","Very Strong","Vivid","Exceptional Vivid"],
  GEMSTONE_OPTICAL_EFFECT: ["None","Adularescence","Asterism","Aventurescence","Chatoyancy","Color Change","Iridescence","Labradorescence","Orient","Play Of Color","Other"],
  GEMSTONE_ORIGIN: ["Afghanistan","Australia","Brazil","Burma","Cambodia","China","Colombia","Ethiopia","India","Kenya","Madagascar","Mozambique","Myanmar","Nepal","Nigeria","Pakistan","Russia","Sri Lanka","Tanzania","Thailand","USA","Vietnam","Zambia","Zimbabwe","Other Approved Values"],
  CERTIFICATE_AUTHORITY: ["AGS","AIGS","Bellerophon","EGL","GCAL","GIA","GIT","GRS","Gubelin","HRD","ICA","IGI","Lotus Gemology","SSEF"],
});

// Additive only.  No historical source values are inferred or backfilled.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("profile_master_data", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        category_key: { type: Sequelize.STRING(64), allowNull: false },
        canonical_value: { type: Sequelize.STRING(160), allowNull: false },
        display_label: { type: Sequelize.STRING(160), allowNull: false },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_by: { type: Sequelize.STRING, allowNull: true }, updated_by: { type: Sequelize.STRING, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }, updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      }, { transaction });
      await queryInterface.addConstraint("profile_master_data", { fields: ["company_id", "category_key", "canonical_value"], type: "unique", name: "profile_master_data_company_category_value_uq", transaction });
      await queryInterface.addIndex("profile_master_data", ["company_id", "category_key", "is_active", "sort_order"], { name: "profile_master_data_scope_idx", transaction });
      await queryInterface.createTable("asset_profile_master_data_references", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        category_key: { type: Sequelize.STRING(64), allowNull: false },
        master_data_id: { type: Sequelize.STRING, allowNull: false, references: { model: "profile_master_data", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        value_snapshot: { type: Sequelize.STRING(160), allowNull: false }, label_snapshot: { type: Sequelize.STRING(160), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      }, { transaction });
      await queryInterface.addConstraint("asset_profile_master_data_references", { fields: ["asset_id", "category_key"], type: "unique", name: "asset_profile_master_reference_uq", transaction });
      await queryInterface.addIndex("asset_profile_master_data_references", ["company_id", "master_data_id"], { name: "asset_profile_master_reference_scope_idx", transaction });
      await queryInterface.addColumn("asset_pearl_component_details", "pearl_size_master_data_id", { type: Sequelize.STRING, allowNull: true, references: { model: "pearl_size_master_data", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" }, { transaction });
      await queryInterface.addIndex("asset_pearl_component_details", ["pearl_size_master_data_id"], { name: "asset_pearl_component_size_master_idx", transaction });
      await queryInterface.addColumn("asset_gemstone_component_details", "treatment", { type: Sequelize.STRING(160), allowNull: true }, { transaction });
      const [companies] = await queryInterface.sequelize.query("SELECT id FROM companies", { transaction });
      for (const company of companies) for (const [category, labels] of Object.entries(SOURCE_SEEDS)) for (let index = 0; index < labels.length; index += 1) {
        const label = labels[index];
        await queryInterface.sequelize.query(`INSERT INTO profile_master_data (id,company_id,category_key,canonical_value,display_label,is_active,sort_order,created_at,updated_at)
          VALUES (:id,:companyId,:category,:value,:label,true,:sortOrder,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT (company_id,category_key,canonical_value) DO NOTHING`, {
          replacements: { id: `PMD-${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`, companyId: company.id, category, value: label.toLowerCase(), label, sortOrder: index + 1 }, transaction,
        });
      }
    });
  },
  async down() { throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: profile master data must not be dropped automatically"); },
};
