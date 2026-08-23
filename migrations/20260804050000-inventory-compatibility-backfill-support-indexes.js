"use strict";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        INSERT INTO inventory_locations (id, company_id, branch_id, code, name, location_type, is_active, created_at, updated_at)
        SELECT
          'IMLOC-' || substr(md5(company_id || ':' || branch_id || ':' || location), 1, 24),
          company_id,
          branch_id,
          CASE
            WHEN regexp_replace(upper(location), '[^A-Z0-9]+', '', 'g') = '' THEN 'LOC' || substr(md5(location), 1, 8)
            ELSE substr(regexp_replace(upper(location), '[^A-Z0-9]+', '', 'g'), 1, 32)
          END,
          location,
          'LEGACY',
          true,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM assets
        WHERE branch_id IS NOT NULL AND nullif(btrim(location), '') IS NOT NULL
        GROUP BY company_id, branch_id, location
        ON CONFLICT (company_id, branch_id, code) DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        UPDATE assets a
        SET location_id = l.id,
            inventory_profile = CASE
              WHEN a.type::text = 'gold-weight' AND a.karat = 24 AND (a.name ILIKE '%bar%' OR a.category ILIKE '%bar%' OR a.name LIKE '%سبيكة%' OR a.category LIKE '%سبيكة%') THEN 'GOLD_BAR_24K'
              WHEN a.type::text = 'gold-weight' AND a.karat <> 24 THEN 'GOLD_BY_WEIGHT_JEWELLERY'
              WHEN a.type::text = 'gold-piece' THEN 'GOLD_BY_PIECE'
              WHEN a.type::text = 'diamond' AND coalesce(a.inventory_subtype, '') ILIKE '%loose%' THEN 'LOOSE_DIAMOND'
              WHEN a.type::text = 'diamond' THEN 'DIAMOND_JEWELLERY'
              WHEN a.type::text = 'gemstone' AND coalesce(a.inventory_subtype, '') ILIKE '%loose%' THEN 'LOOSE_GEMSTONE'
              WHEN a.type::text = 'gemstone' THEN 'GEMSTONE_JEWELLERY'
              WHEN a.type::text = 'pearl' AND coalesce(a.inventory_subtype, '') ILIKE '%loose%' THEN 'LOOSE_PEARL'
              WHEN a.type::text = 'pearl' THEN 'PEARL_JEWELLERY'
              ELSE NULL
            END,
            operational_status = CASE a.status::text
              WHEN 'available' THEN 'AVAILABLE'
              WHEN 'reserved' THEN 'RESERVED'
              WHEN 'pending_transfer' THEN 'PENDING_TRANSFER'
              WHEN 'in_workshop' THEN 'WORKSHOP'
              WHEN 'repair' THEN 'WORKSHOP'
              WHEN 'returned' THEN 'RETURNED'
              WHEN 'melted' THEN 'MELTED'
              WHEN 'sold' THEN 'SOLD'
              ELSE NULL
            END,
            condition_classification = CASE WHEN a.condition IS NULL THEN 'LEGACY_CONDITION_UNKNOWN' ELSE 'EXPLICIT' END,
            tag_state = CASE WHEN a.status::text = 'pending_tag' THEN 'PENDING' ELSE a.tag_state END,
            tag_state_classification = CASE WHEN a.status::text = 'pending_tag' THEN 'LEGACY_STATUS_DETERMINISTIC' ELSE 'LEGACY_TAG_STATE_UNKNOWN' END
        FROM inventory_locations l
        WHERE l.company_id = a.company_id AND l.branch_id = a.branch_id AND l.name = a.location
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO purchase_order_item_asset_links (id, purchase_order_item_id, asset_id, company_id, ordinal, received_at, received_by, mapping_classification, created_at)
        SELECT
          'IMPO-' || substr(md5(poi.id || ':' || poi.asset_id), 1, 28),
          poi.id,
          poi.asset_id,
          a.company_id,
          row_number() OVER (PARTITION BY poi.id ORDER BY a.id),
          a.created_at,
          a.created_by,
          'ASSET_LINK_PROVEN',
          CURRENT_TIMESTAMP
        FROM purchase_order_items poi
        JOIN assets a ON a.id = poi.asset_id
        WHERE poi.asset_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO asset_origins (id, asset_id, company_id, branch_id, origin_type, purchase_order_item_id, received_at, received_by, mapping_classification, created_at)
        SELECT
          'IMORIGIN-' || substr(md5(a.id), 1, 24),
          a.id,
          a.company_id,
          a.branch_id,
          'PURCHASE_ORDER',
          poi.id,
          a.created_at,
          a.created_by,
          'ASSET_LINK_PROVEN',
          CURRENT_TIMESTAMP
        FROM assets a
        JOIN purchase_order_items poi ON poi.asset_id = a.id
        WHERE a.branch_id IS NOT NULL
        ON CONFLICT (asset_id) DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO asset_gold_details (
          asset_id, company_id, weight_unit, gross_weight, stone_weight, net_gold_weight,
          karat, purity_ratio, pure_gold_9999, pure_gold_995, mapping_classification, created_at, updated_at
        )
        SELECT
          a.id,
          a.company_id,
          'GRAM',
          a.gross_weight::numeric(20,8),
          NULL,
          coalesce(a.net_gold_weight, a.net_weight)::numeric(20,8),
          a.karat::numeric(9,6),
          CASE WHEN a.karat IS NULL THEN NULL ELSE (a.karat::numeric / 24)::numeric(20,8) END,
          CASE WHEN a.karat IS NULL OR coalesce(a.net_gold_weight, a.net_weight) IS NULL THEN NULL ELSE (coalesce(a.net_gold_weight, a.net_weight)::numeric * a.karat::numeric / 24)::numeric(20,8) END,
          NULL,
          'LEGACY_GOLD_FIELDS_DETERMINISTIC_PARTIAL',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM assets a
        WHERE a.inventory_profile IN ('GOLD_BY_WEIGHT_JEWELLERY','GOLD_BAR_24K','DIAMOND_JEWELLERY','GEMSTONE_JEWELLERY','PEARL_JEWELLERY')
          AND a.gross_weight IS NOT NULL
          AND coalesce(a.net_gold_weight, a.net_weight) IS NOT NULL
        ON CONFLICT (asset_id) DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO asset_purchase_cost_revisions (
          id, asset_id, company_id, branch_id, revision_no, purchase_gold_rate, gold_rate_source,
          gold_value, total_purchase_cost, supplier_id, purchase_order_item_id, is_current,
          provenance, mapping_classification, created_at
        )
        SELECT
          'IMCOST-' || substr(md5(a.id || ':1'), 1, 26),
          a.id,
          a.company_id,
          a.branch_id,
          1,
          a.gold_price_snapshot::numeric(20,8),
          a.gold_price_source,
          a.computed_gold_cost::numeric(20,8),
          coalesce(a.final_purchase_cost, a.cost)::numeric(20,8),
          a.supplier_id,
          poi.id,
          true,
          jsonb_build_object('source', 'legacy_asset_snapshot', 'cost_source', a.cost_source, 'cost_overridden', a.cost_overridden),
          'LEGACY_COST_SNAPSHOT_DETERMINISTIC',
          CURRENT_TIMESTAMP
        FROM assets a
        LEFT JOIN purchase_order_items poi ON poi.asset_id = a.id
        WHERE a.branch_id IS NOT NULL AND coalesce(a.final_purchase_cost, a.cost) IS NOT NULL
        ON CONFLICT (asset_id, revision_no) DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO invoice_item_asset_links (id, invoice_item_id, asset_id, company_id, ordinal, cost_snapshot_revision_id, mapping_classification, created_at)
        SELECT
          'IMINV-' || substr(md5(ii.id::text || ':' || ii.asset_id), 1, 27),
          ii.id,
          ii.asset_id,
          a.company_id,
          1,
          r.id,
          'ASSET_LINK_PROVEN',
          CURRENT_TIMESTAMP
        FROM invoice_items ii
        JOIN assets a ON a.id = ii.asset_id
        LEFT JOIN asset_purchase_cost_revisions r ON r.asset_id = a.id AND r.is_current
        ON CONFLICT DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO inventory_source_link_classifications (id, company_id, source_table, source_row_id, source_value, classification, reason, created_at)
        SELECT
          'IMSRC-' || substr(md5('invoice_items:' || ii.id::text), 1, 27),
          i.company_id,
          'invoice_items',
          ii.id::text,
          ii.asset_id,
          CASE
            WHEN a.id IS NOT NULL THEN 'ASSET_LINK_PROVEN'
            WHEN p.id IS NOT NULL THEN 'PRODUCT_LINK_LEGACY'
            ELSE 'AMBIGUOUS'
          END,
          CASE
            WHEN a.id IS NOT NULL THEN 'invoice_items.asset_id resolves to assets.id'
            WHEN p.id IS NOT NULL THEN 'invoice_items.asset_id resolves to products.id and must not be reinterpreted'
            ELSE 'invoice_items.asset_id resolves to neither Asset nor Product'
          END,
          CURRENT_TIMESTAMP
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN assets a ON a.id = ii.asset_id
        LEFT JOIN products p ON p.id = ii.asset_id
        ON CONFLICT (source_table, source_row_id) DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO legacy_product_asset_map (id, product_id, asset_id, company_id, ordinal, classification, mapping_status, evidence, reason, created_at)
        SELECT
          'IMPROD-' || substr(md5(p.id), 1, 26),
          p.id,
          NULL,
          p.company_id,
          NULL,
          CASE
            WHEN EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id)
              OR EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.product_id = p.id)
              OR EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.asset_id = p.id)
              THEN 'D'
            WHEN p.quantity_on_hand > 0 THEN 'B'
            WHEN p.quantity_on_hand = 0 THEN 'C'
            ELSE 'E'
          END,
          'PRESERVED_UNMAPPED',
          jsonb_build_object(
            'quantity_on_hand', p.quantity_on_hand,
            'quantity_available', p.quantity_available,
            'stock_movement_links', (SELECT count(*) FROM stock_movements sm WHERE sm.product_id = p.id),
            'purchase_order_links', (SELECT count(*) FROM purchase_order_items poi WHERE poi.product_id = p.id),
            'invoice_legacy_links', (SELECT count(*) FROM invoice_items ii WHERE ii.asset_id = p.id)
          )::text,
          CASE
            WHEN p.quantity_on_hand > 1 THEN 'Aggregate quantity cannot be expanded without per-piece identity and weight evidence'
            WHEN EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id)
              OR EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.product_id = p.id)
              OR EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.asset_id = p.id)
              THEN 'Business or historical links require permanent Product preservation'
            ELSE 'No durable per-piece identity evidence exists'
          END,
          CURRENT_TIMESTAMP
        FROM products p
        ON CONFLICT DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO cgp_item_dispositions (id, cgp_item_id, company_id, branch_id, disposition, asset_id, gold_pool_id, evidence, decided_at, decided_by, created_at)
        SELECT
          'IMCGP-' || substr(md5(ci.id), 1, 27),
          ci.id,
          ci.company_id,
          cd.branch_id,
          'MATERIAL_POOL_PENDING_PIECE_EVIDENCE',
          NULL,
          NULL,
          'CGP line-vs-piece identity is unresolved; no Asset or weight was cloned',
          CURRENT_TIMESTAMP,
          NULL,
          CURRENT_TIMESTAMP
        FROM customer_gold_purchase_items ci
        JOIN customer_gold_purchase_documents cd ON cd.id = ci.document_id
        ON CONFLICT (cgp_item_id) DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO asset_rfid_assignments (id, asset_id, company_id, branch_id, rfid_number, status, is_current, assigned_at, assigned_by, mapping_classification, created_at)
        SELECT
          'IMRFID-' || substr(md5(a.id || ':' || a.rfid), 1, 26),
          a.id,
          a.company_id,
          a.branch_id,
          btrim(a.rfid),
          'ACTIVE',
          true,
          a.created_at,
          a.created_by,
          'LEGACY_RFID_DETERMINISTIC',
          CURRENT_TIMESTAMP
        FROM assets a
        WHERE a.branch_id IS NOT NULL AND nullif(btrim(a.rfid), '') IS NOT NULL
        ON CONFLICT DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        UPDATE asset_events e
        SET company_id = a.company_id,
            branch_id = a.branch_id,
            event_type = upper(regexp_replace(e.action, '[^A-Za-z0-9]+', '_', 'g')),
            occurred_at = e.created_at,
            source_type = CASE WHEN e.source_document IS NULL THEN NULL ELSE 'LEGACY_SOURCE_DOCUMENT' END,
            source_id = e.source_document,
            old_context = CASE WHEN e.before_state IS NULL THEN NULL ELSE jsonb_build_object('legacy_state', e.before_state) END,
            new_context = CASE WHEN e.after_state IS NULL THEN NULL ELSE jsonb_build_object('legacy_state', e.after_state) END,
            notes = e.note,
            device_id = e.device
        FROM assets a
        WHERE a.id = e.asset_id
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO transfer_items (id, transfer_id, asset_id, company_id, from_branch_id, to_branch_id, status, dispatched_at, dispatched_by, received_at, received_by, created_at, updated_at)
        SELECT
          'IMTRANSFER-' || substr(md5(t.id || ':' || j.asset_id), 1, 21),
          t.id,
          j.asset_id,
          t.company_id,
          t.from_branch_id,
          t.to_branch_id,
          upper(t.status::text),
          CASE WHEN t.approved_at ~ '^\\d{4}-\\d{2}-\\d{2}' THEN t.approved_at::timestamptz ELSE NULL END,
          t.approved_by,
          CASE WHEN t.received_at ~ '^\\d{4}-\\d{2}-\\d{2}' THEN t.received_at::timestamptz ELSE NULL END,
          t.received_by,
          t.created_at,
          t.updated_at
        FROM transfers t
        CROSS JOIN LATERAL jsonb_array_elements_text(t.asset_ids) j(asset_id)
        JOIN assets a ON a.id = j.asset_id AND a.company_id = t.company_id
        WHERE t.from_branch_id IS NOT NULL AND t.to_branch_id IS NOT NULL
        ON CONFLICT (transfer_id, asset_id) DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO inventory_asset_movements (id, asset_id, company_id, movement_type, from_branch_id, to_branch_id, source_type, source_id, occurred_at, operator_id, created_at)
        SELECT
          'IMMOVE-' || substr(md5(sm.id), 1, 27),
          sm.asset_id,
          sm.company_id,
          upper(sm.type),
          sm.branch_id,
          sm.branch_id,
          coalesce(sm.reference_type, 'LEGACY_STOCK_MOVEMENT'),
          coalesce(sm.reference_id, sm.id),
          sm.created_at,
          sm.created_by,
          CURRENT_TIMESTAMP
        FROM stock_movements sm
        JOIN assets a ON a.id = sm.asset_id AND a.company_id = sm.company_id
        WHERE sm.asset_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `, { transaction });

      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM assets WHERE inventory_profile IS NULL) THEN
            RAISE EXCEPTION 'INVENTORY_PROFILE_BACKFILL_AMBIGUOUS';
          END IF;
          IF EXISTS (SELECT 1 FROM assets WHERE operational_status IS NULL) THEN
            RAISE EXCEPTION 'INVENTORY_STATUS_BACKFILL_AMBIGUOUS';
          END IF;
          IF EXISTS (SELECT 1 FROM assets WHERE branch_id IS NULL AND operational_status IS NOT NULL) THEN
            RAISE EXCEPTION 'INVENTORY_BRANCH_BACKFILL_AMBIGUOUS';
          END IF;
          IF EXISTS (SELECT 1 FROM (SELECT barcode FROM assets GROUP BY barcode HAVING count(*) > 1) d) THEN
            RAISE EXCEPTION 'INVENTORY_GLOBAL_BARCODE_DUPLICATES_EXIST';
          END IF;
        END $$
      `, { transaction });

      await queryInterface.sequelize.query("ALTER TABLE assets ALTER COLUMN inventory_profile SET NOT NULL", { transaction });
      await queryInterface.sequelize.query("ALTER TABLE assets ALTER COLUMN operational_status SET NOT NULL", { transaction });
      await queryInterface.sequelize.query("ALTER TABLE assets ADD CONSTRAINT assets_operational_status_ck CHECK (operational_status IN ('AVAILABLE','RESERVED','PENDING_TRANSFER','WORKSHOP','RETURNED','MISSING','MELTED','SOLD'))", { transaction });
      await queryInterface.sequelize.query("ALTER TABLE assets ADD CONSTRAINT assets_condition_profile_ck CHECK (condition IS NULL OR condition IN ('NEW','USED'))", { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE assets ADD CONSTRAINT assets_condition_registry_ck CHECK (
        (inventory_profile IN ('GOLD_BAR_24K','CGP_CUSTOMER_GOLD_PURCHASE') AND condition IS NULL) OR
        (inventory_profile = 'GOLD_BY_PIECE' AND condition IS NOT NULL AND condition IN ('NEW','USED')) OR
        (inventory_profile NOT IN ('GOLD_BAR_24K','CGP_CUSTOMER_GOLD_PURCHASE','GOLD_BY_PIECE') AND (condition IS NULL OR condition IN ('NEW','USED')))
      )`, { transaction });
      await queryInterface.sequelize.query("ALTER TABLE assets ADD CONSTRAINT assets_tag_state_ck CHECK (tag_state IS NULL OR tag_state IN ('PENDING','PRINTED'))", { transaction });
      await queryInterface.sequelize.query("ALTER TABLE assets ADD CONSTRAINT assets_operational_branch_required_ck CHECK (operational_status IS NULL OR branch_id IS NOT NULL)", { transaction });
      await queryInterface.sequelize.query("ALTER TABLE assets VALIDATE CONSTRAINT assets_inventory_profile_ck", { transaction });

      await queryInterface.sequelize.query(`
        CREATE OR REPLACE FUNCTION inventory_legacy_asset_compatibility_guard() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'INSERT' OR NEW.type IS DISTINCT FROM OLD.type OR NEW.inventory_subtype IS DISTINCT FROM OLD.inventory_subtype OR NEW.karat IS DISTINCT FROM OLD.karat OR NEW.source IS DISTINCT FROM OLD.source THEN
            NEW.inventory_profile := CASE
              WHEN NEW.source = 'customer_gold_purchase' THEN 'CGP_CUSTOMER_GOLD_PURCHASE'
              WHEN NEW.type = 'gold-weight' AND NEW.karat = 24 AND coalesce(NEW.inventory_subtype, '') ~* 'bar|سبائك|سبيكة' THEN 'GOLD_BAR_24K'
              WHEN NEW.type = 'gold-weight' THEN 'GOLD_BY_WEIGHT_JEWELLERY'
              WHEN NEW.type = 'gold-piece' THEN 'GOLD_BY_PIECE'
              WHEN NEW.type = 'diamond' AND coalesce(NEW.inventory_subtype, '') ~* 'loose|فص' THEN 'LOOSE_DIAMOND'
              WHEN NEW.type = 'diamond' THEN 'DIAMOND_JEWELLERY'
              WHEN NEW.type = 'gemstone' AND coalesce(NEW.inventory_subtype, '') ~* 'loose|فص' THEN 'LOOSE_GEMSTONE'
              WHEN NEW.type = 'gemstone' THEN 'GEMSTONE_JEWELLERY'
              WHEN NEW.type = 'pearl' AND coalesce(NEW.inventory_subtype, '') ~* 'loose|لؤلؤة' THEN 'LOOSE_PEARL'
              WHEN NEW.type = 'pearl' THEN 'PEARL_JEWELLERY'
              ELSE NEW.inventory_profile
            END;
          END IF;
          IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
            NEW.operational_status := CASE NEW.status::text
              WHEN 'available' THEN 'AVAILABLE' WHEN 'reserved' THEN 'RESERVED'
              WHEN 'pending_transfer' THEN 'PENDING_TRANSFER' WHEN 'transferred' THEN 'PENDING_TRANSFER'
              WHEN 'repair' THEN 'WORKSHOP' WHEN 'in_workshop' THEN 'WORKSHOP'
              WHEN 'returned' THEN 'RETURNED' WHEN 'melted' THEN 'MELTED'
              WHEN 'sold' THEN 'SOLD' ELSE NEW.operational_status
            END;
          END IF;
          IF TG_OP = 'INSERT' THEN
            NEW.condition := coalesce(NEW.condition, upper(nullif(NEW.metadata->>'condition', '')));
            NEW.condition_classification := coalesce(NEW.condition_classification, CASE WHEN NEW.condition IS NULL THEN 'LEGACY_CONDITION_UNKNOWN' ELSE 'SOURCE_METADATA_PROVEN' END);
            NEW.tag_state := coalesce(NEW.tag_state, 'PENDING');
            NEW.tag_state_classification := coalesce(NEW.tag_state_classification, 'NEW_ASSET_PENDING_PRINT');
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER assets_legacy_inventory_compatibility_trg
          BEFORE INSERT OR UPDATE OF type, inventory_subtype, karat, source, status ON assets
          FOR EACH ROW EXECUTE FUNCTION inventory_legacy_asset_compatibility_guard();
      `, { transaction });

      await queryInterface.sequelize.query(`
        CREATE OR REPLACE FUNCTION inventory_asset_identity_guard() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'INVENTORY_ASSET_HARD_DELETE_FORBIDDEN';
          END IF;
          IF NEW.barcode IS DISTINCT FROM OLD.barcode THEN
            RAISE EXCEPTION 'INVENTORY_ASSET_BARCODE_IMMUTABLE';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER assets_barcode_immutable_trg BEFORE UPDATE OF barcode ON assets
          FOR EACH ROW EXECUTE FUNCTION inventory_asset_identity_guard();
        CREATE TRIGGER assets_hard_delete_forbidden_trg BEFORE DELETE ON assets
          FOR EACH ROW EXECUTE FUNCTION inventory_asset_identity_guard();
      `, { transaction });

      await queryInterface.sequelize.query(`
        CREATE OR REPLACE FUNCTION inventory_evidence_immutable_guard() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'INVENTORY_EVIDENCE_IMMUTABLE:%', TG_TABLE_NAME;
        END;
        $$ LANGUAGE plpgsql;
      `, { transaction });
      for (const table of [
        "asset_events",
        "asset_origins",
        "asset_purchase_cost_revisions",
        "rfid_scan_events",
        "asset_tag_print_events",
        "inventory_asset_movements",
      ]) {
        await queryInterface.sequelize.query(`CREATE TRIGGER ${table}_immutable_trg BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION inventory_evidence_immutable_guard()`, { transaction });
      }
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: compatibility classifications and backfilled evidence require restoring the verified pre-rehearsal backup");
  },
};
