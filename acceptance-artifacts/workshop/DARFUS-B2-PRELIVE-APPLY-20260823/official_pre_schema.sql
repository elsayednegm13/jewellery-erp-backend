--
-- PostgreSQL database dump
--

\restrict aoRGM0UMPTKANgcb1pSnEavroaxW2Qh2n1oX23Jh9TeYaF4oecTYBrHHHzbGGcv

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: enum_accounts_nature; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_accounts_nature AS ENUM (
    'debit',
    'credit'
);


--
-- Name: enum_accounts_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_accounts_type AS ENUM (
    'asset',
    'liability',
    'equity',
    'revenue',
    'expense'
);


--
-- Name: enum_approval_requests_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_approval_requests_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'expired'
);


--
-- Name: enum_approval_requests_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_approval_requests_type AS ENUM (
    'discount',
    'price-override',
    'transfer',
    'adjustment',
    'cgp',
    'period-close',
    'reverse-charge',
    'financial-operation'
);


--
-- Name: enum_asset_events_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_asset_events_severity AS ENUM (
    'info',
    'warning',
    'critical'
);


--
-- Name: enum_assets_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_assets_status AS ENUM (
    'available',
    'reserved',
    'sold',
    'repair',
    'transferred',
    'melted',
    'archived',
    'pending_transfer',
    'returned',
    'in_workshop',
    'pending_tag',
    'pending_integration',
    'reversal_pending',
    'reversed'
);


--
-- Name: enum_assets_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_assets_type AS ENUM (
    'gold-piece',
    'gold-weight',
    'diamond',
    'gemstone',
    'pearl',
    'watch'
);


--
-- Name: enum_attendance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_attendance_status AS ENUM (
    'present',
    'absent',
    'leave',
    'late',
    'holiday'
);


--
-- Name: enum_audit_logs_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_audit_logs_severity AS ENUM (
    'info',
    'warning',
    'critical'
);


--
-- Name: enum_branches_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_branches_type AS ENUM (
    'store',
    'warehouse',
    'factory'
);


--
-- Name: enum_cash_transactions_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_cash_transactions_status AS ENUM (
    'posted',
    'draft',
    'approved'
);


--
-- Name: enum_cash_transactions_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_cash_transactions_type AS ENUM (
    'cash_in',
    'cash_out',
    'transfer',
    'closing'
);


--
-- Name: enum_customer_gold_pools_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_customer_gold_pools_status AS ENUM (
    'pending-assay',
    'assayed',
    'approved',
    'transferred',
    'rejected'
);


--
-- Name: enum_customer_gold_purchase_documents_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_customer_gold_purchase_documents_status AS ENUM (
    'draft',
    'validated',
    'submitted',
    'approved'
);


--
-- Name: enum_customers_aml_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_customers_aml_status AS ENUM (
    'clear',
    'review',
    'flagged'
);


--
-- Name: enum_customers_kyc_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_customers_kyc_status AS ENUM (
    'verified',
    'pending',
    'flagged',
    'not-started'
);


--
-- Name: enum_customers_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_customers_status AS ENUM (
    'active',
    'inactive'
);


--
-- Name: enum_customers_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_customers_tier AS ENUM (
    'VIP',
    'Gold',
    'Standard'
);


--
-- Name: enum_employee_verification_attempts_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_employee_verification_attempts_result AS ENUM (
    'success',
    'failure'
);


--
-- Name: enum_employees_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_employees_status AS ENUM (
    'present',
    'leave',
    'inactive'
);


--
-- Name: enum_employees_system_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_employees_system_role AS ENUM (
    'admin',
    'owner',
    'manager',
    'accountant',
    'sales'
);


--
-- Name: enum_gift_vouchers_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_gift_vouchers_status AS ENUM (
    'active',
    'redeemed',
    'expired'
);


--
-- Name: enum_gold_fixings_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_gold_fixings_direction AS ENUM (
    'buy',
    'sell'
);


--
-- Name: enum_gold_fixings_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_gold_fixings_status AS ENUM (
    'fixed',
    'unfixed',
    'settled'
);


--
-- Name: enum_gold_purchase_approval_requests_aggregate_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_gold_purchase_approval_requests_aggregate_type AS ENUM (
    'cgp',
    'igp'
);


--
-- Name: enum_gold_purchase_approval_requests_approval_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_gold_purchase_approval_requests_approval_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'superseded'
);


--
-- Name: enum_installments_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_installments_status AS ENUM (
    'pending',
    'paid',
    'overdue',
    'partial'
);


--
-- Name: enum_inventory_gold_pools_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_inventory_gold_pools_status AS ENUM (
    'available',
    'allocated',
    'consumed',
    'returned'
);


--
-- Name: enum_investment_gold_purchase_documents_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_investment_gold_purchase_documents_status AS ENUM (
    'draft',
    'validated',
    'submitted',
    'approved'
);


--
-- Name: enum_investment_gold_purchase_items_bullion_identity_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_investment_gold_purchase_items_bullion_identity_type AS ENUM (
    'serialized_unit',
    'bullion_lot'
);


--
-- Name: enum_investment_gold_purchase_items_investment_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_investment_gold_purchase_items_investment_type AS ENUM (
    'physical',
    'bullion'
);


--
-- Name: enum_invoices_posting_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_invoices_posting_status AS ENUM (
    'draft',
    'posted',
    'cancelled'
);


--
-- Name: enum_invoices_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_invoices_status AS ENUM (
    'paid',
    'partial',
    'due',
    'returned',
    'cancelled'
);


--
-- Name: enum_invoices_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_invoices_type AS ENUM (
    'sale',
    'return',
    'exchange',
    'deposit',
    'repair',
    'installment',
    'giftVoucher'
);


--
-- Name: enum_journal_entries_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_journal_entries_status AS ENUM (
    'draft',
    'balanced',
    'posted',
    'pending',
    'reversed'
);


--
-- Name: enum_loyalty_transactions_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_loyalty_transactions_type AS ENUM (
    'earn',
    'redeem',
    'adjust'
);


--
-- Name: enum_manufacturing_orders_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_manufacturing_orders_status AS ENUM (
    'draft',
    'approved',
    'in-process',
    'completed',
    'cancelled'
);


--
-- Name: enum_manufacturing_orders_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_manufacturing_orders_type AS ENUM (
    'melting',
    'manufacturing',
    'conversion'
);


--
-- Name: enum_notifications_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_notifications_type AS ENUM (
    'info',
    'success',
    'warning',
    'error',
    'approval',
    'system'
);


--
-- Name: enum_payslips_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_payslips_status AS ENUM (
    'draft',
    'approved',
    'paid'
);


--
-- Name: enum_purchase_orders_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_purchase_orders_status AS ENUM (
    'draft',
    'sent',
    'partial',
    'received',
    'cancelled'
);


--
-- Name: enum_reservation_amendment_items_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reservation_amendment_items_action AS ENUM (
    'added',
    'removed',
    'replaced_out',
    'replaced_in',
    'repriced'
);


--
-- Name: enum_reservation_amendments_amendment_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reservation_amendments_amendment_type AS ENUM (
    'add_items',
    'remove_items',
    'replace_items',
    'reprice_items',
    'mixed'
);


--
-- Name: enum_reservation_items_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reservation_items_status AS ENUM (
    'active',
    'released',
    'sold'
);


--
-- Name: enum_reservation_payment_transfers_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reservation_payment_transfers_status AS ENUM (
    'posted',
    'reversed'
);


--
-- Name: enum_reservation_payments_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reservation_payments_status AS ENUM (
    'posted',
    'reversed',
    'refunded',
    'transferred'
);


--
-- Name: enum_reservation_refunds_refund_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reservation_refunds_refund_type AS ENUM (
    'reservation_full',
    'renewal_excess'
);


--
-- Name: enum_reservation_refunds_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reservation_refunds_status AS ENUM (
    'requested',
    'approved',
    'rejected',
    'executed'
);


--
-- Name: enum_reservation_renewals_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reservation_renewals_status AS ENUM (
    'requested',
    'pending_excess_refund',
    'ready_to_activate',
    'activated',
    'rejected',
    'cancelled'
);


--
-- Name: enum_reservations_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reservations_status AS ENUM (
    'active',
    'expired',
    'completed',
    'cancelled',
    'partially_paid',
    'fully_paid',
    'cancelled_refund_pending',
    'refunded',
    'pending_renewal_settlement',
    'renewed'
);


--
-- Name: enum_stock_audit_items_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_stock_audit_items_status AS ENUM (
    'matched',
    'missing',
    'unexpected'
);


--
-- Name: enum_stock_audits_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_stock_audits_status AS ENUM (
    'in-progress',
    'completed',
    'cancelled',
    'draft',
    'closed'
);


--
-- Name: enum_supplier_consignments_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_supplier_consignments_status AS ENUM (
    'available',
    'sold',
    'returned'
);


--
-- Name: enum_suppliers_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_suppliers_status AS ENUM (
    'active',
    'inactive'
);


--
-- Name: enum_transfers_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_transfers_status AS ENUM (
    'pending',
    'approved',
    'in-transit',
    'received',
    'cancelled'
);


--
-- Name: enum_users_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_users_role AS ENUM (
    'admin',
    'owner',
    'manager',
    'accountant',
    'sales'
);


--
-- Name: inventory_asset_barcode_history_insert_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_asset_barcode_history_insert_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
          INSERT INTO asset_barcode_history
            (id,asset_id,company_id,barcode,barcode_revision,state,action,issued_at,issued_by,source_type,source_id,created_at,updated_at)
          VALUES
            ('ABH-INITIAL-' || NEW.id,NEW.id,NEW.company_id,btrim(NEW.barcode),GREATEST(COALESCE(NEW.barcode_revision,1),1),'ACTIVE','INITIAL',COALESCE(NEW.barcode_generated_at,NEW.created_at,CURRENT_TIMESTAMP),NEW.created_by,'ASSET_CREATE',NEW.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
          RETURN NEW;
        END;
        $$;


--
-- Name: inventory_asset_identity_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_asset_identity_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'INVENTORY_ASSET_HARD_DELETE_FORBIDDEN';
          END IF;
          IF NEW.barcode IS DISTINCT FROM OLD.barcode
             AND current_setting('darfus.inventory_barcode_replacement', true) <> 'approved' THEN
            RAISE EXCEPTION 'INVENTORY_ASSET_BARCODE_IMMUTABLE';
          END IF;
          RETURN NEW;
        END;
        $$;


--
-- Name: inventory_evidence_immutable_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_evidence_immutable_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
          RAISE EXCEPTION 'INVENTORY_EVIDENCE_IMMUTABLE:%', TG_TABLE_NAME;
        END;
        $$;


--
-- Name: inventory_legacy_asset_compatibility_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_legacy_asset_compatibility_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
        $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: SequelizeMeta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SequelizeMeta" (
    name character varying(255) NOT NULL
);


--
-- Name: accounting_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_locks (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    locked_through_date date,
    reason text,
    updated_by_user_id character varying(255),
    updated_by_name character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    code character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    name_ar character varying(255) NOT NULL,
    type public.enum_accounts_type NOT NULL,
    nature public.enum_accounts_nature NOT NULL,
    parent_id character varying(255),
    balance numeric(20,8) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true,
    level integer DEFAULT 1,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    branch_id character varying(255),
    is_posting boolean DEFAULT true NOT NULL,
    statement_classification character varying(255),
    bootstrap_version integer
);


--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    type public.enum_approval_requests_type NOT NULL,
    requested_by character varying(255) NOT NULL,
    requested_at character varying(255) NOT NULL,
    branch character varying(255) NOT NULL,
    description text NOT NULL,
    amount numeric(20,8),
    status public.enum_approval_requests_status DEFAULT 'pending'::public.enum_approval_requests_status,
    reviewed_by character varying(255),
    reviewed_at character varying(255),
    reason character varying(255),
    related_id character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    policy_id character varying(255),
    operation_type character varying(64),
    subject_type character varying(64),
    subject_id character varying(255),
    branch_id character varying(255),
    currency character varying(3),
    payment_method character varying(32),
    idempotency_key character varying(191),
    request_context_snapshot jsonb,
    policy_decision_snapshot jsonb
);


--
-- Name: asset_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_attachments (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    url character varying(255),
    uploaded_at character varying(255) NOT NULL,
    uploaded_by character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: asset_barcode_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_barcode_history (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    barcode character varying(255) NOT NULL,
    barcode_revision integer NOT NULL,
    state character varying(16) NOT NULL,
    action character varying(16) NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    issued_by character varying(255),
    retired_at timestamp with time zone,
    retired_by character varying(255),
    retirement_reason text,
    source_type character varying(48),
    source_id character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT asset_barcode_history_action_ck CHECK (((action)::text = ANY ((ARRAY['INITIAL'::character varying, 'REPLACEMENT'::character varying])::text[]))),
    CONSTRAINT asset_barcode_history_revision_ck CHECK ((barcode_revision >= 1)),
    CONSTRAINT asset_barcode_history_state_ck CHECK (((state)::text = ANY ((ARRAY['ACTIVE'::character varying, 'RETIRED'::character varying])::text[])))
);


--
-- Name: asset_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_certificates (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    issuer character varying(255) NOT NULL,
    issue_date character varying(255) NOT NULL,
    expiry_date character varying(255),
    certificate_number character varying(255) NOT NULL,
    url character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: asset_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_components (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    role character varying(24) NOT NULL,
    component_kind character varying(24) NOT NULL,
    sequence integer NOT NULL,
    component_count integer DEFAULT 1 NOT NULL,
    component_weight numeric(20,8),
    component_carat numeric(20,8),
    measurement_unit character varying(24),
    name character varying(160),
    component_type character varying(160),
    purchase_cost numeric(20,8),
    current_value numeric(20,8),
    certificate_id character varying(255),
    notes text,
    mapping_classification character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT asset_components_semantics_ck CHECK ((((role)::text = ANY ((ARRAY['EMBEDDED'::character varying, 'PRIMARY_SUBJECT'::character varying])::text[])) AND ((component_kind)::text = ANY ((ARRAY['DIAMOND'::character varying, 'GEMSTONE'::character varying, 'PEARL'::character varying, 'OTHER'::character varying])::text[])) AND (sequence >= 0) AND (component_count >= 1) AND (((role)::text <> 'PRIMARY_SUBJECT'::text) OR (component_count = 1)) AND ((component_weight IS NULL) OR (component_weight >= (0)::numeric)) AND ((component_carat IS NULL) OR (component_carat >= (0)::numeric))))
);


--
-- Name: asset_current_valuations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_current_valuations (
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    rate_source character varying(32) NOT NULL,
    gold_rate numeric(20,8),
    gold_value numeric(20,8),
    making_value numeric(20,8),
    certificate_value numeric(20,8),
    component_value numeric(20,8),
    vat_rate numeric(9,6),
    vat_rate_source character varying(32),
    vat_base numeric(20,8),
    vat_amount numeric(20,8),
    total_value numeric(20,8) NOT NULL,
    as_of timestamp with time zone NOT NULL,
    input_version integer DEFAULT 1 NOT NULL,
    override_reason text,
    override_by character varying(255),
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: asset_diamond_component_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_diamond_component_details (
    component_id character varying(255) NOT NULL,
    treatment character varying(160),
    color character varying(160),
    tone character varying(160),
    saturation character varying(160),
    clarity character varying(160),
    cut character varying(160),
    shape character varying(160),
    origin character varying(160),
    "position" character varying(160),
    setting character varying(160),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: asset_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_events (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    action character varying(255) NOT NULL,
    date character varying(255) NOT NULL,
    "user" character varying(255) NOT NULL,
    branch character varying(255) NOT NULL,
    note text,
    device character varying(255),
    reason character varying(255),
    source_document character varying(255),
    before_state character varying(255),
    after_state character varying(255),
    correlation_id character varying(255),
    severity public.enum_asset_events_severity DEFAULT 'info'::public.enum_asset_events_severity,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    company_id character varying(255),
    branch_id character varying(255),
    event_type character varying(48),
    occurred_at timestamp with time zone,
    user_id character varying(255),
    employee_code character varying(255),
    employee_name character varying(255),
    operator_session_id character varying(255),
    device_id character varying(255),
    source_type character varying(48),
    source_id character varying(255),
    old_context jsonb,
    new_context jsonb,
    notes text,
    idempotency_key character varying(128)
);


--
-- Name: asset_gemstone_component_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_gemstone_component_details (
    component_id character varying(255) NOT NULL,
    shape character varying(160),
    color character varying(160),
    tone character varying(160),
    tone_level character varying(160),
    saturation character varying(160),
    optical_effect character varying(160),
    origin character varying(160),
    "position" character varying(160),
    setting character varying(160),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    treatment character varying(160)
);


--
-- Name: asset_gemstone_component_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_gemstone_component_settings (
    id character varying(255) NOT NULL,
    component_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    master_data_id character varying(255) NOT NULL,
    sequence integer NOT NULL,
    value_snapshot character varying(160) NOT NULL,
    label_snapshot character varying(160) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_gold_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_gold_details (
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    weight_unit character varying(8) DEFAULT 'GRAM'::character varying NOT NULL,
    gross_weight numeric(20,8),
    stone_weight numeric(20,8),
    net_gold_weight numeric(20,8),
    karat numeric(9,6),
    purity_ratio numeric(20,8),
    pure_gold_9999 numeric(20,8),
    pure_gold_995 numeric(20,8),
    mapping_classification character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT asset_gold_details_values_ck CHECK ((((weight_unit)::text = 'GRAM'::text) AND ((gross_weight IS NULL) OR (gross_weight >= (0)::numeric)) AND ((stone_weight IS NULL) OR (stone_weight >= (0)::numeric)) AND ((net_gold_weight IS NULL) OR (net_gold_weight >= (0)::numeric)) AND ((karat IS NULL) OR ((karat > (0)::numeric) AND (karat <= (24)::numeric))) AND ((pure_gold_9999 IS NULL) OR (pure_gold_9999 >= (0)::numeric)) AND ((pure_gold_995 IS NULL) OR (pure_gold_995 >= (0)::numeric))))
);


--
-- Name: asset_lineage_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_lineage_links (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    parent_asset_id character varying(255) NOT NULL,
    child_asset_id character varying(255) NOT NULL,
    relation_type character varying(32) NOT NULL,
    source_type character varying(48) NOT NULL,
    source_id character varying(255) NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT asset_lineage_not_self_ck CHECK (((parent_asset_id)::text <> (child_asset_id)::text))
);


--
-- Name: asset_missing_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_missing_cases (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    status character varying(16) NOT NULL,
    prior_operational_status character varying(24) NOT NULL,
    prior_location_id character varying(255),
    discovered_at timestamp with time zone NOT NULL,
    discovered_by character varying(255),
    reason text NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by character varying(255),
    resolution_code character varying(32),
    resolution_notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: asset_origins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_origins (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    origin_type character varying(40) NOT NULL,
    purchase_order_item_id character varying(255),
    cgp_item_id character varying(255),
    legacy_product_id character varying(255),
    manufacturing_order_id character varying(255),
    received_at timestamp with time zone,
    received_by character varying(255),
    mapping_classification character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT asset_origins_type_ck CHECK (((origin_type)::text = ANY ((ARRAY['PURCHASE_ORDER'::character varying, 'CGP'::character varying, 'CUSTOMER_GOLD_PURCHASE'::character varying, 'LEGACY_PRODUCT'::character varying, 'MANUFACTURING_OUTPUT'::character varying, 'LEGACY_UNKNOWN'::character varying])::text[])))
);


--
-- Name: asset_pearl_component_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_pearl_component_details (
    component_id character varying(255) NOT NULL,
    size character varying(160),
    pearl_type character varying(160),
    color character varying(160),
    overtone character varying(160),
    orient character varying(160),
    shape character varying(160),
    luster character varying(160),
    surface_quality character varying(160),
    nacre_quality character varying(160),
    origin character varying(160),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    pearl_size_master_data_id character varying(255)
);


--
-- Name: asset_pricing_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_pricing_policies (
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    strategy_code character varying(48) NOT NULL,
    strategy_version integer DEFAULT 1 NOT NULL,
    selling_making_per_gram numeric(20,8),
    minimum_making_per_gram numeric(20,8),
    certificate_charge numeric(20,8),
    minimum_certificate_charge numeric(20,8),
    markup_percent numeric(9,6),
    maximum_discount_percent numeric(9,6),
    minimum_selling_price numeric(20,8),
    manual_price_allowed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT asset_pricing_strategy_ck CHECK (((strategy_code)::text = ANY ((ARRAY['WEIGHT_BASED_MAKING_STRATEGY'::character varying, 'BAR_CERTIFICATE_STRATEGY'::character varying, 'PIECE_MARKUP_STRATEGY'::character varying, 'DIAMOND_PROFILE_STRATEGY'::character varying, 'GEMSTONE_PROFILE_STRATEGY'::character varying, 'PEARL_PROFILE_STRATEGY'::character varying, 'LOOSE_ASSET_STRATEGY'::character varying])::text[])))
);


--
-- Name: asset_profile_master_data_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_profile_master_data_references (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    category_key character varying(64) NOT NULL,
    master_data_id character varying(255) NOT NULL,
    value_snapshot character varying(160) NOT NULL,
    label_snapshot character varying(160) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_purchase_cost_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_purchase_cost_revisions (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    revision_no integer NOT NULL,
    currency character varying(8),
    purchase_gold_rate numeric(20,8),
    gold_rate_source character varying(40),
    gold_value numeric(20,8),
    making_per_gram numeric(20,8),
    making_total numeric(20,8),
    certificate_cost numeric(20,8),
    component_cost numeric(20,8),
    vat_enabled boolean,
    vat_rate numeric(9,6),
    vat_rate_source character varying(40),
    vat_base numeric(20,8),
    vat_amount numeric(20,8),
    total_purchase_cost numeric(20,8) NOT NULL,
    supplier_id character varying(255),
    purchase_date date,
    purchase_order_item_id character varying(255),
    cgp_item_id character varying(255),
    supersedes_id character varying(255),
    is_current boolean DEFAULT true NOT NULL,
    override_reason text,
    created_by character varying(255),
    provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    mapping_classification character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT asset_purchase_cost_values_ck CHECK (((revision_no >= 1) AND (total_purchase_cost >= (0)::numeric) AND ((vat_rate IS NULL) OR ((vat_rate >= (0)::numeric) AND (vat_rate <= (100)::numeric)))))
);


--
-- Name: asset_return_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_return_reviews (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    return_invoice_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    condition_outcome character varying(32) NOT NULL,
    note text,
    reviewed_by character varying(255) NOT NULL,
    reviewed_at timestamp with time zone NOT NULL,
    approved_by character varying(255),
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: asset_rfid_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_rfid_assignments (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    rfid_number character varying(128) NOT NULL,
    status character varying(16) NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    assigned_at timestamp with time zone NOT NULL,
    assigned_by character varying(255),
    ended_at timestamp with time zone,
    ended_by character varying(255),
    replacement_reason text,
    mapping_classification character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT asset_rfid_status_ck CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'REPLACED'::character varying, 'MISSING'::character varying])::text[])))
);


--
-- Name: asset_tag_print_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_tag_print_events (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    print_kind character varying(16) NOT NULL,
    template_name character varying(120),
    template_version character varying(40),
    printer_name character varying(160),
    device_id character varying(255),
    operator_id character varying(255),
    operator_name character varying(255),
    reason text,
    printed_at timestamp with time zone NOT NULL,
    result character varying(24) NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT asset_tag_print_kind_ck CHECK (((print_kind)::text = ANY ((ARRAY['INITIAL'::character varying, 'REPRINT'::character varying])::text[])))
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    type public.enum_assets_type NOT NULL,
    category character varying(255) NOT NULL,
    karat integer,
    purity numeric(10,8),
    gross_weight numeric(20,8) NOT NULL,
    net_weight numeric(20,8) NOT NULL,
    gold_weight numeric(20,8),
    price numeric(20,8) NOT NULL,
    cost numeric(20,8) NOT NULL,
    branch character varying(255) NOT NULL,
    location character varying(255) NOT NULL,
    status public.enum_assets_status DEFAULT 'available'::public.enum_assets_status,
    barcode character varying(255) NOT NULL,
    rfid character varying(255),
    source character varying(255),
    parent_asset_id character varying(255),
    child_asset_ids jsonb DEFAULT '[]'::jsonb,
    stones integer DEFAULT 0,
    stone_details jsonb DEFAULT '[]'::jsonb,
    pearls integer DEFAULT 0,
    pearl_details jsonb DEFAULT '[]'::jsonb,
    notes text,
    manufacturing_order_id character varying(255),
    contribution_weight numeric(20,8),
    process_loss numeric(20,8),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    branch_id character varying(255),
    gold_price_snapshot numeric(15,4),
    gold_price_source character varying(255),
    gold_price_karat character varying(255),
    gold_price_at timestamp with time zone,
    computed_gold_cost numeric(15,4),
    final_purchase_cost numeric(15,4),
    cost_source character varying(255) DEFAULT 'manual'::character varying NOT NULL,
    cost_overridden boolean DEFAULT false NOT NULL,
    override_reason text,
    override_by character varying(255),
    override_at timestamp with time zone,
    net_gold_weight numeric(15,4),
    inventory_code character varying(6),
    item_code character varying(6),
    karat_code character varying(2),
    barcode_serial integer,
    barcode_generated_at timestamp with time zone,
    barcode_revision integer DEFAULT 1,
    inventory_subtype character varying(60),
    metadata_schema_version integer,
    metadata jsonb,
    location_id character varying(255),
    inventory_profile character varying(40) NOT NULL,
    operational_status character varying(24) NOT NULL,
    condition character varying(8),
    condition_classification character varying(48),
    tag_state character varying(8),
    tag_state_classification character varying(48),
    description text,
    brand character varying(160),
    model character varying(160),
    model_number character varying(160),
    supplier_id character varying(255),
    purchase_date date,
    created_by character varying(255),
    updated_by character varying(255),
    retired_at timestamp with time zone,
    retired_by character varying(255),
    retirement_reason text,
    CONSTRAINT assets_condition_profile_ck CHECK (((condition IS NULL) OR ((condition)::text = ANY ((ARRAY['NEW'::character varying, 'USED'::character varying])::text[])))),
    CONSTRAINT assets_condition_registry_ck CHECK (((((inventory_profile)::text = ANY ((ARRAY['GOLD_BAR_24K'::character varying, 'CGP_CUSTOMER_GOLD_PURCHASE'::character varying])::text[])) AND (condition IS NULL)) OR (((inventory_profile)::text = 'GOLD_BY_PIECE'::text) AND (condition IS NOT NULL) AND ((condition)::text = ANY ((ARRAY['NEW'::character varying, 'USED'::character varying])::text[]))) OR (((inventory_profile)::text <> ALL ((ARRAY['GOLD_BAR_24K'::character varying, 'CGP_CUSTOMER_GOLD_PURCHASE'::character varying, 'GOLD_BY_PIECE'::character varying])::text[])) AND ((condition IS NULL) OR ((condition)::text = ANY ((ARRAY['NEW'::character varying, 'USED'::character varying])::text[])))))),
    CONSTRAINT assets_inventory_profile_ck CHECK (((inventory_profile IS NULL) OR ((inventory_profile)::text = ANY ((ARRAY['GOLD_BY_WEIGHT_JEWELLERY'::character varying, 'GOLD_BAR_24K'::character varying, 'GOLD_BY_PIECE'::character varying, 'DIAMOND_JEWELLERY'::character varying, 'LOOSE_DIAMOND'::character varying, 'GEMSTONE_JEWELLERY'::character varying, 'LOOSE_GEMSTONE'::character varying, 'PEARL_JEWELLERY'::character varying, 'LOOSE_PEARL'::character varying, 'CGP_CUSTOMER_GOLD_PURCHASE'::character varying])::text[])))),
    CONSTRAINT assets_operational_branch_required_ck CHECK (((operational_status IS NULL) OR (branch_id IS NOT NULL))),
    CONSTRAINT assets_operational_status_ck CHECK (((operational_status)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'PENDING_INTEGRATION'::character varying, 'RESERVED'::character varying, 'PENDING_TRANSFER'::character varying, 'WORKSHOP'::character varying, 'RETURNED'::character varying, 'MISSING'::character varying, 'MELTED'::character varying, 'SOLD'::character varying, 'REVERSAL_PENDING'::character varying, 'REVERSED'::character varying])::text[]))),
    CONSTRAINT assets_tag_state_ck CHECK (((tag_state IS NULL) OR ((tag_state)::text = ANY ((ARRAY['PENDING'::character varying, 'PRINTED'::character varying])::text[]))))
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    employee_name character varying(255),
    date character varying(255) NOT NULL,
    check_in character varying(255),
    check_out character varying(255),
    hours numeric(6,2) DEFAULT 0,
    status public.enum_attendance_status DEFAULT 'present'::public.enum_attendance_status,
    branch character varying(255),
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    action character varying(255) NOT NULL,
    description text NOT NULL,
    "user" character varying(255) NOT NULL,
    user_id character varying(255),
    place character varying(255) NOT NULL,
    branch character varying(255),
    date character varying(255) NOT NULL,
    before text,
    after text,
    device character varying(255),
    correlation_id character varying(255),
    source_document character varying(255),
    severity public.enum_audit_logs_severity DEFAULT 'info'::public.enum_audit_logs_severity,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    hash character varying(255),
    prev_hash character varying(255),
    branch_id character varying(255),
    technical_user_id character varying(255),
    employee_id character varying(255),
    employee_code_snapshot character varying(64),
    employee_name_snapshot character varying(160),
    operator_session_id character varying(255),
    device_session_id character varying(128),
    verification_level integer,
    level_2_verified_at timestamp with time zone,
    required_permission character varying(160),
    requested_operation character varying(160),
    authorization_result character varying(40),
    authorization_failure_code character varying(80),
    operator_reason character varying(255),
    hash_version character varying(8) DEFAULT 'v2'::character varying NOT NULL
);


--
-- Name: barcode_inventory_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.barcode_inventory_codes (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    code character varying(6) NOT NULL,
    display_name character varying(255) NOT NULL,
    asset_type character varying(40) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    is_client_approved boolean DEFAULT false NOT NULL,
    is_provisional boolean DEFAULT false NOT NULL,
    requires_karat boolean DEFAULT true NOT NULL,
    default_karat_code character varying(2),
    default_item_code character varying(6),
    sort_order integer DEFAULT 0 NOT NULL,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: barcode_item_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.barcode_item_codes (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    code character varying(6) NOT NULL,
    display_name character varying(255) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    is_client_approved boolean DEFAULT false NOT NULL,
    is_provisional boolean DEFAULT false NOT NULL,
    allowed_inventory_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: barcode_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.barcode_sequences (
    id bigint NOT NULL,
    company_id character varying(255) NOT NULL,
    inventory_code character varying(6) NOT NULL,
    item_code character varying(6) NOT NULL,
    karat_code character varying(2) NOT NULL,
    last_serial integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: barcode_sequences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.barcode_sequences_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: barcode_sequences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.barcode_sequences_id_seq OWNED BY public.barcode_sequences.id;


--
-- Name: branch_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_customers (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    balance numeric(20,8) DEFAULT 0 NOT NULL,
    purchases numeric(20,8) DEFAULT 0 NOT NULL,
    loyalty_points integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: branch_financial_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_financial_mappings (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    mapping_type character varying(255) NOT NULL,
    channel character varying(255),
    account_id character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(255) NOT NULL,
    type public.enum_branches_type DEFAULT 'store'::public.enum_branches_type NOT NULL,
    address character varying(255),
    phone character varying(255),
    manager_id character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: cash_register_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_register_sessions (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    cash_account_code character varying(255) DEFAULT '1110'::character varying NOT NULL,
    status character varying(255) DEFAULT 'OPEN'::character varying NOT NULL,
    opened_at timestamp with time zone NOT NULL,
    opened_by_user_id character varying(255),
    opened_by_employee_id character varying(255),
    opened_by_name character varying(255),
    opening_counted_amount numeric(15,4) DEFAULT 0 NOT NULL,
    closed_at timestamp with time zone,
    closed_by_user_id character varying(255),
    closed_by_employee_id character varying(255),
    closed_by_name character varying(255),
    closing_counted_amount numeric(15,4),
    system_expected_amount numeric(15,4),
    variance numeric(15,4),
    variance_reason text,
    open_idempotency_key character varying(255),
    close_idempotency_key character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cash_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_transactions (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    type public.enum_cash_transactions_type DEFAULT 'cash_in'::public.enum_cash_transactions_type NOT NULL,
    account character varying(255) DEFAULT 'cash'::character varying NOT NULL,
    to_account character varying(255),
    amount numeric(15,4) DEFAULT 0 NOT NULL,
    category character varying(255),
    counter_account_code character varying(255),
    description character varying(255),
    reference character varying(255),
    branch character varying(255) DEFAULT 'Main Branch'::character varying NOT NULL,
    date character varying(255) NOT NULL,
    created_by character varying(255),
    status public.enum_cash_transactions_status DEFAULT 'posted'::public.enum_cash_transactions_status,
    opening_balance numeric(15,4),
    expected_balance numeric(15,4),
    actual_balance numeric(15,4),
    variance numeric(15,4) DEFAULT 0,
    journal_entry_id character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    branch_id character varying(255),
    idempotency_key character varying(255)
);


--
-- Name: cgp_item_dispositions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cgp_item_dispositions (
    id character varying(255) NOT NULL,
    cgp_item_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    disposition character varying(48) NOT NULL,
    asset_id character varying(255),
    gold_pool_id character varying(255),
    evidence text NOT NULL,
    decided_at timestamp with time zone NOT NULL,
    decided_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cgp_pricing_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cgp_pricing_snapshots (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    cgp_document_id character varying(255) NOT NULL,
    cgp_item_id character varying(255) NOT NULL,
    price_source character varying(128) NOT NULL,
    price_version character varying(64) NOT NULL,
    price_timestamp timestamp with time zone NOT NULL,
    currency character varying(3) NOT NULL,
    karat numeric(8,6) NOT NULL,
    purity_factor numeric(10,6) NOT NULL,
    gross_weight numeric(20,6) NOT NULL,
    stone_weight numeric(20,6) NOT NULL,
    net_weight numeric(20,6) NOT NULL,
    pure_gold_weight numeric(20,6) NOT NULL,
    approved_karat_rate numeric(20,4) NOT NULL,
    rate_basis character varying(32) NOT NULL,
    line_gold_value numeric(20,4) NOT NULL,
    calculation_version integer DEFAULT 1 NOT NULL,
    created_by character varying(255),
    created_at timestamp with time zone NOT NULL,
    approved_price_id integer,
    approved_price_status character varying(24),
    approved_price_at timestamp with time zone,
    approved_price_by character varying(255),
    approved_price_source character varying(64),
    pricing_mode character varying(24),
    provider character varying(32),
    market_quote_id character varying(128),
    provider_quote_id character varying(128),
    market_quote_timestamp timestamp with time zone,
    market_received_at timestamp with time zone,
    quote_currency character varying(3),
    quote_unit character varying(24),
    base_quote_type character varying(8),
    base_market_rate numeric(20,8),
    karat_market_rate numeric(20,8),
    adjustment_type character varying(24),
    adjustment_value numeric(20,8),
    policy_id character varying(128),
    policy_version integer,
    policy_scope character varying(16),
    final_effective_rate numeric(20,4),
    calculated_at timestamp with time zone,
    rate_precision jsonb,
    derivation_method character varying(64),
    CONSTRAINT cgp_pricing_snapshots_live_adjustment_ck CHECK (((adjustment_type IS NULL) OR ((adjustment_type)::text = ANY ((ARRAY['NONE'::character varying, 'FIXED_PER_GRAM'::character varying, 'PERCENTAGE'::character varying])::text[])))),
    CONSTRAINT cgp_pricing_snapshots_live_lineage_ck CHECK (((pricing_mode IS NULL) OR ((pricing_mode)::text = 'MANUAL_APPROVED'::text) OR ((provider IS NOT NULL) AND (market_quote_id IS NOT NULL) AND (policy_id IS NOT NULL) AND (final_effective_rate IS NOT NULL) AND (calculated_at IS NOT NULL)))),
    CONSTRAINT cgp_pricing_snapshots_live_mode_ck CHECK (((pricing_mode IS NULL) OR ((pricing_mode)::text = ANY ((ARRAY['MANUAL_APPROVED'::character varying, 'LIVE_PROVIDER'::character varying])::text[])))),
    CONSTRAINT cgp_pricing_snapshots_live_quote_type_ck CHECK (((base_quote_type IS NULL) OR ((base_quote_type)::text = ANY ((ARRAY['BID'::character varying, 'SPOT'::character varying, 'ASK'::character varying])::text[])))),
    CONSTRAINT cgp_pricing_snapshots_live_unit_ck CHECK (((quote_unit IS NULL) OR ((quote_unit)::text = 'PER_GRAM'::text))),
    CONSTRAINT cgp_pricing_snapshots_rate_basis_ck CHECK (((rate_basis)::text = 'KARAT_SPECIFIC'::text))
);


--
-- Name: cgp_reversal_compensations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cgp_reversal_compensations (
    id character varying(255) NOT NULL,
    reversal_request_id character varying(255) NOT NULL,
    domain character varying(32) NOT NULL,
    compensation_event_id character varying(128) NOT NULL,
    journal_entry_id character varying(255),
    gold_core_event_id character varying(255),
    amount numeric(20,4) NOT NULL,
    status character varying(16) DEFAULT 'SUCCEEDED'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT cgp_reversal_compensations_domain_ck CHECK (((domain)::text = ANY ((ARRAY['ACCOUNTING'::character varying, 'GOLD_CENTER'::character varying])::text[]))),
    CONSTRAINT cgp_reversal_compensations_status_ck CHECK (((status)::text = 'SUCCEEDED'::text))
);


--
-- Name: cgp_reversal_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cgp_reversal_requests (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    cgp_document_id character varying(255) NOT NULL,
    posted_event_id character varying(128) NOT NULL,
    status character varying(32) DEFAULT 'REQUESTED'::character varying NOT NULL,
    reason text NOT NULL,
    idempotency_key character varying(191) NOT NULL,
    request_hash character varying(64) NOT NULL,
    correlation_id character varying(128) NOT NULL,
    causation_id character varying(128),
    requested_by character varying(255) NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    held_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    compensation_event_id character varying(128),
    completed_at timestamp with time zone,
    completed_by character varying(255),
    CONSTRAINT cgp_reversal_requests_reason_ck CHECK ((length(TRIM(BOTH FROM reason)) > 0)),
    CONSTRAINT cgp_reversal_requests_status_ck CHECK (((status)::text = ANY ((ARRAY['REQUESTED'::character varying, 'HOLD_PENDING'::character varying, 'HELD'::character varying, 'COMPENSATING'::character varying, 'COMPLETED'::character varying])::text[])))
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id character varying(255) NOT NULL,
    business_name character varying(255) NOT NULL,
    workspace character varying(255) NOT NULL,
    company_size character varying(255),
    country character varying(255),
    currency character varying(255) DEFAULT 'AED'::character varying,
    city character varying(255),
    region character varying(255),
    address_1 character varying(255),
    address_2 character varying(255),
    postal_code character varying(255),
    commercial_register character varying(255),
    tax_number character varying(255),
    logo character varying(255),
    branch_name character varying(255) DEFAULT 'Main Branch'::character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    phone character varying(40),
    email character varying(160),
    website character varying(200),
    vat_registered boolean
);


--
-- Name: customer_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_attachments (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    file_name character varying(255) NOT NULL,
    original_file_name character varying(255) NOT NULL,
    mime_type character varying(255) NOT NULL,
    file_size integer NOT NULL,
    file_url character varying(255) NOT NULL,
    category character varying(255),
    uploaded_by character varying(255),
    uploaded_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: customer_credit_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_credit_transactions (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255),
    customer_id character varying(255) NOT NULL,
    source_type character varying(40) NOT NULL,
    source_id character varying(255),
    direction character varying(16) NOT NULL,
    amount numeric(15,4) NOT NULL,
    currency character varying(8) DEFAULT 'AED'::character varying NOT NULL,
    description character varying(255),
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    journal_entry_id character varying(255),
    cash_transaction_id character varying(255),
    invoice_id character varying(255),
    created_by character varying(255),
    metadata jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: customer_financial_liabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_financial_liabilities (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    source_type character varying(96) NOT NULL,
    source_document_id character varying(255) NOT NULL,
    source_event_id character varying(128) NOT NULL,
    journal_entry_id character varying(255) NOT NULL,
    currency character varying(3) NOT NULL,
    original_amount numeric(20,4) NOT NULL,
    outstanding_amount numeric(20,4) NOT NULL,
    settled_amount numeric(20,4) DEFAULT 0.0000 NOT NULL,
    status character varying(32) DEFAULT 'OPEN'::character varying NOT NULL,
    recognized_at timestamp with time zone NOT NULL,
    correlation_id character varying(128) NOT NULL,
    causation_id character varying(128),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT customer_financial_liabilities_amounts_ck CHECK (((original_amount > (0)::numeric) AND (outstanding_amount >= (0)::numeric) AND (settled_amount >= (0)::numeric) AND ((outstanding_amount + settled_amount) = original_amount))),
    CONSTRAINT customer_financial_liabilities_status_ck CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'PARTIALLY_SETTLED'::character varying, 'SETTLED'::character varying, 'REVERSED'::character varying])::text[])))
);


--
-- Name: customer_gold_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_gold_pools (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    customer_name character varying(255) NOT NULL,
    status public.enum_customer_gold_pools_status DEFAULT 'pending-assay'::public.enum_customer_gold_pools_status,
    gross_weight numeric(20,8) NOT NULL,
    purity numeric(10,8) NOT NULL,
    fine_weight numeric(20,8) NOT NULL,
    assay_result numeric(10,8),
    assay_date character varying(255),
    assayed_by character varying(255),
    received_at character varying(255) NOT NULL,
    approved_at character varying(255),
    approved_by character varying(255),
    notes text,
    transferred_to_igp boolean DEFAULT false,
    igp_id character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: customer_gold_purchase_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_gold_purchase_documents (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    draft_number character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    currency character varying(3) NOT NULL,
    exchange_rate numeric(24,8) DEFAULT 1 NOT NULL,
    status public.enum_customer_gold_purchase_documents_status DEFAULT 'draft'::public.enum_customer_gold_purchase_documents_status NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    notes text,
    created_by character varying(255),
    updated_by character varying(255),
    validated_at timestamp with time zone,
    validated_by character varying(255),
    voided_at timestamp with time zone,
    voided_by character varying(255),
    void_reason text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    transaction_date date NOT NULL,
    submitted_at timestamp with time zone,
    submitted_by character varying(255),
    approved_at timestamp with time zone,
    approved_by character varying(255),
    last_rejected_at timestamp with time zone,
    last_rejected_by character varying(255),
    last_rejection_reason text,
    current_approval_request_id character varying(255),
    revision_number integer DEFAULT 1 NOT NULL,
    supersedes_document_id character varying(255),
    root_document_id character varying(255),
    business_status character varying(16) DEFAULT 'DRAFT'::character varying NOT NULL,
    governance_status character varying(16) DEFAULT 'NONE'::character varying NOT NULL,
    posted_at timestamp with time zone,
    posted_by character varying(255),
    posting_reference character varying(128),
    posting_metadata jsonb,
    total_gold_value numeric(20,4),
    total_payable_to_customer numeric(20,4),
    CONSTRAINT cgp_documents_business_status_ck CHECK (((business_status)::text = ANY ((ARRAY['DRAFT'::character varying, 'VALIDATED'::character varying, 'POSTED'::character varying, 'REVERSED'::character varying])::text[]))),
    CONSTRAINT cgp_documents_governance_status_ck CHECK (((governance_status)::text = ANY ((ARRAY['NONE'::character varying, 'PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying])::text[]))),
    CONSTRAINT cgp_documents_posted_facts_ck CHECK ((((business_status)::text <> 'POSTED'::text) OR ((posted_at IS NOT NULL) AND (posted_by IS NOT NULL) AND (posting_reference IS NOT NULL) AND (total_gold_value IS NOT NULL) AND (total_payable_to_customer IS NOT NULL))))
);


--
-- Name: customer_gold_purchase_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_gold_purchase_items (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    line_number integer NOT NULL,
    gold_type character varying(255) NOT NULL,
    karat numeric(8,6) NOT NULL,
    fineness numeric(10,6) NOT NULL,
    purity_factor numeric(10,6) NOT NULL,
    gross_weight numeric(20,6) NOT NULL,
    stone_weight numeric(20,6) DEFAULT 0 NOT NULL,
    net_weight numeric(20,6) NOT NULL,
    pure_gold_weight numeric(20,6) NOT NULL,
    reference_market_rate numeric(20,4),
    notes text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    document_id character varying(255) NOT NULL,
    proposed_rate numeric(20,4),
    deduction_metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: customer_timelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_timelines (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    event_type character varying(128) NOT NULL,
    source_document_type character varying(128) NOT NULL,
    source_document_id character varying(128) NOT NULL,
    source_event_id character varying(128) NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    summary text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: customer_transaction_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_transaction_history (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    transaction_type character varying(96) NOT NULL,
    source_domain character varying(64) NOT NULL,
    source_document_type character varying(128) NOT NULL,
    source_document_id character varying(128) NOT NULL,
    source_document_number character varying(128) NOT NULL,
    source_event_id character varying(128) NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    currency character varying(3) NOT NULL,
    amount numeric(20,4) NOT NULL,
    status character varying(32) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    phone character varying(255) NOT NULL,
    email character varying(255),
    tier public.enum_customers_tier DEFAULT 'Standard'::public.enum_customers_tier,
    balance numeric(20,8) DEFAULT 0 NOT NULL,
    purchases numeric(20,8) DEFAULT 0 NOT NULL,
    last_visit character varying(255),
    status public.enum_customers_status DEFAULT 'active'::public.enum_customers_status,
    nationality character varying(255),
    id_type character varying(255),
    id_number character varying(255),
    id_expiry character varying(255),
    kyc_status public.enum_customers_kyc_status DEFAULT 'not-started'::public.enum_customers_kyc_status,
    aml_status public.enum_customers_aml_status DEFAULT 'clear'::public.enum_customers_aml_status,
    credit_limit numeric(20,8) DEFAULT 0,
    loyalty_points integer DEFAULT 0,
    addresses jsonb DEFAULT '[]'::jsonb,
    notes text,
    kyc_details jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: email_change_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_change_tokens (
    id character varying(255) NOT NULL,
    user_id character varying(255) NOT NULL,
    new_email character varying(255) NOT NULL,
    token_hash character varying(128) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: employee_branch_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_branch_access (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    created_by_user_id character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: employee_code_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_code_history (
    id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    old_code character varying(64),
    new_code character varying(64) NOT NULL,
    changed_by_user_id character varying(255),
    changed_by_employee_id character varying(255),
    reason text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: employee_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_credentials (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    pin_hash character varying(255) NOT NULL,
    credential_version integer DEFAULT 1 NOT NULL,
    failed_attempt_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_failed_at timestamp with time zone,
    last_verified_at timestamp with time zone,
    pin_changed_at timestamp with time zone,
    reset_required boolean DEFAULT false NOT NULL,
    reset_at timestamp with time zone,
    reset_by_user_id character varying(255),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: employee_operational_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_operational_sessions (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    session_user_id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    verification_level integer DEFAULT 1 NOT NULL,
    verified_at timestamp with time zone NOT NULL,
    level_2_verified_at timestamp with time zone,
    last_activity_at timestamp with time zone NOT NULL,
    idle_expires_at timestamp with time zone NOT NULL,
    absolute_expires_at timestamp with time zone NOT NULL,
    locked_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_reason character varying(80),
    credential_version integer NOT NULL,
    authorization_version integer NOT NULL,
    device_session_id character varying(128) NOT NULL,
    auth_session_fingerprint character varying(160),
    ip_address character varying(80),
    user_agent character varying(255),
    employee_code_snapshot character varying(64),
    employee_name_snapshot character varying(160),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT employee_operational_sessions_level_chk CHECK ((verification_level = ANY (ARRAY[1, 2])))
);


--
-- Name: employee_permission_denials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_permission_denials (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    permission_id character varying(255) NOT NULL,
    denied_by_user_id character varying(255),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: employee_permission_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_permission_grants (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    permission_id character varying(255) NOT NULL,
    granted_by_user_id character varying(255),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: employee_role_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_role_assignments (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    role_id character varying(255) NOT NULL,
    assigned_by_user_id character varying(255),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: employee_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_sessions (
    id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    device_name character varying(255),
    browser character varying(255),
    location character varying(255),
    last_active character varying(255),
    is_current boolean DEFAULT false,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: employee_verification_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_verification_attempts (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255),
    technical_user_id character varying(255),
    employee_id character varying(255),
    employee_code_normalized character varying(64),
    requested_permission character varying(160),
    requested_operation character varying(160),
    requested_level integer NOT NULL,
    result public.enum_employee_verification_attempts_result NOT NULL,
    failure_code character varying(80),
    ip_address character varying(80),
    user_agent character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    role character varying(255) NOT NULL,
    system_role public.enum_employees_system_role DEFAULT 'sales'::public.enum_employees_system_role,
    branch character varying(255) NOT NULL,
    status public.enum_employees_status DEFAULT 'present'::public.enum_employees_status,
    email character varying(255),
    phone character varying(255),
    join_date character varying(255),
    job_title character varying(255),
    approval_limit numeric(20,8) DEFAULT 0,
    assigned_device character varying(255),
    notes text,
    approval_limits_detail jsonb,
    deactivate_reason character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    base_salary numeric(15,4) DEFAULT 0,
    allowances numeric(15,4) DEFAULT 0,
    branch_id character varying(255),
    employee_code character varying(64),
    employee_code_normalized character varying(64),
    authorization_version integer DEFAULT 1 NOT NULL
);


--
-- Name: financial_approval_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_approval_policies (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    operation_type character varying(64) NOT NULL,
    branch_id character varying(255),
    currency character varying(3),
    payment_method character varying(32),
    min_amount numeric(20,4),
    max_amount numeric(20,4),
    approval_required boolean NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    effective_from timestamp with time zone,
    effective_to timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    deactivated_at timestamp with time zone,
    deactivated_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    description text,
    metadata jsonb,
    CONSTRAINT financial_approval_policy_amount_range_ck CHECK ((((min_amount IS NULL) OR (min_amount >= (0)::numeric)) AND ((max_amount IS NULL) OR (max_amount >= (0)::numeric)) AND ((min_amount IS NULL) OR (max_amount IS NULL) OR (min_amount <= max_amount)))),
    CONSTRAINT financial_approval_policy_effective_window_ck CHECK (((effective_from IS NULL) OR (effective_to IS NULL) OR (effective_from < effective_to))),
    CONSTRAINT financial_approval_policy_priority_ck CHECK ((priority >= 0))
);


--
-- Name: financial_settlement_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_settlement_allocations (
    id character varying(255) NOT NULL,
    settlement_id character varying(255) NOT NULL,
    customer_financial_liability_id character varying(255) NOT NULL,
    amount numeric(20,4) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT financial_settlement_allocations_amount_ck CHECK ((amount > (0)::numeric))
);


--
-- Name: financial_settlement_legs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_settlement_legs (
    id character varying(255) NOT NULL,
    settlement_id character varying(255) NOT NULL,
    method character varying(32) NOT NULL,
    amount numeric(20,4) NOT NULL,
    account_id character varying(255) NOT NULL,
    cash_register_session_id character varying(255),
    bank_reference character varying(191),
    cash_transaction_id character varying(255),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT financial_settlement_legs_amount_ck CHECK ((amount > (0)::numeric)),
    CONSTRAINT financial_settlement_legs_bank_reference_ck CHECK ((((method)::text <> 'BANK_TRANSFER'::text) OR ((bank_reference IS NOT NULL) AND (length(TRIM(BOTH FROM bank_reference)) > 0)))),
    CONSTRAINT financial_settlement_legs_method_ck CHECK (((method)::text = ANY ((ARRAY['CASH'::character varying, 'BANK_TRANSFER'::character varying])::text[])))
);


--
-- Name: financial_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_settlements (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    operation_type character varying(64) NOT NULL,
    source_type character varying(96) NOT NULL,
    source_document_id character varying(255) NOT NULL,
    currency character varying(3) NOT NULL,
    total_amount numeric(20,4) NOT NULL,
    status character varying(32) DEFAULT 'EXECUTED'::character varying NOT NULL,
    approval_policy_id character varying(255),
    approval_policy_version integer,
    approval_decision_snapshot jsonb NOT NULL,
    approval_request_id character varying(255),
    journal_entry_id character varying(255) NOT NULL,
    idempotency_key character varying(191) NOT NULL,
    request_hash character varying(64) NOT NULL,
    correlation_id character varying(128) NOT NULL,
    causation_id character varying(128),
    executed_at timestamp with time zone NOT NULL,
    executed_by character varying(255) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT financial_settlements_amount_ck CHECK ((total_amount > (0)::numeric)),
    CONSTRAINT financial_settlements_status_ck CHECK (((status)::text = 'EXECUTED'::text))
);


--
-- Name: first_run_setup_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.first_run_setup_states (
    id character varying(32) NOT NULL,
    state character varying(48) NOT NULL,
    idempotency_key_hash character varying(128),
    payload_hash character varying(128),
    result jsonb,
    completed_at timestamp with time zone,
    last_error_code character varying(96),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: gift_vouchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gift_vouchers (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    code character varying(255) NOT NULL,
    value numeric(15,4) DEFAULT 0 NOT NULL,
    balance numeric(15,4) DEFAULT 0 NOT NULL,
    customer_id character varying(255),
    customer_name character varying(255),
    status public.enum_gift_vouchers_status DEFAULT 'active'::public.enum_gift_vouchers_status,
    issue_date character varying(255) NOT NULL,
    expiry_date character varying(255),
    payment_method character varying(255),
    branch character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: gold_core_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_core_events (
    id character varying(255) NOT NULL,
    event_type character varying(128) NOT NULL,
    event_version integer NOT NULL,
    source_event_id character varying(128) NOT NULL,
    source_event_type character varying(128) NOT NULL,
    source_event_version integer NOT NULL,
    source_document_id character varying(255) NOT NULL,
    source_document_number character varying(128) NOT NULL,
    posting_reference character varying(128) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    source_party_type character varying(32) NOT NULL,
    source_party_id character varying(255) NOT NULL,
    currency character varying(3) NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    correlation_id character varying(128) NOT NULL,
    causation_id character varying(128),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT gold_core_events_source_party_ck CHECK (((source_party_type)::text = 'CUSTOMER'::text)),
    CONSTRAINT gold_core_events_source_type_ck CHECK (((((source_event_type)::text = 'CustomerGoldPurchasePostedEvent'::text) AND (source_event_version = 1)) OR (((source_event_type)::text = 'CustomerGoldPurchaseReversalRequestedEvent'::text) AND (source_event_version = 1)))),
    CONSTRAINT gold_core_events_type_ck CHECK (((((event_type)::text = 'CUSTOMER_GOLD_ACQUISITION_RECORDED'::text) AND (event_version = 1)) OR (((event_type)::text = 'CUSTOMER_GOLD_ACQUISITION_REVERSED'::text) AND (event_version = 1))))
);


--
-- Name: gold_fixings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_fixings (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    customer_id character varying(255),
    customer_name character varying(255),
    direction public.enum_gold_fixings_direction DEFAULT 'buy'::public.enum_gold_fixings_direction NOT NULL,
    karat integer DEFAULT 21 NOT NULL,
    gross_weight numeric(10,4) DEFAULT 0 NOT NULL,
    fine_weight numeric(10,4) DEFAULT 0 NOT NULL,
    rate_per_gram numeric(12,4) DEFAULT 0 NOT NULL,
    value numeric(15,4) DEFAULT 0 NOT NULL,
    currency character varying(255) DEFAULT 'AED'::character varying,
    status public.enum_gold_fixings_status DEFAULT 'fixed'::public.enum_gold_fixings_status,
    fixed_at character varying(255),
    unfixed_at character varying(255),
    fixed_by character varying(255),
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: gold_market_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_market_quotes (
    id character varying(128) NOT NULL,
    company_id character varying(255) NOT NULL,
    provider character varying(32) NOT NULL,
    metal character varying(8) DEFAULT 'XAU'::character varying NOT NULL,
    currency character varying(3) NOT NULL,
    unit character varying(24) DEFAULT 'PER_GRAM'::character varying NOT NULL,
    base_purity numeric(8,4),
    quote_timestamp timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    spot numeric(20,8),
    bid numeric(20,8),
    ask numeric(20,8),
    karat_18_rate numeric(20,8),
    karat_21_rate numeric(20,8),
    karat_22_rate numeric(20,8),
    karat_24_rate numeric(20,8),
    karat_rate_source character varying(32),
    provider_quote_id character varying(128),
    raw_payload_hash character varying(128),
    status character varying(16) DEFAULT 'VALID'::character varying NOT NULL,
    quality character varying(24),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT gold_market_quotes_currency_ck CHECK (((currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT gold_market_quotes_metal_ck CHECK (((metal)::text = 'XAU'::text)),
    CONSTRAINT gold_market_quotes_positive_values_ck CHECK ((((spot IS NULL) OR (spot > (0)::numeric)) AND ((bid IS NULL) OR (bid > (0)::numeric)) AND ((ask IS NULL) OR (ask > (0)::numeric)) AND ((karat_18_rate IS NULL) OR (karat_18_rate > (0)::numeric)) AND ((karat_21_rate IS NULL) OR (karat_21_rate > (0)::numeric)) AND ((karat_22_rate IS NULL) OR (karat_22_rate > (0)::numeric)) AND ((karat_24_rate IS NULL) OR (karat_24_rate > (0)::numeric)))),
    CONSTRAINT gold_market_quotes_quote_value_ck CHECK (((spot IS NOT NULL) OR (bid IS NOT NULL) OR (ask IS NOT NULL) OR (karat_18_rate IS NOT NULL) OR (karat_21_rate IS NOT NULL) OR (karat_22_rate IS NOT NULL) OR (karat_24_rate IS NOT NULL))),
    CONSTRAINT gold_market_quotes_status_ck CHECK (((status)::text = ANY ((ARRAY['VALID'::character varying, 'STALE'::character varying, 'INVALID'::character varying, 'UNAVAILABLE'::character varying])::text[]))),
    CONSTRAINT gold_market_quotes_unit_ck CHECK (((unit)::text = 'PER_GRAM'::text))
);


--
-- Name: gold_market_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_market_settings (
    id character varying(128) NOT NULL,
    company_id character varying(255) NOT NULL,
    pricing_mode character varying(24) DEFAULT 'MANUAL_APPROVED'::character varying NOT NULL,
    active_provider character varying(32),
    market_currency character varying(3) DEFAULT 'AED'::character varying NOT NULL,
    refresh_interval_seconds integer DEFAULT 30 NOT NULL,
    stale_after_seconds integer DEFAULT 120 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    updated_by character varying(255),
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT gold_market_settings_currency_ck CHECK (((market_currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT gold_market_settings_intervals_ck CHECK (((refresh_interval_seconds > 0) AND (stale_after_seconds > 0) AND (stale_after_seconds >= refresh_interval_seconds))),
    CONSTRAINT gold_market_settings_mode_ck CHECK (((pricing_mode)::text = ANY ((ARRAY['MANUAL_APPROVED'::character varying, 'LIVE_PROVIDER'::character varying])::text[]))),
    CONSTRAINT gold_market_settings_provider_ck CHECK (((active_provider IS NULL) OR ((active_provider)::text = ANY ((ARRAY['GOLDAPI_IO'::character varying, 'METALS_API'::character varying])::text[]))))
);


--
-- Name: gold_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_prices (
    id integer NOT NULL,
    karat integer NOT NULL,
    price_per_gram numeric(20,8) NOT NULL,
    currency character varying(255) DEFAULT 'AED'::character varying NOT NULL,
    updated_by character varying(255) DEFAULT 'System'::character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    company_id character varying(255),
    source character varying(255) DEFAULT 'manual'::character varying NOT NULL,
    approval_status character varying(24) DEFAULT 'PENDING'::character varying NOT NULL,
    approved_at timestamp with time zone,
    approved_by character varying(255),
    valid_from timestamp with time zone,
    valid_until timestamp with time zone,
    approval_version integer DEFAULT 0 NOT NULL,
    CONSTRAINT gold_prices_approval_status_ck CHECK (((approval_status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying, 'EXPIRED'::character varying, 'VOIDED'::character varying, 'SUPERSEDED'::character varying])::text[]))),
    CONSTRAINT gold_prices_validity_window_ck CHECK (((valid_from IS NULL) OR (valid_until IS NULL) OR (valid_until > valid_from)))
);


--
-- Name: gold_prices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gold_prices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gold_prices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gold_prices_id_seq OWNED BY public.gold_prices.id;


--
-- Name: gold_pricing_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_pricing_policies (
    id character varying(128) NOT NULL,
    company_id character varying(255) NOT NULL,
    business_context character varying(64) DEFAULT 'CGP'::character varying NOT NULL,
    pricing_mode character varying(24) NOT NULL,
    scope_type character varying(16) NOT NULL,
    karat numeric(8,3),
    base_quote_type character varying(8) NOT NULL,
    adjustment_type character varying(24) NOT NULL,
    adjustment_value numeric(20,8) DEFAULT '0'::numeric NOT NULL,
    version integer NOT NULL,
    status character varying(16) DEFAULT 'INACTIVE'::character varying NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    effective_until timestamp with time zone,
    created_by character varying(255),
    supersedes_policy_id character varying(128),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT gold_pricing_policies_adjustment_ck CHECK (((adjustment_type)::text = ANY ((ARRAY['NONE'::character varying, 'FIXED_PER_GRAM'::character varying, 'PERCENTAGE'::character varying])::text[]))),
    CONSTRAINT gold_pricing_policies_context_ck CHECK (((business_context)::text = 'CGP'::text)),
    CONSTRAINT gold_pricing_policies_mode_ck CHECK (((pricing_mode)::text = ANY ((ARRAY['MANUAL_APPROVED'::character varying, 'LIVE_PROVIDER'::character varying])::text[]))),
    CONSTRAINT gold_pricing_policies_none_zero_ck CHECK ((((adjustment_type)::text <> 'NONE'::text) OR (adjustment_value = (0)::numeric))),
    CONSTRAINT gold_pricing_policies_quote_ck CHECK (((base_quote_type)::text = ANY ((ARRAY['BID'::character varying, 'SPOT'::character varying, 'ASK'::character varying])::text[]))),
    CONSTRAINT gold_pricing_policies_scope_ck CHECK (((((scope_type)::text = 'DEFAULT'::text) AND (karat IS NULL)) OR (((scope_type)::text = 'KARAT'::text) AND (karat = ANY (ARRAY[(18)::numeric, (21)::numeric, (22)::numeric, (24)::numeric]))))),
    CONSTRAINT gold_pricing_policies_status_ck CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'SUPERSEDED'::character varying, 'EXPIRED'::character varying])::text[]))),
    CONSTRAINT gold_pricing_policies_window_ck CHECK (((effective_until IS NULL) OR (effective_until > effective_from)))
);


--
-- Name: gold_purchase_approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_purchase_approval_requests (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    aggregate_type public.enum_gold_purchase_approval_requests_aggregate_type NOT NULL,
    document_id character varying(255) NOT NULL,
    document_version integer NOT NULL,
    approval_status public.enum_gold_purchase_approval_requests_approval_status DEFAULT 'pending'::public.enum_gold_purchase_approval_requests_approval_status NOT NULL,
    submitted_snapshot jsonb NOT NULL,
    submitted_snapshot_hash character varying(64) NOT NULL,
    requested_by character varying(255) NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    reviewed_by character varying(255),
    reviewed_at timestamp with time zone,
    review_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT gold_purchase_approval_document_version_positive_ck CHECK ((document_version > 0))
);


--
-- Name: idempotency_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_requests (
    id integer NOT NULL,
    company_id character varying(255) NOT NULL,
    scope character varying(100) NOT NULL,
    key character varying(191) NOT NULL,
    request_hash character varying(128) NOT NULL,
    status character varying(32) DEFAULT 'processing'::character varying NOT NULL,
    status_code integer,
    response_body jsonb,
    expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: idempotency_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.idempotency_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: idempotency_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.idempotency_requests_id_seq OWNED BY public.idempotency_requests.id;


--
-- Name: installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.installments (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    invoice_id character varying(255) NOT NULL,
    customer_id character varying(255),
    customer_name character varying(255),
    sequence integer DEFAULT 1 NOT NULL,
    due_date character varying(255) NOT NULL,
    amount numeric(15,4) DEFAULT 0 NOT NULL,
    paid_amount numeric(15,4) DEFAULT 0 NOT NULL,
    status public.enum_installments_status DEFAULT 'pending'::public.enum_installments_status,
    paid_date character varying(255),
    branch character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    idempotency_key character varying(255)
);


--
-- Name: integration_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_statuses (
    id character varying(255) NOT NULL,
    source_event_id character varying(128) NOT NULL,
    aggregate_type character varying(128) NOT NULL,
    aggregate_id character varying(128) NOT NULL,
    consumer_name character varying(64) NOT NULL,
    status character varying(32) DEFAULT 'PENDING'::character varying NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    first_attempt_at timestamp with time zone,
    last_attempt_at timestamp with time zone,
    succeeded_at timestamp with time zone,
    next_retry_at timestamp with time zone,
    correlation_id character varying(128) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT integration_statuses_status_ck CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'SUCCEEDED'::character varying, 'RETRYABLE_FAILED'::character varying])::text[])))
);


--
-- Name: inventory_adjustment_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_adjustment_items (
    id character varying(255) NOT NULL,
    adjustment_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    old_context jsonb NOT NULL,
    new_context jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: inventory_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_adjustments (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    status character varying(16) NOT NULL,
    reason text NOT NULL,
    requested_by character varying(255) NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    approved_by character varying(255),
    approved_at timestamp with time zone,
    applied_by character varying(255),
    applied_at timestamp with time zone,
    idempotency_key character varying(128) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT inventory_adjustment_separation_ck CHECK (((approved_by IS NULL) OR ((approved_by)::text <> (requested_by)::text)))
);


--
-- Name: inventory_asset_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_asset_movements (
    id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    movement_type character varying(32) NOT NULL,
    from_branch_id character varying(255),
    to_branch_id character varying(255),
    from_location_id character varying(255),
    to_location_id character varying(255),
    source_type character varying(48) NOT NULL,
    source_id character varying(255) NOT NULL,
    asset_event_id character varying(255),
    occurred_at timestamp with time zone NOT NULL,
    operator_id character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: inventory_gold_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_gold_pools (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    source character varying(255) NOT NULL,
    cgp_id character varying(255),
    gross_weight numeric(20,8) NOT NULL,
    purity numeric(10,8) NOT NULL,
    fine_weight numeric(20,8) NOT NULL,
    available_weight numeric(20,8) NOT NULL,
    allocated_weight numeric(20,8) DEFAULT 0 NOT NULL,
    status public.enum_inventory_gold_pools_status DEFAULT 'available'::public.enum_inventory_gold_pools_status,
    allocations jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: inventory_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_locations (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(120) NOT NULL,
    location_type character varying(24) DEFAULT 'GENERAL'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: inventory_master_data_bootstrap_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_master_data_bootstrap_states (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    dataset_id character varying(96) NOT NULL,
    current_version integer NOT NULL,
    manifest_hash character varying(128) NOT NULL,
    state character varying(24) NOT NULL,
    last_report jsonb,
    last_error_code character varying(120),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: inventory_saved_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_saved_views (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    owner_user_id character varying(255),
    owner_employee_id character varying(255),
    name character varying(120) NOT NULL,
    definition jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT inventory_saved_view_owner_ck CHECK (((((owner_user_id IS NOT NULL))::integer + ((owner_employee_id IS NOT NULL))::integer) = 1))
);


--
-- Name: inventory_source_link_classifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_source_link_classifications (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    source_table character varying(64) NOT NULL,
    source_row_id character varying(255) NOT NULL,
    source_value character varying(255),
    classification character varying(40) NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT inventory_source_link_class_ck CHECK (((classification)::text = ANY ((ARRAY['ASSET_LINK_PROVEN'::character varying, 'PRODUCT_LINK_LEGACY'::character varying, 'AMBIGUOUS'::character varying, 'NO_LINK'::character varying])::text[])))
);


--
-- Name: inventory_workshop_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_workshop_items (
    id character varying(255) NOT NULL,
    workshop_order_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    from_location_id character varying(255),
    prior_operational_status character varying(24) NOT NULL,
    status character varying(24) NOT NULL,
    sent_at timestamp with time zone,
    sent_by character varying(255),
    returned_at timestamp with time zone,
    returned_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: inventory_workshop_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_workshop_orders (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    order_number character varying(64) NOT NULL,
    provider_name character varying(160),
    status character varying(24) NOT NULL,
    expected_return_at timestamp with time zone,
    created_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: investment_gold_purchase_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investment_gold_purchase_documents (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    draft_number character varying(255) NOT NULL,
    supplier_id character varying(255) NOT NULL,
    currency character varying(3) NOT NULL,
    exchange_rate numeric(24,8) DEFAULT 1 NOT NULL,
    status public.enum_investment_gold_purchase_documents_status DEFAULT 'draft'::public.enum_investment_gold_purchase_documents_status NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    notes text,
    created_by character varying(255),
    updated_by character varying(255),
    validated_at timestamp with time zone,
    validated_by character varying(255),
    voided_at timestamp with time zone,
    voided_by character varying(255),
    void_reason text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    supplier_reference character varying(255),
    purchase_date date NOT NULL,
    submitted_at timestamp with time zone,
    submitted_by character varying(255),
    approved_at timestamp with time zone,
    approved_by character varying(255),
    last_rejected_at timestamp with time zone,
    last_rejected_by character varying(255),
    last_rejection_reason text,
    current_approval_request_id character varying(255),
    revision_number integer DEFAULT 1 NOT NULL,
    supersedes_document_id character varying(255),
    root_document_id character varying(255)
);


--
-- Name: investment_gold_purchase_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investment_gold_purchase_items (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    line_number integer NOT NULL,
    gold_type character varying(255) NOT NULL,
    karat numeric(8,6) NOT NULL,
    fineness numeric(10,6) NOT NULL,
    purity_factor numeric(10,6) NOT NULL,
    gross_weight numeric(20,6) NOT NULL,
    stone_weight numeric(20,6) DEFAULT 0 NOT NULL,
    net_weight numeric(20,6) NOT NULL,
    pure_gold_weight numeric(20,6) NOT NULL,
    reference_market_rate numeric(20,4),
    notes text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    document_id character varying(255) NOT NULL,
    investment_type public.enum_investment_gold_purchase_items_investment_type NOT NULL,
    bullion_identity_type public.enum_investment_gold_purchase_items_bullion_identity_type,
    serial_number character varying(255),
    lot_number character varying(255),
    quantity numeric(20,6) DEFAULT 1 NOT NULL,
    proposed_purchase_rate numeric(20,4),
    proposed_charges numeric(20,4),
    proposed_discount numeric(20,4),
    tax_mode_metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: invoice_item_asset_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_item_asset_links (
    id character varying(255) NOT NULL,
    invoice_item_id integer NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    ordinal integer NOT NULL,
    quote_snapshot jsonb,
    cost_snapshot_revision_id character varying(255),
    mapping_classification character varying(48) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT invoice_item_asset_links_ordinal_ck CHECK ((ordinal >= 1))
);


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id integer NOT NULL,
    invoice_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    price numeric(20,8) NOT NULL,
    cost numeric(20,8),
    weight numeric(20,8),
    karat integer,
    discount numeric(20,8) DEFAULT 0,
    making_charge numeric(20,8) DEFAULT 0,
    stone_value numeric(20,8) DEFAULT 0,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_items_id_seq OWNED BY public.invoice_items.id;


--
-- Name: invoice_print_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_print_events (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    invoice_id character varying(255) NOT NULL,
    technical_user_id character varying(255) NOT NULL,
    employee_id character varying(255),
    operator_session_id character varying(255),
    event_type character varying(64) NOT NULL,
    copy_number integer NOT NULL,
    reason text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT invoice_print_events_copy_number_chk CHECK ((copy_number >= 1)),
    CONSTRAINT invoice_print_events_event_type_chk CHECK (((event_type)::text = ANY ((ARRAY['official_print_authorized'::character varying, 'reprint_authorized'::character varying])::text[])))
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    type public.enum_invoices_type DEFAULT 'sale'::public.enum_invoices_type,
    customer_id character varying(255) NOT NULL,
    customer_name character varying(255) NOT NULL,
    date character varying(255) NOT NULL,
    total numeric(20,8) DEFAULT 0 NOT NULL,
    tax numeric(20,8) DEFAULT 0 NOT NULL,
    subtotal numeric(20,8),
    discount numeric(20,8) DEFAULT 0,
    making_charge numeric(20,8) DEFAULT 0,
    stone_value numeric(20,8) DEFAULT 0,
    deposit numeric(20,8) DEFAULT 0,
    status public.enum_invoices_status DEFAULT 'due'::public.enum_invoices_status,
    payment_method character varying(255) NOT NULL,
    payment_splits jsonb DEFAULT '[]'::jsonb,
    branch character varying(255) NOT NULL,
    notes text,
    related_invoice_id character varying(255),
    idempotency_key character varying(255),
    posted_at character varying(255),
    cancelled_at character varying(255),
    cancel_reason character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    branch_id character varying(255),
    down_payment numeric(15,4) DEFAULT 0,
    installment_count integer DEFAULT 0,
    guarantor_name character varying(255),
    guarantor_phone character varying(255),
    installment_frequency character varying(255) DEFAULT 'monthly'::character varying,
    paid_amount numeric(15,4) DEFAULT 0 NOT NULL,
    remaining_amount numeric(15,4) DEFAULT 0 NOT NULL,
    vat_rate numeric(6,3),
    posting_status public.enum_invoices_posting_status DEFAULT 'posted'::public.enum_invoices_posting_status NOT NULL,
    invoice_number character varying(255),
    created_by_employee_id character varying(255),
    finalized_by_employee_id character varying(255),
    customer_phone_snapshot character varying(255),
    customer_address_snapshot jsonb
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    description character varying(255) NOT NULL,
    date character varying(255) NOT NULL,
    status public.enum_journal_entries_status DEFAULT 'draft'::public.enum_journal_entries_status,
    amount numeric(20,8) DEFAULT 0 NOT NULL,
    total_debit numeric(20,8) DEFAULT 0 NOT NULL,
    total_credit numeric(20,8) DEFAULT 0 NOT NULL,
    source_type character varying(255),
    source_id character varying(255),
    posted_by character varying(255),
    posted_at character varying(255),
    reversal_of character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    branch_id character varying(255)
);


--
-- Name: journal_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_lines (
    id character varying(255) NOT NULL,
    journal_entry_id character varying(255) NOT NULL,
    account_id character varying(255) NOT NULL,
    account_code character varying(255) NOT NULL,
    account_name character varying(255) NOT NULL,
    debit numeric(20,8) DEFAULT 0 NOT NULL,
    credit numeric(20,8) DEFAULT 0 NOT NULL,
    description character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: legacy_product_asset_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legacy_product_asset_map (
    id character varying(255) NOT NULL,
    product_id character varying(255) NOT NULL,
    asset_id character varying(255),
    company_id character varying(255) NOT NULL,
    ordinal integer,
    classification character varying(1) NOT NULL,
    mapping_status character varying(32) NOT NULL,
    evidence text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT legacy_product_classification_ck CHECK (((classification)::text = ANY ((ARRAY['A'::character varying, 'B'::character varying, 'C'::character varying, 'D'::character varying, 'E'::character varying])::text[])))
);


--
-- Name: loyalty_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_transactions (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    customer_name character varying(255),
    type public.enum_loyalty_transactions_type NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    value numeric(15,4) DEFAULT 0,
    balance_after integer DEFAULT 0 NOT NULL,
    invoice_id character varying(255),
    date character varying(255),
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: manufacturing_order_inputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manufacturing_order_inputs (
    id character varying(255) NOT NULL,
    manufacturing_order_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    ordinal integer NOT NULL,
    pre_weight numeric(20,8),
    disposition character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: manufacturing_order_outputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manufacturing_order_outputs (
    id character varying(255) NOT NULL,
    manufacturing_order_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    ordinal integer NOT NULL,
    post_weight numeric(20,8),
    process_loss numeric(20,8),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: manufacturing_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manufacturing_orders (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    status public.enum_manufacturing_orders_status DEFAULT 'draft'::public.enum_manufacturing_orders_status,
    type public.enum_manufacturing_orders_type NOT NULL,
    input_assets jsonb DEFAULT '[]'::jsonb,
    output_assets jsonb DEFAULT '[]'::jsonb,
    expected_output_weight numeric(20,8) NOT NULL,
    actual_output_weight numeric(20,8),
    process_loss numeric(20,8) DEFAULT 0,
    wastage numeric(20,8) DEFAULT 0,
    branch character varying(255) NOT NULL,
    notes text,
    started_at character varying(255),
    completed_at character varying(255),
    created_by character varying(255) NOT NULL,
    approved_by character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    user_id character varying(255),
    role_id character varying(255),
    title character varying(255) NOT NULL,
    message text NOT NULL,
    type public.enum_notifications_type DEFAULT 'info'::public.enum_notifications_type,
    entity_type character varying(255),
    entity_id character varying(255),
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    source_type character varying(255),
    source_id character varying(255),
    event_key character varying(255)
);


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id character varying(255) NOT NULL,
    event_id character varying(128) NOT NULL,
    event_type character varying(128) NOT NULL,
    event_version integer DEFAULT 1 NOT NULL,
    aggregate_type character varying(128) NOT NULL,
    aggregate_id character varying(128) NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    available_at timestamp with time zone NOT NULL,
    status character varying(32) DEFAULT 'PENDING'::character varying NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    claimed_at timestamp with time zone,
    claimed_by character varying(128),
    published_at timestamp with time zone,
    correlation_id character varying(128) NOT NULL,
    causation_id character varying(128),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT outbox_events_status_ck CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'PUBLISHED'::character varying, 'RETRYABLE_FAILED'::character varying])::text[])))
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id character varying(255) NOT NULL,
    user_id character varying(255) NOT NULL,
    token_hash character varying(128) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    requested_ip character varying(80),
    requested_user_agent character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255),
    invoice_id character varying(255) NOT NULL,
    payment_method character varying(255) NOT NULL,
    amount numeric(15,4) DEFAULT 0 NOT NULL,
    reference character varying(255),
    date character varying(255) NOT NULL,
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    received_by_employee_id character varying(255)
);


--
-- Name: payslips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payslips (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    employee_id character varying(255) NOT NULL,
    employee_name character varying(255),
    period character varying(255) NOT NULL,
    base_salary numeric(15,4) DEFAULT 0 NOT NULL,
    allowances numeric(15,4) DEFAULT 0,
    overtime numeric(15,4) DEFAULT 0,
    deductions numeric(15,4) DEFAULT 0,
    net numeric(15,4) DEFAULT 0 NOT NULL,
    status public.enum_payslips_status DEFAULT 'draft'::public.enum_payslips_status,
    paid_date character varying(255),
    payment_method character varying(255),
    journal_entry_id character varying(255),
    branch character varying(255),
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    idempotency_key character varying(255)
);


--
-- Name: pearl_size_master_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pearl_size_master_data (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    value numeric(20,8) NOT NULL,
    display_value character varying(32) NOT NULL,
    unit character varying(8) DEFAULT 'MM'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_owner_approved_initial boolean DEFAULT false NOT NULL,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    module character varying(255) NOT NULL,
    action character varying(255) NOT NULL,
    description text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: processed_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_events (
    id character varying(255) NOT NULL,
    consumer_name character varying(64) NOT NULL,
    event_id character varying(128) NOT NULL,
    event_type character varying(128) NOT NULL,
    event_version integer NOT NULL,
    status character varying(32) DEFAULT 'SUCCEEDED'::character varying NOT NULL,
    correlation_id character varying(128) NOT NULL,
    processed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT processed_events_status_ck CHECK (((status)::text = 'SUCCEEDED'::text))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    product_code character varying(255) NOT NULL,
    product_name character varying(255) NOT NULL,
    description text,
    karat integer,
    stock_type character varying(255),
    branch_id character varying(255),
    branch_name character varying(255),
    warehouse_id character varying(255),
    quantity_on_hand numeric(10,2) DEFAULT 0 NOT NULL,
    quantity_available numeric(10,2) DEFAULT 0 NOT NULL,
    quantity_sold numeric(10,2) DEFAULT 0 NOT NULL,
    quantity_reserved numeric(10,2) DEFAULT 0 NOT NULL,
    total_weight numeric(12,4) DEFAULT 0 NOT NULL,
    average_unit_weight numeric(12,4) DEFAULT 0 NOT NULL,
    unit_cost numeric(15,4) DEFAULT 0 NOT NULL,
    average_cost numeric(15,4) DEFAULT 0 NOT NULL,
    sale_price numeric(15,4) DEFAULT 0 NOT NULL,
    supplier_id character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: profile_master_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_master_data (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    category_key character varying(64) NOT NULL,
    canonical_value character varying(160) NOT NULL,
    display_label character varying(160) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: purchase_order_item_asset_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_item_asset_links (
    id character varying(255) NOT NULL,
    purchase_order_item_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    ordinal integer NOT NULL,
    received_at timestamp with time zone,
    received_by character varying(255),
    mapping_classification character varying(48) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT po_item_asset_links_ordinal_ck CHECK ((ordinal >= 1))
);


--
-- Name: purchase_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_items (
    id character varying(255) NOT NULL,
    purchase_order_id character varying(255) NOT NULL,
    description character varying(255) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit character varying(255) DEFAULT 'قطعة'::character varying,
    unit_price numeric(20,8) NOT NULL,
    total numeric(20,8) NOT NULL,
    received_quantity integer DEFAULT 0,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    asset_id character varying(255),
    product_id character varying(255),
    gold_price_snapshot numeric(15,4),
    gold_price_source character varying(255),
    gold_price_karat character varying(255),
    gold_price_at timestamp with time zone,
    computed_gold_cost numeric(15,4),
    final_purchase_cost numeric(15,4),
    cost_source character varying(255) DEFAULT 'manual'::character varying NOT NULL,
    cost_overridden boolean DEFAULT false NOT NULL,
    override_reason text,
    override_by character varying(255),
    override_at timestamp with time zone,
    net_gold_weight numeric(15,4)
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    supplier_id character varying(255) NOT NULL,
    supplier_name character varying(255) NOT NULL,
    status public.enum_purchase_orders_status DEFAULT 'draft'::public.enum_purchase_orders_status,
    date character varying(255) NOT NULL,
    expected_date character varying(255),
    received_date character varying(255),
    total numeric(20,8) DEFAULT 0 NOT NULL,
    branch character varying(255) NOT NULL,
    notes text,
    is_consignment boolean DEFAULT false,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    idempotency_key character varying(255),
    tax_base numeric(20,8) DEFAULT 0 NOT NULL,
    vat_rate numeric(6,3) DEFAULT 0 NOT NULL,
    input_vat_amount numeric(20,8) DEFAULT 0 NOT NULL,
    tax_included boolean DEFAULT false NOT NULL,
    is_recoverable boolean DEFAULT true NOT NULL,
    is_rcm boolean DEFAULT false NOT NULL,
    rcm_vat_amount numeric(15,4) DEFAULT 0 NOT NULL,
    rcm_rate numeric(6,3) DEFAULT 0 NOT NULL,
    tax_treatment character varying(32),
    tax_snapshot jsonb
);


--
-- Name: reservation_amendment_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_amendment_items (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    amendment_id character varying(255) NOT NULL,
    reservation_id character varying(255) NOT NULL,
    action public.enum_reservation_amendment_items_action NOT NULL,
    reservation_item_id character varying(255),
    asset_id character varying(255),
    previous_asset_id character varying(255),
    old_price numeric(20,8),
    new_price numeric(20,8),
    previous_active_state character varying(255),
    new_active_state character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: reservation_amendments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_amendments (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    reservation_id character varying(255) NOT NULL,
    amendment_type public.enum_reservation_amendments_amendment_type NOT NULL,
    reason text NOT NULL,
    before_total numeric(20,8) NOT NULL,
    after_total numeric(20,8) NOT NULL,
    before_paid numeric(20,8) NOT NULL,
    after_paid numeric(20,8) NOT NULL,
    before_remaining numeric(20,8) NOT NULL,
    after_remaining numeric(20,8) NOT NULL,
    before_status character varying(255) NOT NULL,
    after_status character varying(255) NOT NULL,
    idempotency_key character varying(255),
    created_by character varying(255),
    employee_id character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: reservation_deposit_receipt_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_deposit_receipt_documents (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    reservation_id character varying(255) NOT NULL,
    reservation_payment_id character varying(255) NOT NULL,
    customer_id character varying(255),
    employee_id character varying(255),
    receipt_number character varying(255) NOT NULL,
    sequence_year integer NOT NULL,
    sequence_value bigint NOT NULL,
    posted_at timestamp with time zone NOT NULL,
    status character varying(255) DEFAULT 'issued'::character varying NOT NULL,
    snapshot_version integer DEFAULT 1 NOT NULL,
    snapshot jsonb NOT NULL,
    created_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: reservation_deposit_receipt_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_deposit_receipt_sequences (
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    sequence_year integer NOT NULL,
    next_value bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: reservation_expiry_extensions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_expiry_extensions (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    reservation_id character varying(255) NOT NULL,
    old_expiry character varying(255) NOT NULL,
    new_expiry character varying(255) NOT NULL,
    reason text NOT NULL,
    extended_by character varying(255),
    extended_at timestamp with time zone NOT NULL,
    idempotency_key character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: reservation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_items (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    reservation_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    asset_name character varying(255) NOT NULL,
    item_type character varying(255) DEFAULT 'asset'::character varying NOT NULL,
    agreed_price numeric(20,8) NOT NULL,
    original_price numeric(20,8),
    status public.enum_reservation_items_status DEFAULT 'active'::public.enum_reservation_items_status NOT NULL,
    reserved_at timestamp with time zone NOT NULL,
    released_at timestamp with time zone,
    added_by character varying(255),
    release_reason text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: reservation_payment_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_payment_applications (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    reservation_id character varying(255) NOT NULL,
    reservation_payment_id character varying(255) NOT NULL,
    final_invoice_id character varying(255) NOT NULL,
    applied_amount numeric(20,8) NOT NULL,
    applied_at timestamp with time zone NOT NULL,
    applied_by character varying(255),
    source_reference character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    idempotency_key character varying(255)
);


--
-- Name: reservation_payment_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_payment_transfers (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    renewal_id character varying(255) NOT NULL,
    source_reservation_id character varying(255) NOT NULL,
    target_reservation_id character varying(255) NOT NULL,
    source_payment_id character varying(255) NOT NULL,
    target_payment_id character varying(255),
    customer_id character varying(255) NOT NULL,
    branch_id character varying(255),
    currency character varying(255) DEFAULT 'AED'::character varying NOT NULL,
    amount numeric(20,8) NOT NULL,
    advances_account_code character varying(255),
    journal_entry_id character varying(255),
    status public.enum_reservation_payment_transfers_status DEFAULT 'posted'::public.enum_reservation_payment_transfers_status NOT NULL,
    transferred_by character varying(255),
    transferred_at timestamp with time zone NOT NULL,
    idempotency_key character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: reservation_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_payments (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    reservation_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    branch_id character varying(255),
    amount numeric(20,8) NOT NULL,
    currency character varying(255) DEFAULT 'AED'::character varying NOT NULL,
    payment_method character varying(255) DEFAULT 'cash'::character varying NOT NULL,
    treasury_account_code character varying(255) NOT NULL,
    advances_account_id character varying(255) NOT NULL,
    advances_account_code character varying(255) NOT NULL,
    receipt_number character varying(255) NOT NULL,
    journal_entry_id character varying(255),
    status public.enum_reservation_payments_status DEFAULT 'posted'::public.enum_reservation_payments_status NOT NULL,
    idempotency_key character varying(255),
    received_by character varying(255),
    received_employee_id character varying(255),
    received_at timestamp with time zone NOT NULL,
    source_reference character varying(255),
    reversal_of character varying(255),
    refund_of character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    source_transfer_id character varying(255),
    origin character varying(255),
    cash_transaction_id character varying(255),
    cash_register_session_id character varying(255)
);


--
-- Name: reservation_refund_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_refund_allocations (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    reservation_refund_id character varying(255) NOT NULL,
    reservation_payment_id character varying(255) NOT NULL,
    allocated_amount numeric(20,8) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: reservation_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_refunds (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    reservation_id character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    branch_id character varying(255),
    amount numeric(20,8) NOT NULL,
    currency character varying(255) DEFAULT 'AED'::character varying NOT NULL,
    status public.enum_reservation_refunds_status DEFAULT 'requested'::public.enum_reservation_refunds_status NOT NULL,
    requested_refund_method character varying(255) NOT NULL,
    treasury_account_code character varying(255),
    original_payment_methods_summary jsonb,
    method_differs_from_original boolean DEFAULT false NOT NULL,
    method_override_approved boolean DEFAULT false NOT NULL,
    reason text NOT NULL,
    requested_by character varying(255),
    requested_at timestamp with time zone NOT NULL,
    approved_by character varying(255),
    approved_at timestamp with time zone,
    rejected_by character varying(255),
    rejected_at timestamp with time zone,
    rejection_reason text,
    executed_by character varying(255),
    executed_at timestamp with time zone,
    journal_entry_id character varying(255),
    cash_transaction_id character varying(255),
    idempotency_key character varying(255),
    version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    refund_type public.enum_reservation_refunds_refund_type DEFAULT 'reservation_full'::public.enum_reservation_refunds_refund_type NOT NULL,
    renewal_id character varying(255)
);


--
-- Name: reservation_renewals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_renewals (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    source_reservation_id character varying(255) NOT NULL,
    successor_reservation_id character varying(255),
    customer_id character varying(255) NOT NULL,
    branch_id character varying(255),
    currency character varying(255) DEFAULT 'AED'::character varying NOT NULL,
    source_transferable_balance numeric(20,8) NOT NULL,
    successor_total numeric(20,8) NOT NULL,
    transfer_amount numeric(20,8) DEFAULT 0 NOT NULL,
    excess_refund_amount numeric(20,8) DEFAULT 0 NOT NULL,
    excess_refund_id character varying(255),
    status public.enum_reservation_renewals_status DEFAULT 'requested'::public.enum_reservation_renewals_status NOT NULL,
    current_price_evidence jsonb,
    reason text,
    requested_by character varying(255),
    requested_at timestamp with time zone NOT NULL,
    activated_by character varying(255),
    activated_at timestamp with time zone,
    idempotency_key character varying(255),
    version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservations (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    asset_name character varying(255) NOT NULL,
    customer_id character varying(255) NOT NULL,
    customer_name character varying(255) NOT NULL,
    branch character varying(255) NOT NULL,
    deposit numeric(20,8) DEFAULT 0 NOT NULL,
    expires_at character varying(255) NOT NULL,
    status public.enum_reservations_status DEFAULT 'active'::public.enum_reservations_status,
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    branch_id character varying(255),
    currency character varying(255) DEFAULT 'AED'::character varying NOT NULL,
    agreed_total numeric(20,8) DEFAULT 0 NOT NULL,
    paid_total numeric(20,8) DEFAULT 0 NOT NULL,
    remaining_total numeric(20,8) DEFAULT 0 NOT NULL,
    excess_total numeric(20,8) DEFAULT 0 NOT NULL,
    fully_paid_at timestamp with time zone,
    final_invoice_id character varying(255),
    workflow_version integer DEFAULT 1 NOT NULL,
    is_legacy boolean DEFAULT true NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    created_by character varying(255),
    updated_by character varying(255),
    completed_at timestamp with time zone,
    completed_by character varying(255),
    cancelled_at timestamp with time zone,
    cancelled_by character varying(255),
    cancellation_reason text,
    refunded_at timestamp with time zone,
    refund_status character varying(255),
    expiry_processed_at timestamp with time zone,
    expired_at timestamp with time zone,
    expired_by_system boolean DEFAULT false NOT NULL,
    expiry_cancellation_reason text,
    last_extended_at timestamp with time zone,
    last_extended_by character varying(255),
    extension_count integer DEFAULT 0 NOT NULL,
    predecessor_reservation_id character varying(255),
    successor_reservation_id character varying(255),
    renewed_at timestamp with time zone,
    renewed_by character varying(255),
    renewal_status character varying(255)
);


--
-- Name: rfid_scan_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfid_scan_events (
    id character varying(255) NOT NULL,
    assignment_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    scanned_at timestamp with time zone NOT NULL,
    device_id character varying(255),
    operator_id character varying(255),
    operator_name character varying(255),
    source_type character varying(40),
    source_id character varying(255),
    method character varying(24) NOT NULL,
    result character varying(24) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id character varying(255) NOT NULL,
    permission_id character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    is_admin boolean DEFAULT false,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id integer NOT NULL,
    company_id character varying(255) NOT NULL,
    key character varying(255) NOT NULL,
    value jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: stock_audit_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_audit_items (
    id character varying(255) NOT NULL,
    stock_audit_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    expected_branch_id character varying(255) NOT NULL,
    scanned_branch_id character varying(255),
    status public.enum_stock_audit_items_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    result character varying(16),
    observed_at timestamp with time zone,
    scan_method character varying(24),
    CONSTRAINT stock_audit_items_result_ck CHECK (((result IS NULL) OR ((result)::text = ANY ((ARRAY['MATCHED'::character varying, 'MISSING'::character varying, 'EXTRA'::character varying])::text[]))))
);


--
-- Name: stock_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_audits (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255) NOT NULL,
    status public.enum_stock_audits_status DEFAULT 'in-progress'::public.enum_stock_audits_status NOT NULL,
    created_by character varying(255) NOT NULL,
    completed_at character varying(255),
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    audit_number character varying(64),
    audit_date date,
    location_id character varying(255),
    audit_method character varying(24),
    closed_at timestamp with time zone,
    closed_by character varying(255),
    CONSTRAINT stock_audits_method_ck CHECK (((audit_method IS NULL) OR ((audit_method)::text = ANY ((ARRAY['MANUAL_COUNT'::character varying, 'BARCODE_SCAN'::character varying, 'RFID_SCAN'::character varying])::text[]))))
);


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    product_id character varying(255),
    asset_id character varying(255),
    product_code character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    quantity_in numeric(10,2) DEFAULT 0 NOT NULL,
    quantity_out numeric(10,2) DEFAULT 0 NOT NULL,
    weight_in numeric(12,4) DEFAULT 0 NOT NULL,
    weight_out numeric(12,4) DEFAULT 0 NOT NULL,
    unit_cost numeric(15,4) DEFAULT 0 NOT NULL,
    total_cost numeric(15,4) DEFAULT 0 NOT NULL,
    reference_type character varying(255),
    reference_id character varying(255),
    supplier_id character varying(255),
    customer_id character varying(255),
    branch_id character varying(255),
    warehouse_id character varying(255),
    created_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: supplier_consignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_consignments (
    id character varying(255) NOT NULL,
    supplier_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    asset_name character varying(255) NOT NULL,
    weight numeric(20,8) NOT NULL,
    agreed_price numeric(20,8) NOT NULL,
    received_date character varying(255) NOT NULL,
    status public.enum_supplier_consignments_status DEFAULT 'available'::public.enum_supplier_consignments_status,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: supplier_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_documents (
    id character varying(255) NOT NULL,
    supplier_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    expiry_date character varying(255) NOT NULL,
    url character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    file_name character varying(255),
    original_file_name character varying(255),
    mime_type character varying(255),
    file_size integer,
    uploaded_by character varying(255),
    uploaded_at timestamp with time zone
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(255) NOT NULL,
    phone character varying(255) NOT NULL,
    email character varying(255),
    due numeric(20,8) DEFAULT 0 NOT NULL,
    last_order character varying(255),
    rating numeric(5,2) DEFAULT 5,
    status public.enum_suppliers_status DEFAULT 'active'::public.enum_suppliers_status,
    address text,
    country character varying(255),
    tax_number character varying(255),
    commercial_register character varying(255),
    payment_terms character varying(255),
    notes text,
    is_consignment boolean DEFAULT false,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: system_account_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_account_roles (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    role_code character varying(255) NOT NULL,
    account_id character varying(255) NOT NULL,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    branch_id character varying(255)
);


--
-- Name: technical_account_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.technical_account_sessions (
    id character varying(255) NOT NULL,
    user_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    branch_id character varying(255),
    refresh_token_hash character varying(128) NOT NULL,
    device_session_id character varying(128),
    user_agent character varying(255),
    ip_address character varying(80),
    password_version integer NOT NULL,
    session_version integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoke_reason character varying(120),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: transfer_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfer_items (
    id character varying(255) NOT NULL,
    transfer_id character varying(255) NOT NULL,
    asset_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    from_branch_id character varying(255) NOT NULL,
    to_branch_id character varying(255) NOT NULL,
    from_location_id character varying(255),
    to_location_id character varying(255),
    status character varying(24) NOT NULL,
    dispatched_at timestamp with time zone,
    dispatched_by character varying(255),
    received_at timestamp with time zone,
    received_by character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfers (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    asset_ids jsonb NOT NULL,
    from_branch character varying(255) NOT NULL,
    to_branch character varying(255) NOT NULL,
    requested_by character varying(255) NOT NULL,
    requested_at character varying(255) NOT NULL,
    approved_by character varying(255),
    approved_at character varying(255),
    received_by character varying(255),
    received_at character varying(255),
    status public.enum_transfers_status DEFAULT 'pending'::public.enum_transfers_status,
    notes text,
    cancel_reason character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    from_branch_id character varying(255),
    to_branch_id character varying(255)
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id character varying(255) NOT NULL,
    role_id character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(255),
    password character varying(255) NOT NULL,
    job_title character varying(255),
    role public.enum_users_role DEFAULT 'sales'::public.enum_users_role NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    account_type character varying(32) DEFAULT 'legacy'::character varying NOT NULL,
    branch_id character varying(255),
    recovery_email character varying(255),
    recovery_phone character varying(255),
    recovery_email_verified_at timestamp with time zone,
    recovery_phone_verified_at timestamp with time zone,
    force_password_change boolean DEFAULT false NOT NULL,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    password_version integer DEFAULT 1 NOT NULL,
    session_version integer DEFAULT 1 NOT NULL,
    credentials_changed_at timestamp with time zone,
    last_login_at timestamp with time zone,
    last_password_change_at timestamp with time zone,
    default_employee_id character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT users_account_type_chk CHECK (((account_type)::text = ANY ((ARRAY['legacy'::character varying, 'super_admin'::character varying, 'branch_shell'::character varying])::text[])))
);


--
-- Name: barcode_sequences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barcode_sequences ALTER COLUMN id SET DEFAULT nextval('public.barcode_sequences_id_seq'::regclass);


--
-- Name: gold_prices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_prices ALTER COLUMN id SET DEFAULT nextval('public.gold_prices_id_seq'::regclass);


--
-- Name: idempotency_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_requests ALTER COLUMN id SET DEFAULT nextval('public.idempotency_requests_id_seq'::regclass);


--
-- Name: invoice_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_items_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: SequelizeMeta SequelizeMeta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SequelizeMeta"
    ADD CONSTRAINT "SequelizeMeta_pkey" PRIMARY KEY (name);


--
-- Name: accounting_locks accounting_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_locks
    ADD CONSTRAINT accounting_locks_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: asset_attachments asset_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_attachments
    ADD CONSTRAINT asset_attachments_pkey PRIMARY KEY (id);


--
-- Name: asset_barcode_history asset_barcode_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_barcode_history
    ADD CONSTRAINT asset_barcode_history_pkey PRIMARY KEY (id);


--
-- Name: asset_certificates asset_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_certificates
    ADD CONSTRAINT asset_certificates_pkey PRIMARY KEY (id);


--
-- Name: asset_components asset_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_components
    ADD CONSTRAINT asset_components_pkey PRIMARY KEY (id);


--
-- Name: asset_current_valuations asset_current_valuations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_current_valuations
    ADD CONSTRAINT asset_current_valuations_pkey PRIMARY KEY (asset_id);


--
-- Name: asset_diamond_component_details asset_diamond_component_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_diamond_component_details
    ADD CONSTRAINT asset_diamond_component_details_pkey PRIMARY KEY (component_id);


--
-- Name: asset_events asset_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_events
    ADD CONSTRAINT asset_events_pkey PRIMARY KEY (id);


--
-- Name: asset_gemstone_component_details asset_gemstone_component_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gemstone_component_details
    ADD CONSTRAINT asset_gemstone_component_details_pkey PRIMARY KEY (component_id);


--
-- Name: asset_gemstone_component_settings asset_gemstone_component_setting_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gemstone_component_settings
    ADD CONSTRAINT asset_gemstone_component_setting_uq UNIQUE (component_id, master_data_id);


--
-- Name: asset_gemstone_component_settings asset_gemstone_component_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gemstone_component_settings
    ADD CONSTRAINT asset_gemstone_component_settings_pkey PRIMARY KEY (id);


--
-- Name: asset_gold_details asset_gold_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gold_details
    ADD CONSTRAINT asset_gold_details_pkey PRIMARY KEY (asset_id);


--
-- Name: asset_lineage_links asset_lineage_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_lineage_links
    ADD CONSTRAINT asset_lineage_links_pkey PRIMARY KEY (id);


--
-- Name: asset_profile_master_data_references asset_master_reference_value_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_profile_master_data_references
    ADD CONSTRAINT asset_master_reference_value_uq UNIQUE (asset_id, category_key, master_data_id);


--
-- Name: asset_missing_cases asset_missing_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_missing_cases
    ADD CONSTRAINT asset_missing_cases_pkey PRIMARY KEY (id);


--
-- Name: asset_origins asset_origins_asset_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_origins
    ADD CONSTRAINT asset_origins_asset_id_key UNIQUE (asset_id);


--
-- Name: asset_origins asset_origins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_origins
    ADD CONSTRAINT asset_origins_pkey PRIMARY KEY (id);


--
-- Name: asset_pearl_component_details asset_pearl_component_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_pearl_component_details
    ADD CONSTRAINT asset_pearl_component_details_pkey PRIMARY KEY (component_id);


--
-- Name: asset_pricing_policies asset_pricing_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_pricing_policies
    ADD CONSTRAINT asset_pricing_policies_pkey PRIMARY KEY (asset_id);


--
-- Name: asset_profile_master_data_references asset_profile_master_data_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_profile_master_data_references
    ADD CONSTRAINT asset_profile_master_data_references_pkey PRIMARY KEY (id);


--
-- Name: asset_purchase_cost_revisions asset_purchase_cost_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_purchase_cost_revisions
    ADD CONSTRAINT asset_purchase_cost_revisions_pkey PRIMARY KEY (id);


--
-- Name: asset_return_reviews asset_return_reviews_asset_return_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_return_reviews
    ADD CONSTRAINT asset_return_reviews_asset_return_unique UNIQUE (asset_id, return_invoice_id);


--
-- Name: asset_return_reviews asset_return_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_return_reviews
    ADD CONSTRAINT asset_return_reviews_pkey PRIMARY KEY (id);


--
-- Name: asset_rfid_assignments asset_rfid_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_rfid_assignments
    ADD CONSTRAINT asset_rfid_assignments_pkey PRIMARY KEY (id);


--
-- Name: asset_tag_print_events asset_tag_print_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_tag_print_events
    ADD CONSTRAINT asset_tag_print_events_pkey PRIMARY KEY (id);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: barcode_inventory_codes barcode_inventory_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barcode_inventory_codes
    ADD CONSTRAINT barcode_inventory_codes_pkey PRIMARY KEY (id);


--
-- Name: barcode_item_codes barcode_item_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barcode_item_codes
    ADD CONSTRAINT barcode_item_codes_pkey PRIMARY KEY (id);


--
-- Name: barcode_sequences barcode_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barcode_sequences
    ADD CONSTRAINT barcode_sequences_pkey PRIMARY KEY (id);


--
-- Name: branch_customers branch_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_customers
    ADD CONSTRAINT branch_customers_pkey PRIMARY KEY (id);


--
-- Name: branch_financial_mappings branch_financial_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_financial_mappings
    ADD CONSTRAINT branch_financial_mappings_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: cash_register_sessions cash_register_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_register_sessions
    ADD CONSTRAINT cash_register_sessions_pkey PRIMARY KEY (id);


--
-- Name: cash_transactions cash_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transactions
    ADD CONSTRAINT cash_transactions_pkey PRIMARY KEY (id);


--
-- Name: cgp_item_dispositions cgp_item_dispositions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_item_dispositions
    ADD CONSTRAINT cgp_item_dispositions_pkey PRIMARY KEY (id);


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_pkey PRIMARY KEY (id);


--
-- Name: cgp_reversal_compensations cgp_reversal_compensations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_compensations
    ADD CONSTRAINT cgp_reversal_compensations_pkey PRIMARY KEY (id);


--
-- Name: cgp_reversal_requests cgp_reversal_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_requests
    ADD CONSTRAINT cgp_reversal_requests_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: companies companies_workspace_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_workspace_key UNIQUE (workspace);


--
-- Name: customer_attachments customer_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_attachments
    ADD CONSTRAINT customer_attachments_pkey PRIMARY KEY (id);


--
-- Name: customer_credit_transactions customer_credit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_credit_transactions
    ADD CONSTRAINT customer_credit_transactions_pkey PRIMARY KEY (id);


--
-- Name: customer_financial_liabilities customer_financial_liabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_financial_liabilities
    ADD CONSTRAINT customer_financial_liabilities_pkey PRIMARY KEY (id);


--
-- Name: customer_gold_pools customer_gold_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_pools
    ADD CONSTRAINT customer_gold_pools_pkey PRIMARY KEY (id);


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_pkey PRIMARY KEY (id);


--
-- Name: customer_gold_purchase_items customer_gold_purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_items
    ADD CONSTRAINT customer_gold_purchase_items_pkey PRIMARY KEY (id);


--
-- Name: customer_timelines customer_timelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_timelines
    ADD CONSTRAINT customer_timelines_pkey PRIMARY KEY (id);


--
-- Name: customer_transaction_history customer_transaction_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_transaction_history
    ADD CONSTRAINT customer_transaction_history_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: email_change_tokens email_change_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_change_tokens
    ADD CONSTRAINT email_change_tokens_pkey PRIMARY KEY (id);


--
-- Name: email_change_tokens email_change_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_change_tokens
    ADD CONSTRAINT email_change_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: employee_branch_access employee_branch_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_branch_access
    ADD CONSTRAINT employee_branch_access_pkey PRIMARY KEY (id);


--
-- Name: employee_code_history employee_code_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_code_history
    ADD CONSTRAINT employee_code_history_pkey PRIMARY KEY (id);


--
-- Name: employee_credentials employee_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_credentials
    ADD CONSTRAINT employee_credentials_pkey PRIMARY KEY (id);


--
-- Name: employee_operational_sessions employee_operational_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_operational_sessions
    ADD CONSTRAINT employee_operational_sessions_pkey PRIMARY KEY (id);


--
-- Name: employee_permission_denials employee_permission_denials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_denials
    ADD CONSTRAINT employee_permission_denials_pkey PRIMARY KEY (id);


--
-- Name: employee_permission_grants employee_permission_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_grants
    ADD CONSTRAINT employee_permission_grants_pkey PRIMARY KEY (id);


--
-- Name: employee_role_assignments employee_role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignments
    ADD CONSTRAINT employee_role_assignments_pkey PRIMARY KEY (id);


--
-- Name: employee_sessions employee_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sessions
    ADD CONSTRAINT employee_sessions_pkey PRIMARY KEY (id);


--
-- Name: employee_verification_attempts employee_verification_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_verification_attempts
    ADD CONSTRAINT employee_verification_attempts_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: financial_approval_policies financial_approval_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_approval_policies
    ADD CONSTRAINT financial_approval_policies_pkey PRIMARY KEY (id);


--
-- Name: financial_settlement_allocations financial_settlement_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlement_allocations
    ADD CONSTRAINT financial_settlement_allocations_pkey PRIMARY KEY (id);


--
-- Name: financial_settlement_legs financial_settlement_legs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlement_legs
    ADD CONSTRAINT financial_settlement_legs_pkey PRIMARY KEY (id);


--
-- Name: financial_settlements financial_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlements
    ADD CONSTRAINT financial_settlements_pkey PRIMARY KEY (id);


--
-- Name: first_run_setup_states first_run_setup_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.first_run_setup_states
    ADD CONSTRAINT first_run_setup_states_pkey PRIMARY KEY (id);


--
-- Name: gift_vouchers gift_vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_vouchers
    ADD CONSTRAINT gift_vouchers_pkey PRIMARY KEY (id);


--
-- Name: gold_core_events gold_core_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_core_events
    ADD CONSTRAINT gold_core_events_pkey PRIMARY KEY (id);


--
-- Name: gold_fixings gold_fixings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_fixings
    ADD CONSTRAINT gold_fixings_pkey PRIMARY KEY (id);


--
-- Name: gold_market_quotes gold_market_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_market_quotes
    ADD CONSTRAINT gold_market_quotes_pkey PRIMARY KEY (id);


--
-- Name: gold_market_settings gold_market_settings_company_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_market_settings
    ADD CONSTRAINT gold_market_settings_company_id_key UNIQUE (company_id);


--
-- Name: gold_market_settings gold_market_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_market_settings
    ADD CONSTRAINT gold_market_settings_pkey PRIMARY KEY (id);


--
-- Name: gold_prices gold_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_prices
    ADD CONSTRAINT gold_prices_pkey PRIMARY KEY (id);


--
-- Name: gold_pricing_policies gold_pricing_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_pricing_policies
    ADD CONSTRAINT gold_pricing_policies_pkey PRIMARY KEY (id);


--
-- Name: gold_purchase_approval_requests gold_purchase_approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_purchase_approval_requests
    ADD CONSTRAINT gold_purchase_approval_requests_pkey PRIMARY KEY (id);


--
-- Name: idempotency_requests idempotency_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_requests
    ADD CONSTRAINT idempotency_requests_pkey PRIMARY KEY (id);


--
-- Name: installments installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installments
    ADD CONSTRAINT installments_pkey PRIMARY KEY (id);


--
-- Name: integration_statuses integration_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_statuses
    ADD CONSTRAINT integration_statuses_pkey PRIMARY KEY (id);


--
-- Name: inventory_adjustment_items inventory_adjustment_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustment_items
    ADD CONSTRAINT inventory_adjustment_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_adjustments inventory_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_pkey PRIMARY KEY (id);


--
-- Name: inventory_asset_movements inventory_asset_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_asset_movements
    ADD CONSTRAINT inventory_asset_movements_pkey PRIMARY KEY (id);


--
-- Name: inventory_gold_pools inventory_gold_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_gold_pools
    ADD CONSTRAINT inventory_gold_pools_pkey PRIMARY KEY (id);


--
-- Name: inventory_locations inventory_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_locations
    ADD CONSTRAINT inventory_locations_pkey PRIMARY KEY (id);


--
-- Name: inventory_master_data_bootstrap_states inventory_master_data_bootstrap_scope_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_master_data_bootstrap_states
    ADD CONSTRAINT inventory_master_data_bootstrap_scope_uq UNIQUE (company_id, dataset_id);


--
-- Name: inventory_master_data_bootstrap_states inventory_master_data_bootstrap_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_master_data_bootstrap_states
    ADD CONSTRAINT inventory_master_data_bootstrap_states_pkey PRIMARY KEY (id);


--
-- Name: inventory_saved_views inventory_saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_saved_views
    ADD CONSTRAINT inventory_saved_views_pkey PRIMARY KEY (id);


--
-- Name: inventory_source_link_classifications inventory_source_link_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_source_link_classifications
    ADD CONSTRAINT inventory_source_link_classifications_pkey PRIMARY KEY (id);


--
-- Name: inventory_workshop_items inventory_workshop_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_workshop_items
    ADD CONSTRAINT inventory_workshop_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_workshop_orders inventory_workshop_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_workshop_orders
    ADD CONSTRAINT inventory_workshop_orders_pkey PRIMARY KEY (id);


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_pkey PRIMARY KEY (id);


--
-- Name: investment_gold_purchase_items investment_gold_purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_items
    ADD CONSTRAINT investment_gold_purchase_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_item_asset_links invoice_item_asset_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_item_asset_links
    ADD CONSTRAINT invoice_item_asset_links_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_print_events invoice_print_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_print_events
    ADD CONSTRAINT invoice_print_events_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_lines journal_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (id);


--
-- Name: legacy_product_asset_map legacy_product_asset_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_product_asset_map
    ADD CONSTRAINT legacy_product_asset_map_pkey PRIMARY KEY (id);


--
-- Name: loyalty_transactions loyalty_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_pkey PRIMARY KEY (id);


--
-- Name: manufacturing_order_inputs manufacturing_order_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_order_inputs
    ADD CONSTRAINT manufacturing_order_inputs_pkey PRIMARY KEY (id);


--
-- Name: manufacturing_order_outputs manufacturing_order_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_order_outputs
    ADD CONSTRAINT manufacturing_order_outputs_pkey PRIMARY KEY (id);


--
-- Name: manufacturing_orders manufacturing_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_orders
    ADD CONSTRAINT manufacturing_orders_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payslips payslips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_pkey PRIMARY KEY (id);


--
-- Name: pearl_size_master_data pearl_size_master_data_company_value_unit_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pearl_size_master_data
    ADD CONSTRAINT pearl_size_master_data_company_value_unit_uq UNIQUE (company_id, value, unit);


--
-- Name: pearl_size_master_data pearl_size_master_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pearl_size_master_data
    ADD CONSTRAINT pearl_size_master_data_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_name_key UNIQUE (name);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: processed_events processed_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_events
    ADD CONSTRAINT processed_events_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profile_master_data profile_master_data_company_category_value_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_master_data
    ADD CONSTRAINT profile_master_data_company_category_value_uq UNIQUE (company_id, category_key, canonical_value);


--
-- Name: profile_master_data profile_master_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_master_data
    ADD CONSTRAINT profile_master_data_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_item_asset_links purchase_order_item_asset_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_item_asset_links
    ADD CONSTRAINT purchase_order_item_asset_links_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_items purchase_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: reservation_amendment_items reservation_amendment_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_amendment_items
    ADD CONSTRAINT reservation_amendment_items_pkey PRIMARY KEY (id);


--
-- Name: reservation_amendments reservation_amendments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_amendments
    ADD CONSTRAINT reservation_amendments_pkey PRIMARY KEY (id);


--
-- Name: reservation_deposit_receipt_documents reservation_deposit_receipt_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_deposit_receipt_documents
    ADD CONSTRAINT reservation_deposit_receipt_documents_pkey PRIMARY KEY (id);


--
-- Name: reservation_deposit_receipt_sequences reservation_deposit_receipt_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_deposit_receipt_sequences
    ADD CONSTRAINT reservation_deposit_receipt_sequences_pkey PRIMARY KEY (company_id, branch_id, sequence_year);


--
-- Name: reservation_expiry_extensions reservation_expiry_extensions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_expiry_extensions
    ADD CONSTRAINT reservation_expiry_extensions_pkey PRIMARY KEY (id);


--
-- Name: reservation_items reservation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_items
    ADD CONSTRAINT reservation_items_pkey PRIMARY KEY (id);


--
-- Name: reservation_payment_applications reservation_payment_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_applications
    ADD CONSTRAINT reservation_payment_applications_pkey PRIMARY KEY (id);


--
-- Name: reservation_payment_transfers reservation_payment_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_transfers
    ADD CONSTRAINT reservation_payment_transfers_pkey PRIMARY KEY (id);


--
-- Name: reservation_payments reservation_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payments
    ADD CONSTRAINT reservation_payments_pkey PRIMARY KEY (id);


--
-- Name: reservation_refund_allocations reservation_refund_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refund_allocations
    ADD CONSTRAINT reservation_refund_allocations_pkey PRIMARY KEY (id);


--
-- Name: reservation_refunds reservation_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refunds
    ADD CONSTRAINT reservation_refunds_pkey PRIMARY KEY (id);


--
-- Name: reservation_renewals reservation_renewals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_renewals
    ADD CONSTRAINT reservation_renewals_pkey PRIMARY KEY (id);


--
-- Name: reservations reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_pkey PRIMARY KEY (id);


--
-- Name: rfid_scan_events rfid_scan_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_scan_events
    ADD CONSTRAINT rfid_scan_events_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: stock_audit_items stock_audit_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_audit_items
    ADD CONSTRAINT stock_audit_items_pkey PRIMARY KEY (id);


--
-- Name: stock_audits stock_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_audits
    ADD CONSTRAINT stock_audits_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: supplier_consignments supplier_consignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_consignments
    ADD CONSTRAINT supplier_consignments_pkey PRIMARY KEY (id);


--
-- Name: supplier_documents supplier_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_documents
    ADD CONSTRAINT supplier_documents_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: system_account_roles system_account_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account_roles
    ADD CONSTRAINT system_account_roles_pkey PRIMARY KEY (id);


--
-- Name: technical_account_sessions technical_account_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technical_account_sessions
    ADD CONSTRAINT technical_account_sessions_pkey PRIMARY KEY (id);


--
-- Name: technical_account_sessions technical_account_sessions_refresh_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technical_account_sessions
    ADD CONSTRAINT technical_account_sessions_refresh_token_hash_key UNIQUE (refresh_token_hash);


--
-- Name: transfer_items transfer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_pkey PRIMARY KEY (id);


--
-- Name: transfers transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: accounting_locks_company_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounting_locks_company_uq ON public.accounting_locks USING btree (company_id);


--
-- Name: accounts_company_branch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_company_branch_idx ON public.accounts USING btree (company_id, branch_id);


--
-- Name: accounts_company_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_company_code_unique ON public.accounts USING btree (company_id, code);


--
-- Name: approval_requests_financial_idempotency_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX approval_requests_financial_idempotency_uq ON public.approval_requests USING btree (company_id, operation_type, subject_type, subject_id, idempotency_key) WHERE ((type = 'financial-operation'::public.enum_approval_requests_type) AND (idempotency_key IS NOT NULL));


--
-- Name: approval_requests_financial_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_requests_financial_queue_idx ON public.approval_requests USING btree (company_id, operation_type, status, requested_at);


--
-- Name: asset_barcode_history_asset_revision_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_barcode_history_asset_revision_uq ON public.asset_barcode_history USING btree (asset_id, barcode_revision);


--
-- Name: asset_barcode_history_asset_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_barcode_history_asset_time_idx ON public.asset_barcode_history USING btree (company_id, asset_id, issued_at);


--
-- Name: asset_barcode_history_barcode_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_barcode_history_barcode_uq ON public.asset_barcode_history USING btree (barcode);


--
-- Name: asset_barcode_history_one_active_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_barcode_history_one_active_uq ON public.asset_barcode_history USING btree (asset_id) WHERE ((state)::text = 'ACTIVE'::text);


--
-- Name: asset_components_asset_sequence_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_components_asset_sequence_uq ON public.asset_components USING btree (asset_id, sequence);


--
-- Name: asset_current_valuations_scope_asof_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_current_valuations_scope_asof_idx ON public.asset_current_valuations USING btree (company_id, branch_id, as_of);


--
-- Name: asset_events_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_events_asset_id ON public.asset_events USING btree (asset_id);


--
-- Name: asset_events_asset_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_events_asset_occurred_idx ON public.asset_events USING btree (asset_id, occurred_at);


--
-- Name: asset_events_idempotency_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_events_idempotency_uq ON public.asset_events USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: asset_events_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_events_source_idx ON public.asset_events USING btree (source_type, source_id);


--
-- Name: asset_gemstone_component_settings_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_gemstone_component_settings_scope_idx ON public.asset_gemstone_component_settings USING btree (company_id, component_id, sequence);


--
-- Name: asset_lineage_pair_type_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_lineage_pair_type_uq ON public.asset_lineage_links USING btree (parent_asset_id, child_asset_id, relation_type);


--
-- Name: asset_missing_case_open_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_missing_case_open_uq ON public.asset_missing_cases USING btree (asset_id) WHERE ((status)::text = 'OPEN'::text);


--
-- Name: asset_origins_cgp_item_id_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_origins_cgp_item_id_uq ON public.asset_origins USING btree (cgp_item_id) WHERE (cgp_item_id IS NOT NULL);


--
-- Name: asset_pearl_component_size_master_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_pearl_component_size_master_idx ON public.asset_pearl_component_details USING btree (pearl_size_master_data_id);


--
-- Name: asset_profile_master_reference_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_profile_master_reference_scope_idx ON public.asset_profile_master_data_references USING btree (company_id, master_data_id);


--
-- Name: asset_purchase_cost_current_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_purchase_cost_current_uq ON public.asset_purchase_cost_revisions USING btree (asset_id) WHERE (is_current = true);


--
-- Name: asset_purchase_cost_revision_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_purchase_cost_revision_uq ON public.asset_purchase_cost_revisions USING btree (asset_id, revision_no);


--
-- Name: asset_return_reviews_scope_asset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_return_reviews_scope_asset_idx ON public.asset_return_reviews USING btree (company_id, branch_id, asset_id);


--
-- Name: asset_rfid_number_global_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_rfid_number_global_uq ON public.asset_rfid_assignments USING btree (rfid_number);


--
-- Name: asset_rfid_one_current_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_rfid_one_current_uq ON public.asset_rfid_assignments USING btree (asset_id) WHERE (is_current = true);


--
-- Name: asset_tag_print_idempotency_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_tag_print_idempotency_uq ON public.asset_tag_print_events USING btree (company_id, idempotency_key);


--
-- Name: assets_barcode_components_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assets_barcode_components_uq ON public.assets USING btree (company_id, inventory_code, item_code, karat_code, barcode_serial) WHERE ((inventory_code IS NOT NULL) AND (item_code IS NOT NULL) AND (karat_code IS NOT NULL) AND (barcode_serial IS NOT NULL));


--
-- Name: assets_barcode_global_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assets_barcode_global_uq ON public.assets USING btree (barcode);


--
-- Name: assets_company_barcode_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assets_company_barcode_uq ON public.assets USING btree (company_id, barcode) WHERE ((barcode IS NOT NULL) AND (btrim((barcode)::text) <> ''::text));


--
-- Name: assets_company_id_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_company_id_barcode ON public.assets USING btree (company_id, barcode);


--
-- Name: assets_company_rfid_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assets_company_rfid_uq ON public.assets USING btree (company_id, rfid) WHERE ((rfid IS NOT NULL) AND (btrim((rfid)::text) <> ''::text));


--
-- Name: assets_inventory_master_list_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_inventory_master_list_idx ON public.assets USING btree (company_id, branch_id, inventory_profile, operational_status, id);


--
-- Name: assets_location_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_location_status_idx ON public.assets USING btree (location_id, operational_status);


--
-- Name: assets_supplier_purchase_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_supplier_purchase_date_idx ON public.assets USING btree (supplier_id, purchase_date);


--
-- Name: attendance_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_company_id ON public.attendance USING btree (company_id);


--
-- Name: attendance_employee_id_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_employee_id_date ON public.attendance USING btree (employee_id, date);


--
-- Name: audit_logs_company_employee_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_company_employee_date_idx ON public.audit_logs USING btree (company_id, employee_id, date);


--
-- Name: audit_logs_company_id_correlation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_company_id_correlation_id ON public.audit_logs USING btree (company_id, correlation_id);


--
-- Name: audit_logs_device_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_device_session_idx ON public.audit_logs USING btree (device_session_id);


--
-- Name: audit_logs_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_employee_idx ON public.audit_logs USING btree (employee_id);


--
-- Name: audit_logs_hash_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_hash_version_idx ON public.audit_logs USING btree (hash_version);


--
-- Name: audit_logs_operator_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_operator_session_idx ON public.audit_logs USING btree (operator_session_id);


--
-- Name: audit_logs_technical_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_technical_user_idx ON public.audit_logs USING btree (technical_user_id);


--
-- Name: barcode_inventory_codes_company_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX barcode_inventory_codes_company_code_uq ON public.barcode_inventory_codes USING btree (company_id, code);


--
-- Name: barcode_item_codes_company_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX barcode_item_codes_company_code_uq ON public.barcode_item_codes USING btree (company_id, code);


--
-- Name: barcode_sequences_scope_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX barcode_sequences_scope_uq ON public.barcode_sequences USING btree (company_id, inventory_code, item_code, karat_code);


--
-- Name: branch_customers_company_branch_customer_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX branch_customers_company_branch_customer_uq ON public.branch_customers USING btree (company_id, branch_id, customer_id);


--
-- Name: branch_customers_company_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX branch_customers_company_customer_idx ON public.branch_customers USING btree (company_id, customer_id);


--
-- Name: branch_financial_mapping_active_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX branch_financial_mapping_active_uq ON public.branch_financial_mappings USING btree (company_id, branch_id, mapping_type, COALESCE(channel, ''::character varying)) WHERE (is_active = true);


--
-- Name: branch_financial_mapping_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX branch_financial_mapping_scope_idx ON public.branch_financial_mappings USING btree (company_id, branch_id, mapping_type);


--
-- Name: cash_register_sessions_close_idem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_register_sessions_close_idem_idx ON public.cash_register_sessions USING btree (close_idempotency_key);


--
-- Name: cash_register_sessions_one_open_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cash_register_sessions_one_open_uq ON public.cash_register_sessions USING btree (company_id, branch_id, cash_account_code) WHERE ((status)::text = 'OPEN'::text);


--
-- Name: cash_register_sessions_open_idem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_register_sessions_open_idem_idx ON public.cash_register_sessions USING btree (open_idempotency_key);


--
-- Name: cash_register_sessions_scope_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_register_sessions_scope_status_idx ON public.cash_register_sessions USING btree (company_id, branch_id, cash_account_code, status);


--
-- Name: cash_transactions_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_transactions_company_id ON public.cash_transactions USING btree (company_id);


--
-- Name: cash_transactions_company_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_transactions_company_idempotency_idx ON public.cash_transactions USING btree (company_id, idempotency_key);


--
-- Name: cash_transactions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_transactions_date ON public.cash_transactions USING btree (date);


--
-- Name: cash_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_transactions_type ON public.cash_transactions USING btree (type);


--
-- Name: cct_cash_transaction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cct_cash_transaction_idx ON public.customer_credit_transactions USING btree (cash_transaction_id);


--
-- Name: cct_company_customer_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cct_company_customer_created_idx ON public.customer_credit_transactions USING btree (company_id, customer_id, created_at);


--
-- Name: cct_company_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cct_company_source_idx ON public.customer_credit_transactions USING btree (company_id, source_type, source_id);


--
-- Name: cct_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cct_invoice_idx ON public.customer_credit_transactions USING btree (invoice_id);


--
-- Name: cct_journal_entry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cct_journal_entry_idx ON public.customer_credit_transactions USING btree (journal_entry_id);


--
-- Name: cgp_documents_business_governance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cgp_documents_business_governance_idx ON public.customer_gold_purchase_documents USING btree (company_id, branch_id, business_status, governance_status);


--
-- Name: cgp_documents_company_draft_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cgp_documents_company_draft_uq ON public.customer_gold_purchase_documents USING btree (company_id, draft_number);


--
-- Name: cgp_documents_company_posting_reference_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cgp_documents_company_posting_reference_uq ON public.customer_gold_purchase_documents USING btree (company_id, posting_reference);


--
-- Name: cgp_documents_customer_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cgp_documents_customer_date_idx ON public.customer_gold_purchase_documents USING btree (company_id, customer_id, transaction_date);


--
-- Name: cgp_documents_scope_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cgp_documents_scope_status_idx ON public.customer_gold_purchase_documents USING btree (company_id, branch_id, status);


--
-- Name: cgp_item_disposition_source_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cgp_item_disposition_source_uq ON public.cgp_item_dispositions USING btree (cgp_item_id);


--
-- Name: cgp_items_document_line_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cgp_items_document_line_uq ON public.customer_gold_purchase_items USING btree (document_id, line_number);


--
-- Name: cgp_items_karat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cgp_items_karat_idx ON public.customer_gold_purchase_items USING btree (karat);


--
-- Name: cgp_pricing_snapshots_item_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cgp_pricing_snapshots_item_uq ON public.cgp_pricing_snapshots USING btree (cgp_item_id);


--
-- Name: cgp_pricing_snapshots_market_quote_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cgp_pricing_snapshots_market_quote_idx ON public.cgp_pricing_snapshots USING btree (market_quote_id);


--
-- Name: cgp_pricing_snapshots_policy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cgp_pricing_snapshots_policy_idx ON public.cgp_pricing_snapshots USING btree (policy_id, policy_version);


--
-- Name: cgp_pricing_snapshots_scope_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cgp_pricing_snapshots_scope_document_idx ON public.cgp_pricing_snapshots USING btree (company_id, branch_id, cgp_document_id);


--
-- Name: cgp_reversal_compensations_event_domain_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cgp_reversal_compensations_event_domain_uq ON public.cgp_reversal_compensations USING btree (compensation_event_id, domain);


--
-- Name: cgp_reversal_compensations_request_domain_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cgp_reversal_compensations_request_domain_uq ON public.cgp_reversal_compensations USING btree (reversal_request_id, domain);


--
-- Name: cgp_reversal_requests_active_document_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cgp_reversal_requests_active_document_uq ON public.cgp_reversal_requests USING btree (cgp_document_id) WHERE ((status)::text = ANY ((ARRAY['REQUESTED'::character varying, 'HOLD_PENDING'::character varying, 'HELD'::character varying, 'COMPENSATING'::character varying])::text[]));


--
-- Name: cgp_reversal_requests_idempotency_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cgp_reversal_requests_idempotency_uq ON public.cgp_reversal_requests USING btree (company_id, idempotency_key);


--
-- Name: customer_attachments_company_id_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_attachments_company_id_customer_id ON public.customer_attachments USING btree (company_id, customer_id);


--
-- Name: customer_financial_liabilities_customer_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_financial_liabilities_customer_status_idx ON public.customer_financial_liabilities USING btree (company_id, customer_id, status);


--
-- Name: customer_financial_liabilities_source_event_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_financial_liabilities_source_event_uq ON public.customer_financial_liabilities USING btree (source_event_id);


--
-- Name: customer_gold_purchase_documents_governance_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_gold_purchase_documents_governance_status_idx ON public.customer_gold_purchase_documents USING btree (company_id, status, submitted_at);


--
-- Name: customer_gold_purchase_documents_revision_chain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_gold_purchase_documents_revision_chain_idx ON public.customer_gold_purchase_documents USING btree (company_id, root_document_id, revision_number);


--
-- Name: customer_timelines_company_event_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_timelines_company_event_uq ON public.customer_timelines USING btree (company_id, source_event_id);


--
-- Name: customer_timelines_customer_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_timelines_customer_occurred_idx ON public.customer_timelines USING btree (company_id, customer_id, occurred_at);


--
-- Name: customer_transaction_history_company_event_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_transaction_history_company_event_uq ON public.customer_transaction_history USING btree (company_id, source_event_id);


--
-- Name: customer_transaction_history_customer_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_transaction_history_customer_occurred_idx ON public.customer_transaction_history USING btree (company_id, customer_id, occurred_at);


--
-- Name: customers_company_id_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_company_id_phone ON public.customers USING btree (company_id, phone);


--
-- Name: email_change_tokens_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_change_tokens_expires_idx ON public.email_change_tokens USING btree (expires_at);


--
-- Name: email_change_tokens_user_used_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_change_tokens_user_used_idx ON public.email_change_tokens USING btree (user_id, used_at);


--
-- Name: employee_branch_access_branch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_branch_access_branch_idx ON public.employee_branch_access USING btree (branch_id);


--
-- Name: employee_branch_access_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_branch_access_employee_idx ON public.employee_branch_access USING btree (employee_id);


--
-- Name: employee_branch_access_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_branch_access_unique ON public.employee_branch_access USING btree (company_id, employee_id, branch_id);


--
-- Name: employee_code_history_company_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_code_history_company_employee_idx ON public.employee_code_history USING btree (company_id, employee_id, created_at);


--
-- Name: employee_code_history_new_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_code_history_new_code_idx ON public.employee_code_history USING btree (new_code);


--
-- Name: employee_credentials_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_credentials_company_idx ON public.employee_credentials USING btree (company_id);


--
-- Name: employee_credentials_employee_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_credentials_employee_uq ON public.employee_credentials USING btree (employee_id);


--
-- Name: employee_operator_sessions_active_user_device_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_operator_sessions_active_user_device_uq ON public.employee_operational_sessions USING btree (company_id, session_user_id, device_session_id) WHERE ((revoked_at IS NULL) AND (locked_at IS NULL));


--
-- Name: employee_operator_sessions_company_branch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_operator_sessions_company_branch_idx ON public.employee_operational_sessions USING btree (company_id, branch_id);


--
-- Name: employee_operator_sessions_company_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_operator_sessions_company_created_idx ON public.employee_operational_sessions USING btree (company_id, created_at);


--
-- Name: employee_operator_sessions_company_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_operator_sessions_company_employee_idx ON public.employee_operational_sessions USING btree (company_id, employee_id);


--
-- Name: employee_operator_sessions_company_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_operator_sessions_company_user_idx ON public.employee_operational_sessions USING btree (company_id, session_user_id);


--
-- Name: employee_operator_sessions_employee_revoked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_operator_sessions_employee_revoked_idx ON public.employee_operational_sessions USING btree (employee_id, revoked_at);


--
-- Name: employee_operator_sessions_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_operator_sessions_expiry_idx ON public.employee_operational_sessions USING btree (company_id, revoked_at, locked_at, idle_expires_at);


--
-- Name: employee_operator_sessions_user_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_operator_sessions_user_device_idx ON public.employee_operational_sessions USING btree (session_user_id, device_session_id);


--
-- Name: employee_permission_denials_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_permission_denials_employee_idx ON public.employee_permission_denials USING btree (employee_id);


--
-- Name: employee_permission_denials_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_permission_denials_unique ON public.employee_permission_denials USING btree (company_id, employee_id, permission_id);


--
-- Name: employee_permission_grants_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_permission_grants_employee_idx ON public.employee_permission_grants USING btree (employee_id);


--
-- Name: employee_permission_grants_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_permission_grants_unique ON public.employee_permission_grants USING btree (company_id, employee_id, permission_id);


--
-- Name: employee_role_assignments_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_role_assignments_employee_idx ON public.employee_role_assignments USING btree (employee_id);


--
-- Name: employee_role_assignments_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_role_assignments_unique ON public.employee_role_assignments USING btree (company_id, employee_id, role_id);


--
-- Name: employee_sessions_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_sessions_employee_id ON public.employee_sessions USING btree (employee_id);


--
-- Name: employee_verification_branch_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_verification_branch_created_idx ON public.employee_verification_attempts USING btree (branch_id, created_at);


--
-- Name: employee_verification_company_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_verification_company_created_idx ON public.employee_verification_attempts USING btree (company_id, created_at);


--
-- Name: employee_verification_employee_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_verification_employee_created_idx ON public.employee_verification_attempts USING btree (employee_id, created_at);


--
-- Name: employee_verification_result_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_verification_result_created_idx ON public.employee_verification_attempts USING btree (result, created_at);


--
-- Name: employee_verification_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_verification_user_created_idx ON public.employee_verification_attempts USING btree (technical_user_id, created_at);


--
-- Name: employees_company_code_normalized_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employees_company_code_normalized_uq ON public.employees USING btree (company_id, employee_code_normalized) WHERE (employee_code_normalized IS NOT NULL);


--
-- Name: employees_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employees_company_id ON public.employees USING btree (company_id);


--
-- Name: financial_approval_policy_context_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_approval_policy_context_idx ON public.financial_approval_policies USING btree (company_id, branch_id, currency, payment_method);


--
-- Name: financial_approval_policy_scope_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_approval_policy_scope_active_idx ON public.financial_approval_policies USING btree (company_id, operation_type, is_active);


--
-- Name: financial_settlement_allocations_liability_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_settlement_allocations_liability_idx ON public.financial_settlement_allocations USING btree (customer_financial_liability_id);


--
-- Name: financial_settlement_allocations_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX financial_settlement_allocations_uq ON public.financial_settlement_allocations USING btree (settlement_id, customer_financial_liability_id);


--
-- Name: financial_settlement_legs_settlement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_settlement_legs_settlement_idx ON public.financial_settlement_legs USING btree (settlement_id);


--
-- Name: financial_settlements_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_settlements_customer_idx ON public.financial_settlements USING btree (company_id, customer_id, executed_at);


--
-- Name: financial_settlements_idempotency_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX financial_settlements_idempotency_uq ON public.financial_settlements USING btree (company_id, operation_type, idempotency_key);


--
-- Name: gift_vouchers_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gift_vouchers_code ON public.gift_vouchers USING btree (code);


--
-- Name: gift_vouchers_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gift_vouchers_company_id ON public.gift_vouchers USING btree (company_id);


--
-- Name: gold_core_events_scope_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_core_events_scope_occurred_idx ON public.gold_core_events USING btree (company_id, branch_id, occurred_at);


--
-- Name: gold_core_events_source_event_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gold_core_events_source_event_uq ON public.gold_core_events USING btree (source_event_id);


--
-- Name: gold_fixings_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_fixings_company_id ON public.gold_fixings USING btree (company_id);


--
-- Name: gold_fixings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_fixings_status ON public.gold_fixings USING btree (status);


--
-- Name: gold_market_quotes_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_market_quotes_created_idx ON public.gold_market_quotes USING btree (created_at);


--
-- Name: gold_market_quotes_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_market_quotes_latest_idx ON public.gold_market_quotes USING btree (company_id, provider, currency, metal, quote_timestamp);


--
-- Name: gold_market_quotes_payload_identity_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gold_market_quotes_payload_identity_uq ON public.gold_market_quotes USING btree (company_id, provider, raw_payload_hash, quote_timestamp) WHERE (raw_payload_hash IS NOT NULL);


--
-- Name: gold_market_quotes_provider_identity_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gold_market_quotes_provider_identity_uq ON public.gold_market_quotes USING btree (company_id, provider, provider_quote_id) WHERE (provider_quote_id IS NOT NULL);


--
-- Name: gold_market_quotes_provider_quote_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_market_quotes_provider_quote_idx ON public.gold_market_quotes USING btree (provider_quote_id) WHERE (provider_quote_id IS NOT NULL);


--
-- Name: gold_market_quotes_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_market_quotes_status_idx ON public.gold_market_quotes USING btree (status);


--
-- Name: gold_prices_company_id_currency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_prices_company_id_currency_idx ON public.gold_prices USING btree (company_id, currency);


--
-- Name: gold_prices_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_prices_company_id_idx ON public.gold_prices USING btree (company_id);


--
-- Name: gold_prices_company_id_karat_currency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_prices_company_id_karat_currency_idx ON public.gold_prices USING btree (company_id, karat, currency);


--
-- Name: gold_prices_company_id_karat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_prices_company_id_karat_idx ON public.gold_prices USING btree (company_id, karat);


--
-- Name: gold_prices_one_current_approved_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gold_prices_one_current_approved_uq ON public.gold_prices USING btree (company_id, karat, currency) WHERE ((approval_status)::text = 'APPROVED'::text);


--
-- Name: gold_pricing_policies_resolution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_pricing_policies_resolution_idx ON public.gold_pricing_policies USING btree (company_id, business_context, scope_type, karat, status, effective_from);


--
-- Name: gold_pricing_policies_scope_version_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gold_pricing_policies_scope_version_uq ON public.gold_pricing_policies USING btree (company_id, business_context, scope_type, karat, version);


--
-- Name: gold_pricing_policies_supersedes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_pricing_policies_supersedes_idx ON public.gold_pricing_policies USING btree (supersedes_policy_id);


--
-- Name: gold_purchase_approval_one_pending_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gold_purchase_approval_one_pending_uq ON public.gold_purchase_approval_requests USING btree (document_id) WHERE (approval_status = 'pending'::public.enum_gold_purchase_approval_requests_approval_status);


--
-- Name: gold_purchase_approval_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_purchase_approval_queue_idx ON public.gold_purchase_approval_requests USING btree (company_id, branch_id, aggregate_type, approval_status, requested_at);


--
-- Name: gold_purchase_approval_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_purchase_approval_requester_idx ON public.gold_purchase_approval_requests USING btree (company_id, requested_by, requested_at);


--
-- Name: gold_purchase_approval_reviewer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gold_purchase_approval_reviewer_idx ON public.gold_purchase_approval_requests USING btree (company_id, reviewed_by, reviewed_at);


--
-- Name: idempotency_requests_company_scope_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idempotency_requests_company_scope_created_idx ON public.idempotency_requests USING btree (company_id, scope, created_at);


--
-- Name: idempotency_requests_company_scope_key_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idempotency_requests_company_scope_key_uq ON public.idempotency_requests USING btree (company_id, scope, key);


--
-- Name: idempotency_requests_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idempotency_requests_expires_idx ON public.idempotency_requests USING btree (expires_at);


--
-- Name: igp_documents_company_draft_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX igp_documents_company_draft_uq ON public.investment_gold_purchase_documents USING btree (company_id, draft_number);


--
-- Name: igp_documents_scope_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX igp_documents_scope_status_idx ON public.investment_gold_purchase_documents USING btree (company_id, branch_id, status);


--
-- Name: igp_documents_supplier_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX igp_documents_supplier_date_idx ON public.investment_gold_purchase_documents USING btree (company_id, supplier_id, purchase_date);


--
-- Name: igp_items_company_lot_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX igp_items_company_lot_uq ON public.investment_gold_purchase_items USING btree (company_id, lot_number) WHERE ((lot_number IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: igp_items_company_serial_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX igp_items_company_serial_uq ON public.investment_gold_purchase_items USING btree (company_id, serial_number) WHERE ((serial_number IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: igp_items_document_line_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX igp_items_document_line_uq ON public.investment_gold_purchase_items USING btree (document_id, line_number);


--
-- Name: igp_items_karat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX igp_items_karat_idx ON public.investment_gold_purchase_items USING btree (karat);


--
-- Name: igp_items_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX igp_items_type_idx ON public.investment_gold_purchase_items USING btree (investment_type, bullion_identity_type);


--
-- Name: installments_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX installments_company_id ON public.installments USING btree (company_id);


--
-- Name: installments_company_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX installments_company_idempotency_idx ON public.installments USING btree (company_id, idempotency_key);


--
-- Name: installments_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX installments_invoice_id ON public.installments USING btree (invoice_id);


--
-- Name: integration_statuses_aggregate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integration_statuses_aggregate_idx ON public.integration_statuses USING btree (aggregate_type, aggregate_id);


--
-- Name: integration_statuses_event_consumer_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX integration_statuses_event_consumer_uq ON public.integration_statuses USING btree (source_event_id, consumer_name);


--
-- Name: integration_statuses_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integration_statuses_retry_idx ON public.integration_statuses USING btree (status, next_retry_at);


--
-- Name: inventory_adjustment_idempotency_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_adjustment_idempotency_uq ON public.inventory_adjustments USING btree (company_id, idempotency_key);


--
-- Name: inventory_adjustment_item_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_adjustment_item_pair_uq ON public.inventory_adjustment_items USING btree (adjustment_id, asset_id);


--
-- Name: inventory_asset_movement_asset_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_asset_movement_asset_time_idx ON public.inventory_asset_movements USING btree (asset_id, occurred_at);


--
-- Name: inventory_asset_movement_event_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_asset_movement_event_uq ON public.inventory_asset_movements USING btree (asset_event_id) WHERE (asset_event_id IS NOT NULL);


--
-- Name: inventory_locations_company_branch_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_locations_company_branch_code_uq ON public.inventory_locations USING btree (company_id, branch_id, code);


--
-- Name: inventory_master_data_bootstrap_company_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_master_data_bootstrap_company_state_idx ON public.inventory_master_data_bootstrap_states USING btree (company_id, state);


--
-- Name: inventory_saved_view_one_default_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_saved_view_one_default_uq ON public.inventory_saved_views USING btree (company_id, COALESCE(owner_user_id, owner_employee_id)) WHERE (is_default AND (deleted_at IS NULL));


--
-- Name: inventory_saved_view_owner_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_saved_view_owner_name_uq ON public.inventory_saved_views USING btree (company_id, COALESCE(owner_user_id, owner_employee_id), name) WHERE (deleted_at IS NULL);


--
-- Name: inventory_source_link_classification_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_source_link_classification_uq ON public.inventory_source_link_classifications USING btree (source_table, source_row_id);


--
-- Name: inventory_workshop_item_active_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_workshop_item_active_uq ON public.inventory_workshop_items USING btree (asset_id) WHERE ((status)::text = ANY ((ARRAY['OPEN'::character varying, 'SENT'::character varying])::text[]));


--
-- Name: inventory_workshop_order_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_workshop_order_number_uq ON public.inventory_workshop_orders USING btree (company_id, order_number);


--
-- Name: investment_gold_purchase_documents_governance_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investment_gold_purchase_documents_governance_status_idx ON public.investment_gold_purchase_documents USING btree (company_id, status, submitted_at);


--
-- Name: investment_gold_purchase_documents_revision_chain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investment_gold_purchase_documents_revision_chain_idx ON public.investment_gold_purchase_documents USING btree (company_id, root_document_id, revision_number);


--
-- Name: invoice_item_asset_links_asset_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoice_item_asset_links_asset_uq ON public.invoice_item_asset_links USING btree (asset_id);


--
-- Name: invoice_item_asset_links_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoice_item_asset_links_pair_uq ON public.invoice_item_asset_links USING btree (invoice_item_id, asset_id);


--
-- Name: invoice_print_events_company_invoice_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_print_events_company_invoice_date_idx ON public.invoice_print_events USING btree (company_id, invoice_id, created_at);


--
-- Name: invoice_print_events_employee_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_print_events_employee_date_idx ON public.invoice_print_events USING btree (employee_id, created_at);


--
-- Name: invoice_print_events_invoice_copy_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoice_print_events_invoice_copy_uq ON public.invoice_print_events USING btree (invoice_id, copy_number);


--
-- Name: invoice_print_events_one_official_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoice_print_events_one_official_uq ON public.invoice_print_events USING btree (invoice_id) WHERE ((event_type)::text = 'official_print_authorized'::text);


--
-- Name: invoice_print_events_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_print_events_user_date_idx ON public.invoice_print_events USING btree (technical_user_id, created_at);


--
-- Name: invoices_branch_id_posting_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_branch_id_posting_status_idx ON public.invoices USING btree (branch_id, posting_status);


--
-- Name: invoices_company_created_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_company_created_employee_idx ON public.invoices USING btree (company_id, created_by_employee_id);


--
-- Name: invoices_company_finalized_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_company_finalized_employee_idx ON public.invoices USING btree (company_id, finalized_by_employee_id);


--
-- Name: invoices_company_id_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_company_id_customer_id ON public.invoices USING btree (company_id, customer_id);


--
-- Name: invoices_company_id_posting_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_company_id_posting_status_idx ON public.invoices USING btree (company_id, posting_status);


--
-- Name: invoices_company_invoice_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_company_invoice_number_idx ON public.invoices USING btree (company_id, invoice_number);


--
-- Name: invoices_company_invoice_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_company_invoice_number_unique ON public.invoices USING btree (company_id, invoice_number) WHERE (invoice_number IS NOT NULL);


--
-- Name: journal_entries_cgp_accounting_event_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX journal_entries_cgp_accounting_event_uq ON public.journal_entries USING btree (company_id, source_type, source_id) WHERE ((source_type)::text = 'CUSTOMER_GOLD_PURCHASE_ACCOUNTING_RECOGNITION'::text);


--
-- Name: journal_entries_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_company_id ON public.journal_entries USING btree (company_id);


--
-- Name: journal_entries_company_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX journal_entries_company_source_unique ON public.journal_entries USING btree (company_id, source_type, source_id) WHERE ((source_type IS NOT NULL) AND (source_id IS NOT NULL));


--
-- Name: legacy_product_asset_once_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legacy_product_asset_once_uq ON public.legacy_product_asset_map USING btree (asset_id) WHERE (asset_id IS NOT NULL);


--
-- Name: legacy_product_asset_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legacy_product_asset_pair_uq ON public.legacy_product_asset_map USING btree (product_id, asset_id);


--
-- Name: legacy_product_unmapped_classification_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legacy_product_unmapped_classification_uq ON public.legacy_product_asset_map USING btree (product_id) WHERE (asset_id IS NULL);


--
-- Name: loyalty_transactions_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_transactions_company_id ON public.loyalty_transactions USING btree (company_id);


--
-- Name: loyalty_transactions_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_transactions_customer_id ON public.loyalty_transactions USING btree (customer_id);


--
-- Name: manufacturing_order_inputs_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX manufacturing_order_inputs_pair_uq ON public.manufacturing_order_inputs USING btree (manufacturing_order_id, asset_id);


--
-- Name: manufacturing_order_outputs_asset_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX manufacturing_order_outputs_asset_uq ON public.manufacturing_order_outputs USING btree (asset_id);


--
-- Name: notifications_company_id_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_company_id_created_at ON public.notifications USING btree (company_id, created_at);


--
-- Name: notifications_company_id_user_id_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_company_id_user_id_is_read ON public.notifications USING btree (company_id, user_id, is_read);


--
-- Name: notifications_event_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notifications_event_key_unique ON public.notifications USING btree (company_id, event_key) WHERE (event_key IS NOT NULL);


--
-- Name: outbox_events_aggregate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_aggregate_idx ON public.outbox_events USING btree (aggregate_type, aggregate_id);


--
-- Name: outbox_events_dispatch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_dispatch_idx ON public.outbox_events USING btree (status, available_at);


--
-- Name: outbox_events_event_id_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outbox_events_event_id_uq ON public.outbox_events USING btree (event_id);


--
-- Name: password_reset_tokens_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_tokens_expires_idx ON public.password_reset_tokens USING btree (expires_at);


--
-- Name: password_reset_tokens_user_used_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_tokens_user_used_idx ON public.password_reset_tokens USING btree (user_id, used_at);


--
-- Name: payments_company_received_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_company_received_employee_idx ON public.payments USING btree (company_id, received_by_employee_id);


--
-- Name: payslips_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payslips_company_id ON public.payslips USING btree (company_id);


--
-- Name: payslips_company_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payslips_company_idempotency_idx ON public.payslips USING btree (company_id, idempotency_key);


--
-- Name: payslips_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payslips_period ON public.payslips USING btree (period);


--
-- Name: pearl_size_master_data_company_active_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pearl_size_master_data_company_active_sort_idx ON public.pearl_size_master_data USING btree (company_id, is_active, sort_order);


--
-- Name: po_item_asset_links_asset_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX po_item_asset_links_asset_uq ON public.purchase_order_item_asset_links USING btree (asset_id);


--
-- Name: po_item_asset_links_ordinal_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX po_item_asset_links_ordinal_uq ON public.purchase_order_item_asset_links USING btree (purchase_order_item_id, ordinal);


--
-- Name: processed_events_consumer_event_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX processed_events_consumer_event_uq ON public.processed_events USING btree (consumer_name, event_id);


--
-- Name: products_company_product_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_company_product_code_uq ON public.products USING btree (company_id, product_code);


--
-- Name: profile_master_data_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_master_data_scope_idx ON public.profile_master_data USING btree (company_id, category_key, is_active, sort_order);


--
-- Name: purchase_orders_company_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_orders_company_idempotency_idx ON public.purchase_orders USING btree (company_id, idempotency_key);


--
-- Name: reservation_amendment_items_amendment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_amendment_items_amendment_idx ON public.reservation_amendment_items USING btree (amendment_id);


--
-- Name: reservation_amendments_idem_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_amendments_idem_unique ON public.reservation_amendments USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: reservation_amendments_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_amendments_reservation_idx ON public.reservation_amendments USING btree (reservation_id);


--
-- Name: reservation_deposit_receipt_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_deposit_receipt_history_idx ON public.reservation_deposit_receipt_documents USING btree (company_id, reservation_id, posted_at, id);


--
-- Name: reservation_deposit_receipt_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_deposit_receipt_number_uq ON public.reservation_deposit_receipt_documents USING btree (receipt_number);


--
-- Name: reservation_deposit_receipt_payment_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_deposit_receipt_payment_uq ON public.reservation_deposit_receipt_documents USING btree (reservation_payment_id);


--
-- Name: reservation_deposit_receipt_sequence_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_deposit_receipt_sequence_uq ON public.reservation_deposit_receipt_documents USING btree (company_id, branch_id, sequence_year, sequence_value);


--
-- Name: reservation_expiry_extensions_idem_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_expiry_extensions_idem_unique ON public.reservation_expiry_extensions USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: reservation_expiry_extensions_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_expiry_extensions_reservation_idx ON public.reservation_expiry_extensions USING btree (reservation_id);


--
-- Name: reservation_items_active_asset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_items_active_asset_unique ON public.reservation_items USING btree (company_id, asset_id) WHERE (status = 'active'::public.enum_reservation_items_status);


--
-- Name: reservation_items_company_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_items_company_reservation_idx ON public.reservation_items USING btree (company_id, reservation_id);


--
-- Name: reservation_items_reservation_asset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_items_reservation_asset_unique ON public.reservation_items USING btree (company_id, reservation_id, asset_id);


--
-- Name: reservation_payment_applications_idem_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_payment_applications_idem_uq ON public.reservation_payment_applications USING btree (company_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND ((idempotency_key)::text <> ''::text));


--
-- Name: reservation_payment_applications_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_payment_applications_invoice_idx ON public.reservation_payment_applications USING btree (company_id, final_invoice_id);


--
-- Name: reservation_payment_applications_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_payment_applications_reservation_idx ON public.reservation_payment_applications USING btree (company_id, reservation_id);


--
-- Name: reservation_payment_transfers_renewal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_payment_transfers_renewal_idx ON public.reservation_payment_transfers USING btree (renewal_id);


--
-- Name: reservation_payment_transfers_source_payment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_payment_transfers_source_payment_idx ON public.reservation_payment_transfers USING btree (source_payment_id);


--
-- Name: reservation_payments_company_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_payments_company_reservation_idx ON public.reservation_payments USING btree (company_id, reservation_id);


--
-- Name: reservation_payments_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_payments_idempotency_unique ON public.reservation_payments USING btree (company_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND ((idempotency_key)::text <> ''::text));


--
-- Name: reservation_payments_receipt_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_payments_receipt_unique ON public.reservation_payments USING btree (company_id, receipt_number);


--
-- Name: reservation_refund_allocations_payment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_refund_allocations_payment_unique ON public.reservation_refund_allocations USING btree (company_id, reservation_refund_id, reservation_payment_id);


--
-- Name: reservation_refund_allocations_refund_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_refund_allocations_refund_idx ON public.reservation_refund_allocations USING btree (company_id, reservation_refund_id);


--
-- Name: reservation_refunds_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_refunds_idempotency_unique ON public.reservation_refunds USING btree (company_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND ((idempotency_key)::text <> ''::text));


--
-- Name: reservation_refunds_one_open_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_refunds_one_open_unique ON public.reservation_refunds USING btree (company_id, reservation_id) WHERE (status = ANY (ARRAY['requested'::public.enum_reservation_refunds_status, 'approved'::public.enum_reservation_refunds_status]));


--
-- Name: reservation_refunds_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_refunds_reservation_idx ON public.reservation_refunds USING btree (company_id, reservation_id);


--
-- Name: reservation_refunds_scope_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_refunds_scope_status_idx ON public.reservation_refunds USING btree (company_id, reservation_id, status);


--
-- Name: reservation_renewals_idem_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_renewals_idem_unique ON public.reservation_renewals USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: reservation_renewals_one_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservation_renewals_one_active_unique ON public.reservation_renewals USING btree (company_id, source_reservation_id) WHERE (status = ANY (ARRAY['requested'::public.enum_reservation_renewals_status, 'pending_excess_refund'::public.enum_reservation_renewals_status, 'ready_to_activate'::public.enum_reservation_renewals_status, 'activated'::public.enum_reservation_renewals_status]));


--
-- Name: reservation_renewals_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_renewals_source_idx ON public.reservation_renewals USING btree (source_reservation_id);


--
-- Name: reservations_final_invoice_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservations_final_invoice_unique ON public.reservations USING btree (company_id, final_invoice_id) WHERE (final_invoice_id IS NOT NULL);


--
-- Name: reservations_successor_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservations_successor_unique ON public.reservations USING btree (company_id, successor_reservation_id) WHERE (successor_reservation_id IS NOT NULL);


--
-- Name: rfid_scan_events_asset_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rfid_scan_events_asset_time_idx ON public.rfid_scan_events USING btree (asset_id, scanned_at);


--
-- Name: roles_company_id_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_company_id_slug ON public.roles USING btree (company_id, slug);


--
-- Name: stock_audit_items_asset_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stock_audit_items_asset_uq ON public.stock_audit_items USING btree (stock_audit_id, asset_id);


--
-- Name: stock_audits_company_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stock_audits_company_number_uq ON public.stock_audits USING btree (company_id, audit_number);


--
-- Name: stock_movements_asset_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_asset_id_idx ON public.stock_movements USING btree (asset_id);


--
-- Name: suppliers_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppliers_company_id ON public.suppliers USING btree (company_id);


--
-- Name: system_account_roles_company_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_account_roles_company_account_idx ON public.system_account_roles USING btree (company_id, account_id);


--
-- Name: system_account_roles_company_branch_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_account_roles_company_branch_account_idx ON public.system_account_roles USING btree (company_id, branch_id, account_id);


--
-- Name: system_account_roles_company_branch_role_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX system_account_roles_company_branch_role_uq ON public.system_account_roles USING btree (company_id, branch_id, role_code) WHERE (branch_id IS NOT NULL);


--
-- Name: system_account_roles_company_legacy_role_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX system_account_roles_company_legacy_role_uq ON public.system_account_roles USING btree (company_id, role_code) WHERE (branch_id IS NULL);


--
-- Name: technical_sessions_company_branch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX technical_sessions_company_branch_idx ON public.technical_account_sessions USING btree (company_id, branch_id);


--
-- Name: technical_sessions_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX technical_sessions_expires_idx ON public.technical_account_sessions USING btree (expires_at);


--
-- Name: technical_sessions_revoked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX technical_sessions_revoked_idx ON public.technical_account_sessions USING btree (revoked_at);


--
-- Name: technical_sessions_user_revoked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX technical_sessions_user_revoked_idx ON public.technical_account_sessions USING btree (user_id, revoked_at);


--
-- Name: transfer_items_one_active_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX transfer_items_one_active_uq ON public.transfer_items USING btree (asset_id) WHERE ((status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'IN_TRANSIT'::character varying])::text[]));


--
-- Name: transfer_items_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX transfer_items_pair_uq ON public.transfer_items USING btree (transfer_id, asset_id);


--
-- Name: users_account_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_account_type_idx ON public.users USING btree (account_type);


--
-- Name: users_branch_shell_one_per_branch_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_branch_shell_one_per_branch_uq ON public.users USING btree (branch_id) WHERE (((account_type)::text = 'branch_shell'::text) AND (deleted_at IS NULL) AND (branch_id IS NOT NULL));


--
-- Name: users_company_branch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_company_branch_idx ON public.users USING btree (company_id, branch_id);


--
-- Name: users_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_company_id ON public.users USING btree (company_id);


--
-- Name: users_default_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_default_employee_idx ON public.users USING btree (default_employee_id);


--
-- Name: users_is_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_is_active_idx ON public.users USING btree (is_active);


--
-- Name: users_locked_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_locked_until_idx ON public.users USING btree (locked_until);


--
-- Name: asset_events asset_events_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_events_immutable_trg BEFORE DELETE OR UPDATE ON public.asset_events FOR EACH ROW EXECUTE FUNCTION public.inventory_evidence_immutable_guard();


--
-- Name: asset_origins asset_origins_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_origins_immutable_trg BEFORE DELETE OR UPDATE ON public.asset_origins FOR EACH ROW EXECUTE FUNCTION public.inventory_evidence_immutable_guard();


--
-- Name: asset_purchase_cost_revisions asset_purchase_cost_revisions_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_purchase_cost_revisions_immutable_trg BEFORE DELETE OR UPDATE ON public.asset_purchase_cost_revisions FOR EACH ROW EXECUTE FUNCTION public.inventory_evidence_immutable_guard();


--
-- Name: asset_tag_print_events asset_tag_print_events_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_tag_print_events_immutable_trg BEFORE DELETE OR UPDATE ON public.asset_tag_print_events FOR EACH ROW EXECUTE FUNCTION public.inventory_evidence_immutable_guard();


--
-- Name: assets assets_barcode_history_insert_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER assets_barcode_history_insert_trg AFTER INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION public.inventory_asset_barcode_history_insert_guard();


--
-- Name: assets assets_barcode_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER assets_barcode_immutable_trg BEFORE UPDATE OF barcode ON public.assets FOR EACH ROW EXECUTE FUNCTION public.inventory_asset_identity_guard();


--
-- Name: assets assets_hard_delete_forbidden_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER assets_hard_delete_forbidden_trg BEFORE DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.inventory_asset_identity_guard();


--
-- Name: assets assets_legacy_inventory_compatibility_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER assets_legacy_inventory_compatibility_trg BEFORE INSERT OR UPDATE OF type, inventory_subtype, karat, source, status ON public.assets FOR EACH ROW EXECUTE FUNCTION public.inventory_legacy_asset_compatibility_guard();


--
-- Name: inventory_asset_movements inventory_asset_movements_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inventory_asset_movements_immutable_trg BEFORE DELETE OR UPDATE ON public.inventory_asset_movements FOR EACH ROW EXECUTE FUNCTION public.inventory_evidence_immutable_guard();


--
-- Name: rfid_scan_events rfid_scan_events_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rfid_scan_events_immutable_trg BEFORE DELETE OR UPDATE ON public.rfid_scan_events FOR EACH ROW EXECUTE FUNCTION public.inventory_evidence_immutable_guard();


--
-- Name: accounting_locks accounting_locks_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_locks
    ADD CONSTRAINT accounting_locks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: accounts accounts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: accounts accounts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: accounts accounts_parent_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_id_fk FOREIGN KEY (parent_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: approval_requests approval_requests_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: approval_requests approval_requests_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: approval_requests approval_requests_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.financial_approval_policies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_attachments asset_attachments_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_attachments
    ADD CONSTRAINT asset_attachments_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset_barcode_history asset_barcode_history_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_barcode_history
    ADD CONSTRAINT asset_barcode_history_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_barcode_history asset_barcode_history_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_barcode_history
    ADD CONSTRAINT asset_barcode_history_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_certificates asset_certificates_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_certificates
    ADD CONSTRAINT asset_certificates_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset_components asset_components_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_components
    ADD CONSTRAINT asset_components_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_components asset_components_certificate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_components
    ADD CONSTRAINT asset_components_certificate_id_fkey FOREIGN KEY (certificate_id) REFERENCES public.asset_certificates(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_components asset_components_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_components
    ADD CONSTRAINT asset_components_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_current_valuations asset_current_valuations_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_current_valuations
    ADD CONSTRAINT asset_current_valuations_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_current_valuations asset_current_valuations_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_current_valuations
    ADD CONSTRAINT asset_current_valuations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_current_valuations asset_current_valuations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_current_valuations
    ADD CONSTRAINT asset_current_valuations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_diamond_component_details asset_diamond_component_details_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_diamond_component_details
    ADD CONSTRAINT asset_diamond_component_details_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.asset_components(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_events asset_events_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_events
    ADD CONSTRAINT asset_events_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset_events asset_events_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_events
    ADD CONSTRAINT asset_events_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_events asset_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_events
    ADD CONSTRAINT asset_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_gemstone_component_details asset_gemstone_component_details_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gemstone_component_details
    ADD CONSTRAINT asset_gemstone_component_details_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.asset_components(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_gemstone_component_settings asset_gemstone_component_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gemstone_component_settings
    ADD CONSTRAINT asset_gemstone_component_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_gemstone_component_settings asset_gemstone_component_settings_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gemstone_component_settings
    ADD CONSTRAINT asset_gemstone_component_settings_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.asset_components(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_gemstone_component_settings asset_gemstone_component_settings_master_data_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gemstone_component_settings
    ADD CONSTRAINT asset_gemstone_component_settings_master_data_id_fkey FOREIGN KEY (master_data_id) REFERENCES public.profile_master_data(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_gold_details asset_gold_details_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gold_details
    ADD CONSTRAINT asset_gold_details_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_gold_details asset_gold_details_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gold_details
    ADD CONSTRAINT asset_gold_details_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_lineage_links asset_lineage_links_child_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_lineage_links
    ADD CONSTRAINT asset_lineage_links_child_asset_id_fkey FOREIGN KEY (child_asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_lineage_links asset_lineage_links_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_lineage_links
    ADD CONSTRAINT asset_lineage_links_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_lineage_links asset_lineage_links_parent_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_lineage_links
    ADD CONSTRAINT asset_lineage_links_parent_asset_id_fkey FOREIGN KEY (parent_asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_missing_cases asset_missing_cases_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_missing_cases
    ADD CONSTRAINT asset_missing_cases_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_missing_cases asset_missing_cases_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_missing_cases
    ADD CONSTRAINT asset_missing_cases_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_missing_cases asset_missing_cases_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_missing_cases
    ADD CONSTRAINT asset_missing_cases_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_missing_cases asset_missing_cases_prior_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_missing_cases
    ADD CONSTRAINT asset_missing_cases_prior_location_id_fkey FOREIGN KEY (prior_location_id) REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_origins asset_origins_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_origins
    ADD CONSTRAINT asset_origins_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_origins asset_origins_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_origins
    ADD CONSTRAINT asset_origins_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_origins asset_origins_cgp_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_origins
    ADD CONSTRAINT asset_origins_cgp_item_id_fkey FOREIGN KEY (cgp_item_id) REFERENCES public.customer_gold_purchase_items(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_origins asset_origins_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_origins
    ADD CONSTRAINT asset_origins_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_origins asset_origins_legacy_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_origins
    ADD CONSTRAINT asset_origins_legacy_product_id_fkey FOREIGN KEY (legacy_product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_origins asset_origins_manufacturing_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_origins
    ADD CONSTRAINT asset_origins_manufacturing_order_id_fkey FOREIGN KEY (manufacturing_order_id) REFERENCES public.manufacturing_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_origins asset_origins_purchase_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_origins
    ADD CONSTRAINT asset_origins_purchase_order_item_id_fkey FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_pearl_component_details asset_pearl_component_details_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_pearl_component_details
    ADD CONSTRAINT asset_pearl_component_details_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.asset_components(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_pearl_component_details asset_pearl_component_details_pearl_size_master_data_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_pearl_component_details
    ADD CONSTRAINT asset_pearl_component_details_pearl_size_master_data_id_fkey FOREIGN KEY (pearl_size_master_data_id) REFERENCES public.pearl_size_master_data(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_pricing_policies asset_pricing_policies_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_pricing_policies
    ADD CONSTRAINT asset_pricing_policies_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_pricing_policies asset_pricing_policies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_pricing_policies
    ADD CONSTRAINT asset_pricing_policies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_profile_master_data_references asset_profile_master_data_references_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_profile_master_data_references
    ADD CONSTRAINT asset_profile_master_data_references_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_profile_master_data_references asset_profile_master_data_references_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_profile_master_data_references
    ADD CONSTRAINT asset_profile_master_data_references_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_profile_master_data_references asset_profile_master_data_references_master_data_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_profile_master_data_references
    ADD CONSTRAINT asset_profile_master_data_references_master_data_id_fkey FOREIGN KEY (master_data_id) REFERENCES public.profile_master_data(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_purchase_cost_revisions asset_purchase_cost_revisions_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_purchase_cost_revisions
    ADD CONSTRAINT asset_purchase_cost_revisions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_purchase_cost_revisions asset_purchase_cost_revisions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_purchase_cost_revisions
    ADD CONSTRAINT asset_purchase_cost_revisions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_purchase_cost_revisions asset_purchase_cost_revisions_cgp_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_purchase_cost_revisions
    ADD CONSTRAINT asset_purchase_cost_revisions_cgp_item_id_fkey FOREIGN KEY (cgp_item_id) REFERENCES public.customer_gold_purchase_items(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_purchase_cost_revisions asset_purchase_cost_revisions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_purchase_cost_revisions
    ADD CONSTRAINT asset_purchase_cost_revisions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_purchase_cost_revisions asset_purchase_cost_revisions_purchase_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_purchase_cost_revisions
    ADD CONSTRAINT asset_purchase_cost_revisions_purchase_order_item_id_fkey FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_purchase_cost_revisions asset_purchase_cost_revisions_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_purchase_cost_revisions
    ADD CONSTRAINT asset_purchase_cost_revisions_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.asset_purchase_cost_revisions(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_purchase_cost_revisions asset_purchase_cost_revisions_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_purchase_cost_revisions
    ADD CONSTRAINT asset_purchase_cost_revisions_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_return_reviews asset_return_reviews_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_return_reviews
    ADD CONSTRAINT asset_return_reviews_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE RESTRICT;


--
-- Name: asset_return_reviews asset_return_reviews_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_return_reviews
    ADD CONSTRAINT asset_return_reviews_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: asset_return_reviews asset_return_reviews_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_return_reviews
    ADD CONSTRAINT asset_return_reviews_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;


--
-- Name: asset_return_reviews asset_return_reviews_return_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_return_reviews
    ADD CONSTRAINT asset_return_reviews_return_invoice_id_fkey FOREIGN KEY (return_invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT;


--
-- Name: asset_rfid_assignments asset_rfid_assignments_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_rfid_assignments
    ADD CONSTRAINT asset_rfid_assignments_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_rfid_assignments asset_rfid_assignments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_rfid_assignments
    ADD CONSTRAINT asset_rfid_assignments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_rfid_assignments asset_rfid_assignments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_rfid_assignments
    ADD CONSTRAINT asset_rfid_assignments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_tag_print_events asset_tag_print_events_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_tag_print_events
    ADD CONSTRAINT asset_tag_print_events_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_tag_print_events asset_tag_print_events_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_tag_print_events
    ADD CONSTRAINT asset_tag_print_events_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asset_tag_print_events asset_tag_print_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_tag_print_events
    ADD CONSTRAINT asset_tag_print_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: assets assets_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assets assets_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: assets assets_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: attendance attendance_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: branch_customers branch_customers_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_customers
    ADD CONSTRAINT branch_customers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: branch_customers branch_customers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_customers
    ADD CONSTRAINT branch_customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: branch_customers branch_customers_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_customers
    ADD CONSTRAINT branch_customers_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: branch_financial_mappings branch_financial_mappings_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_financial_mappings
    ADD CONSTRAINT branch_financial_mappings_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: branch_financial_mappings branch_financial_mappings_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_financial_mappings
    ADD CONSTRAINT branch_financial_mappings_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: branch_financial_mappings branch_financial_mappings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_financial_mappings
    ADD CONSTRAINT branch_financial_mappings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: branches branches_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cash_register_sessions cash_register_sessions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_register_sessions
    ADD CONSTRAINT cash_register_sessions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cash_register_sessions cash_register_sessions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_register_sessions
    ADD CONSTRAINT cash_register_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cash_transactions cash_transactions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transactions
    ADD CONSTRAINT cash_transactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cgp_item_dispositions cgp_item_dispositions_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_item_dispositions
    ADD CONSTRAINT cgp_item_dispositions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_item_dispositions cgp_item_dispositions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_item_dispositions
    ADD CONSTRAINT cgp_item_dispositions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_item_dispositions cgp_item_dispositions_cgp_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_item_dispositions
    ADD CONSTRAINT cgp_item_dispositions_cgp_item_id_fkey FOREIGN KEY (cgp_item_id) REFERENCES public.customer_gold_purchase_items(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_item_dispositions cgp_item_dispositions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_item_dispositions
    ADD CONSTRAINT cgp_item_dispositions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_item_dispositions cgp_item_dispositions_gold_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_item_dispositions
    ADD CONSTRAINT cgp_item_dispositions_gold_pool_id_fkey FOREIGN KEY (gold_pool_id) REFERENCES public.customer_gold_pools(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_approved_price_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_approved_price_by_fkey FOREIGN KEY (approved_price_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_approved_price_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_approved_price_id_fkey FOREIGN KEY (approved_price_id) REFERENCES public.gold_prices(id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_cgp_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_cgp_document_id_fkey FOREIGN KEY (cgp_document_id) REFERENCES public.customer_gold_purchase_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_cgp_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_cgp_item_id_fkey FOREIGN KEY (cgp_item_id) REFERENCES public.customer_gold_purchase_items(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_market_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_market_quote_id_fkey FOREIGN KEY (market_quote_id) REFERENCES public.gold_market_quotes(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_pricing_snapshots cgp_pricing_snapshots_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_pricing_snapshots
    ADD CONSTRAINT cgp_pricing_snapshots_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.gold_pricing_policies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_compensations cgp_reversal_compensations_compensation_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_compensations
    ADD CONSTRAINT cgp_reversal_compensations_compensation_event_id_fkey FOREIGN KEY (compensation_event_id) REFERENCES public.outbox_events(event_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_compensations cgp_reversal_compensations_gold_core_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_compensations
    ADD CONSTRAINT cgp_reversal_compensations_gold_core_event_id_fkey FOREIGN KEY (gold_core_event_id) REFERENCES public.gold_core_events(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_compensations cgp_reversal_compensations_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_compensations
    ADD CONSTRAINT cgp_reversal_compensations_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_compensations cgp_reversal_compensations_reversal_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_compensations
    ADD CONSTRAINT cgp_reversal_compensations_reversal_request_id_fkey FOREIGN KEY (reversal_request_id) REFERENCES public.cgp_reversal_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_requests cgp_reversal_requests_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_requests
    ADD CONSTRAINT cgp_reversal_requests_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_requests cgp_reversal_requests_cgp_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_requests
    ADD CONSTRAINT cgp_reversal_requests_cgp_document_id_fkey FOREIGN KEY (cgp_document_id) REFERENCES public.customer_gold_purchase_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_requests cgp_reversal_requests_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_requests
    ADD CONSTRAINT cgp_reversal_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_requests cgp_reversal_requests_compensation_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_requests
    ADD CONSTRAINT cgp_reversal_requests_compensation_event_id_fkey FOREIGN KEY (compensation_event_id) REFERENCES public.outbox_events(event_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_requests cgp_reversal_requests_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_requests
    ADD CONSTRAINT cgp_reversal_requests_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_requests cgp_reversal_requests_posted_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_requests
    ADD CONSTRAINT cgp_reversal_requests_posted_event_id_fkey FOREIGN KEY (posted_event_id) REFERENCES public.outbox_events(event_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cgp_reversal_requests cgp_reversal_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cgp_reversal_requests
    ADD CONSTRAINT cgp_reversal_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_attachments customer_attachments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_attachments
    ADD CONSTRAINT customer_attachments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: customer_attachments customer_attachments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_attachments
    ADD CONSTRAINT customer_attachments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: customer_financial_liabilities customer_financial_liabilities_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_financial_liabilities
    ADD CONSTRAINT customer_financial_liabilities_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_financial_liabilities customer_financial_liabilities_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_financial_liabilities
    ADD CONSTRAINT customer_financial_liabilities_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_financial_liabilities customer_financial_liabilities_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_financial_liabilities
    ADD CONSTRAINT customer_financial_liabilities_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_financial_liabilities customer_financial_liabilities_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_financial_liabilities
    ADD CONSTRAINT customer_financial_liabilities_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_financial_liabilities customer_financial_liabilities_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_financial_liabilities
    ADD CONSTRAINT customer_financial_liabilities_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.customer_gold_purchase_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_financial_liabilities customer_financial_liabilities_source_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_financial_liabilities
    ADD CONSTRAINT customer_financial_liabilities_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES public.outbox_events(event_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_gold_pools customer_gold_pools_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_pools
    ADD CONSTRAINT customer_gold_pools_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_last_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_last_rejected_by_fkey FOREIGN KEY (last_rejected_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_posted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_validated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: customer_gold_purchase_documents customer_gold_purchase_documents_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_documents
    ADD CONSTRAINT customer_gold_purchase_documents_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: customer_gold_purchase_items customer_gold_purchase_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_items
    ADD CONSTRAINT customer_gold_purchase_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_gold_purchase_items customer_gold_purchase_items_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_gold_purchase_items
    ADD CONSTRAINT customer_gold_purchase_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.customer_gold_purchase_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_timelines customer_timelines_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_timelines
    ADD CONSTRAINT customer_timelines_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_timelines customer_timelines_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_timelines
    ADD CONSTRAINT customer_timelines_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_timelines customer_timelines_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_timelines
    ADD CONSTRAINT customer_timelines_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_transaction_history customer_transaction_history_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_transaction_history
    ADD CONSTRAINT customer_transaction_history_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_transaction_history customer_transaction_history_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_transaction_history
    ADD CONSTRAINT customer_transaction_history_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_transaction_history customer_transaction_history_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_transaction_history
    ADD CONSTRAINT customer_transaction_history_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customers customers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: email_change_tokens email_change_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_change_tokens
    ADD CONSTRAINT email_change_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_branch_access employee_branch_access_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_branch_access
    ADD CONSTRAINT employee_branch_access_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_branch_access employee_branch_access_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_branch_access
    ADD CONSTRAINT employee_branch_access_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_branch_access employee_branch_access_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_branch_access
    ADD CONSTRAINT employee_branch_access_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_branch_access employee_branch_access_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_branch_access
    ADD CONSTRAINT employee_branch_access_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_code_history employee_code_history_changed_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_code_history
    ADD CONSTRAINT employee_code_history_changed_by_employee_id_fkey FOREIGN KEY (changed_by_employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_code_history employee_code_history_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_code_history
    ADD CONSTRAINT employee_code_history_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_code_history employee_code_history_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_code_history
    ADD CONSTRAINT employee_code_history_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_code_history employee_code_history_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_code_history
    ADD CONSTRAINT employee_code_history_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_credentials employee_credentials_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_credentials
    ADD CONSTRAINT employee_credentials_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_credentials employee_credentials_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_credentials
    ADD CONSTRAINT employee_credentials_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_credentials employee_credentials_reset_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_credentials
    ADD CONSTRAINT employee_credentials_reset_by_user_id_fkey FOREIGN KEY (reset_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_operational_sessions employee_operational_sessions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_operational_sessions
    ADD CONSTRAINT employee_operational_sessions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_operational_sessions employee_operational_sessions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_operational_sessions
    ADD CONSTRAINT employee_operational_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_operational_sessions employee_operational_sessions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_operational_sessions
    ADD CONSTRAINT employee_operational_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_operational_sessions employee_operational_sessions_session_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_operational_sessions
    ADD CONSTRAINT employee_operational_sessions_session_user_id_fkey FOREIGN KEY (session_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_permission_denials employee_permission_denials_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_denials
    ADD CONSTRAINT employee_permission_denials_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_permission_denials employee_permission_denials_denied_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_denials
    ADD CONSTRAINT employee_permission_denials_denied_by_user_id_fkey FOREIGN KEY (denied_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_permission_denials employee_permission_denials_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_denials
    ADD CONSTRAINT employee_permission_denials_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_permission_denials employee_permission_denials_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_denials
    ADD CONSTRAINT employee_permission_denials_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_permission_grants employee_permission_grants_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_grants
    ADD CONSTRAINT employee_permission_grants_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_permission_grants employee_permission_grants_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_grants
    ADD CONSTRAINT employee_permission_grants_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_permission_grants employee_permission_grants_granted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_grants
    ADD CONSTRAINT employee_permission_grants_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_permission_grants employee_permission_grants_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permission_grants
    ADD CONSTRAINT employee_permission_grants_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_role_assignments employee_role_assignments_assigned_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignments
    ADD CONSTRAINT employee_role_assignments_assigned_by_user_id_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_role_assignments employee_role_assignments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignments
    ADD CONSTRAINT employee_role_assignments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_role_assignments employee_role_assignments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignments
    ADD CONSTRAINT employee_role_assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_role_assignments employee_role_assignments_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignments
    ADD CONSTRAINT employee_role_assignments_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_sessions employee_sessions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sessions
    ADD CONSTRAINT employee_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employee_verification_attempts employee_verification_attempts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_verification_attempts
    ADD CONSTRAINT employee_verification_attempts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_verification_attempts employee_verification_attempts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_verification_attempts
    ADD CONSTRAINT employee_verification_attempts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: employee_verification_attempts employee_verification_attempts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_verification_attempts
    ADD CONSTRAINT employee_verification_attempts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_verification_attempts employee_verification_attempts_technical_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_verification_attempts
    ADD CONSTRAINT employee_verification_attempts_technical_user_id_fkey FOREIGN KEY (technical_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employees employees_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: financial_approval_policies financial_approval_policies_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_approval_policies
    ADD CONSTRAINT financial_approval_policies_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_approval_policies financial_approval_policies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_approval_policies
    ADD CONSTRAINT financial_approval_policies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlement_allocations financial_settlement_allocati_customer_financial_liability_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlement_allocations
    ADD CONSTRAINT financial_settlement_allocati_customer_financial_liability_fkey FOREIGN KEY (customer_financial_liability_id) REFERENCES public.customer_financial_liabilities(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlement_allocations financial_settlement_allocations_settlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlement_allocations
    ADD CONSTRAINT financial_settlement_allocations_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.financial_settlements(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlement_legs financial_settlement_legs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlement_legs
    ADD CONSTRAINT financial_settlement_legs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlement_legs financial_settlement_legs_cash_register_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlement_legs
    ADD CONSTRAINT financial_settlement_legs_cash_register_session_id_fkey FOREIGN KEY (cash_register_session_id) REFERENCES public.cash_register_sessions(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlement_legs financial_settlement_legs_cash_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlement_legs
    ADD CONSTRAINT financial_settlement_legs_cash_transaction_id_fkey FOREIGN KEY (cash_transaction_id) REFERENCES public.cash_transactions(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlement_legs financial_settlement_legs_settlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlement_legs
    ADD CONSTRAINT financial_settlement_legs_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.financial_settlements(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlements financial_settlements_approval_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlements
    ADD CONSTRAINT financial_settlements_approval_policy_id_fkey FOREIGN KEY (approval_policy_id) REFERENCES public.financial_approval_policies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlements financial_settlements_approval_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlements
    ADD CONSTRAINT financial_settlements_approval_request_id_fkey FOREIGN KEY (approval_request_id) REFERENCES public.approval_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlements financial_settlements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlements
    ADD CONSTRAINT financial_settlements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlements financial_settlements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlements
    ADD CONSTRAINT financial_settlements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlements financial_settlements_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlements
    ADD CONSTRAINT financial_settlements_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_settlements financial_settlements_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_settlements
    ADD CONSTRAINT financial_settlements_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gift_vouchers gift_vouchers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_vouchers
    ADD CONSTRAINT gift_vouchers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: gold_core_events gold_core_events_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_core_events
    ADD CONSTRAINT gold_core_events_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_core_events gold_core_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_core_events
    ADD CONSTRAINT gold_core_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_core_events gold_core_events_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_core_events
    ADD CONSTRAINT gold_core_events_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.customer_gold_purchase_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_core_events gold_core_events_source_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_core_events
    ADD CONSTRAINT gold_core_events_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES public.outbox_events(event_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_core_events gold_core_events_source_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_core_events
    ADD CONSTRAINT gold_core_events_source_party_id_fkey FOREIGN KEY (source_party_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_fixings gold_fixings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_fixings
    ADD CONSTRAINT gold_fixings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: gold_market_quotes gold_market_quotes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_market_quotes
    ADD CONSTRAINT gold_market_quotes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_market_settings gold_market_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_market_settings
    ADD CONSTRAINT gold_market_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_market_settings gold_market_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_market_settings
    ADD CONSTRAINT gold_market_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: gold_prices gold_prices_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_prices
    ADD CONSTRAINT gold_prices_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: gold_pricing_policies gold_pricing_policies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_pricing_policies
    ADD CONSTRAINT gold_pricing_policies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_pricing_policies gold_pricing_policies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_pricing_policies
    ADD CONSTRAINT gold_pricing_policies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: gold_pricing_policies gold_pricing_policies_supersedes_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_pricing_policies
    ADD CONSTRAINT gold_pricing_policies_supersedes_policy_id_fkey FOREIGN KEY (supersedes_policy_id) REFERENCES public.gold_pricing_policies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_purchase_approval_requests gold_purchase_approval_requests_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_purchase_approval_requests
    ADD CONSTRAINT gold_purchase_approval_requests_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_purchase_approval_requests gold_purchase_approval_requests_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_purchase_approval_requests
    ADD CONSTRAINT gold_purchase_approval_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_purchase_approval_requests gold_purchase_approval_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_purchase_approval_requests
    ADD CONSTRAINT gold_purchase_approval_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: gold_purchase_approval_requests gold_purchase_approval_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_purchase_approval_requests
    ADD CONSTRAINT gold_purchase_approval_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: installments installments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installments
    ADD CONSTRAINT installments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: inventory_adjustment_items inventory_adjustment_items_adjustment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustment_items
    ADD CONSTRAINT inventory_adjustment_items_adjustment_id_fkey FOREIGN KEY (adjustment_id) REFERENCES public.inventory_adjustments(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_adjustment_items inventory_adjustment_items_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustment_items
    ADD CONSTRAINT inventory_adjustment_items_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_adjustment_items inventory_adjustment_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustment_items
    ADD CONSTRAINT inventory_adjustment_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_adjustments inventory_adjustments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_adjustments inventory_adjustments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_asset_movements inventory_asset_movements_asset_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_asset_movements
    ADD CONSTRAINT inventory_asset_movements_asset_event_id_fkey FOREIGN KEY (asset_event_id) REFERENCES public.asset_events(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_asset_movements inventory_asset_movements_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_asset_movements
    ADD CONSTRAINT inventory_asset_movements_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_asset_movements inventory_asset_movements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_asset_movements
    ADD CONSTRAINT inventory_asset_movements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_asset_movements inventory_asset_movements_from_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_asset_movements
    ADD CONSTRAINT inventory_asset_movements_from_branch_id_fkey FOREIGN KEY (from_branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_asset_movements inventory_asset_movements_from_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_asset_movements
    ADD CONSTRAINT inventory_asset_movements_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_asset_movements inventory_asset_movements_to_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_asset_movements
    ADD CONSTRAINT inventory_asset_movements_to_branch_id_fkey FOREIGN KEY (to_branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_asset_movements inventory_asset_movements_to_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_asset_movements
    ADD CONSTRAINT inventory_asset_movements_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_gold_pools inventory_gold_pools_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_gold_pools
    ADD CONSTRAINT inventory_gold_pools_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: inventory_locations inventory_locations_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_locations
    ADD CONSTRAINT inventory_locations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_locations inventory_locations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_locations
    ADD CONSTRAINT inventory_locations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_master_data_bootstrap_states inventory_master_data_bootstrap_states_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_master_data_bootstrap_states
    ADD CONSTRAINT inventory_master_data_bootstrap_states_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_saved_views inventory_saved_views_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_saved_views
    ADD CONSTRAINT inventory_saved_views_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_source_link_classifications inventory_source_link_classifications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_source_link_classifications
    ADD CONSTRAINT inventory_source_link_classifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_workshop_items inventory_workshop_items_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_workshop_items
    ADD CONSTRAINT inventory_workshop_items_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_workshop_items inventory_workshop_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_workshop_items
    ADD CONSTRAINT inventory_workshop_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_workshop_items inventory_workshop_items_from_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_workshop_items
    ADD CONSTRAINT inventory_workshop_items_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_workshop_items inventory_workshop_items_workshop_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_workshop_items
    ADD CONSTRAINT inventory_workshop_items_workshop_order_id_fkey FOREIGN KEY (workshop_order_id) REFERENCES public.inventory_workshop_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_workshop_orders inventory_workshop_orders_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_workshop_orders
    ADD CONSTRAINT inventory_workshop_orders_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_workshop_orders inventory_workshop_orders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_workshop_orders
    ADD CONSTRAINT inventory_workshop_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_last_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_last_rejected_by_fkey FOREIGN KEY (last_rejected_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_validated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: investment_gold_purchase_documents investment_gold_purchase_documents_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_documents
    ADD CONSTRAINT investment_gold_purchase_documents_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: investment_gold_purchase_items investment_gold_purchase_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_items
    ADD CONSTRAINT investment_gold_purchase_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: investment_gold_purchase_items investment_gold_purchase_items_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_gold_purchase_items
    ADD CONSTRAINT investment_gold_purchase_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.investment_gold_purchase_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: invoice_item_asset_links invoice_item_asset_links_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_item_asset_links
    ADD CONSTRAINT invoice_item_asset_links_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: invoice_item_asset_links invoice_item_asset_links_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_item_asset_links
    ADD CONSTRAINT invoice_item_asset_links_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: invoice_item_asset_links invoice_item_asset_links_cost_snapshot_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_item_asset_links
    ADD CONSTRAINT invoice_item_asset_links_cost_snapshot_revision_id_fkey FOREIGN KEY (cost_snapshot_revision_id) REFERENCES public.asset_purchase_cost_revisions(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: invoice_item_asset_links invoice_item_asset_links_invoice_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_item_asset_links
    ADD CONSTRAINT invoice_item_asset_links_invoice_item_id_fkey FOREIGN KEY (invoice_item_id) REFERENCES public.invoice_items(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: invoice_print_events invoice_print_events_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_print_events
    ADD CONSTRAINT invoice_print_events_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: invoice_print_events invoice_print_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_print_events
    ADD CONSTRAINT invoice_print_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: invoice_print_events invoice_print_events_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_print_events
    ADD CONSTRAINT invoice_print_events_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: invoice_print_events invoice_print_events_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_print_events
    ADD CONSTRAINT invoice_print_events_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: invoice_print_events invoice_print_events_operator_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_print_events
    ADD CONSTRAINT invoice_print_events_operator_session_id_fkey FOREIGN KEY (operator_session_id) REFERENCES public.employee_operational_sessions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: invoice_print_events invoice_print_events_technical_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_print_events
    ADD CONSTRAINT invoice_print_events_technical_user_id_fkey FOREIGN KEY (technical_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: invoices invoices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: invoices invoices_created_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_employee_id_fkey FOREIGN KEY (created_by_employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: invoices invoices_finalized_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_finalized_by_employee_id_fkey FOREIGN KEY (finalized_by_employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: journal_entries journal_entries_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: journal_lines journal_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: journal_lines journal_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: legacy_product_asset_map legacy_product_asset_map_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_product_asset_map
    ADD CONSTRAINT legacy_product_asset_map_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: legacy_product_asset_map legacy_product_asset_map_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_product_asset_map
    ADD CONSTRAINT legacy_product_asset_map_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: legacy_product_asset_map legacy_product_asset_map_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_product_asset_map
    ADD CONSTRAINT legacy_product_asset_map_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loyalty_transactions loyalty_transactions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: manufacturing_order_inputs manufacturing_order_inputs_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_order_inputs
    ADD CONSTRAINT manufacturing_order_inputs_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: manufacturing_order_inputs manufacturing_order_inputs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_order_inputs
    ADD CONSTRAINT manufacturing_order_inputs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: manufacturing_order_inputs manufacturing_order_inputs_manufacturing_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_order_inputs
    ADD CONSTRAINT manufacturing_order_inputs_manufacturing_order_id_fkey FOREIGN KEY (manufacturing_order_id) REFERENCES public.manufacturing_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: manufacturing_order_outputs manufacturing_order_outputs_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_order_outputs
    ADD CONSTRAINT manufacturing_order_outputs_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: manufacturing_order_outputs manufacturing_order_outputs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_order_outputs
    ADD CONSTRAINT manufacturing_order_outputs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: manufacturing_order_outputs manufacturing_order_outputs_manufacturing_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_order_outputs
    ADD CONSTRAINT manufacturing_order_outputs_manufacturing_order_id_fkey FOREIGN KEY (manufacturing_order_id) REFERENCES public.manufacturing_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: manufacturing_orders manufacturing_orders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturing_orders
    ADD CONSTRAINT manufacturing_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payments payments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payments payments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payments payments_received_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_received_by_employee_id_fkey FOREIGN KEY (received_by_employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payslips payslips_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: pearl_size_master_data pearl_size_master_data_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pearl_size_master_data
    ADD CONSTRAINT pearl_size_master_data_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: products products_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: profile_master_data profile_master_data_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_master_data
    ADD CONSTRAINT profile_master_data_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_order_item_asset_links purchase_order_item_asset_links_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_item_asset_links
    ADD CONSTRAINT purchase_order_item_asset_links_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_order_item_asset_links purchase_order_item_asset_links_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_item_asset_links
    ADD CONSTRAINT purchase_order_item_asset_links_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_order_item_asset_links purchase_order_item_asset_links_purchase_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_item_asset_links
    ADD CONSTRAINT purchase_order_item_asset_links_purchase_order_item_id_fkey FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_order_items purchase_order_items_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: purchase_order_items purchase_order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: purchase_order_items purchase_order_items_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: purchase_orders purchase_orders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_amendment_items reservation_amendment_items_amendment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_amendment_items
    ADD CONSTRAINT reservation_amendment_items_amendment_id_fkey FOREIGN KEY (amendment_id) REFERENCES public.reservation_amendments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_amendment_items reservation_amendment_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_amendment_items
    ADD CONSTRAINT reservation_amendment_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_amendment_items reservation_amendment_items_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_amendment_items
    ADD CONSTRAINT reservation_amendment_items_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_amendments reservation_amendments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_amendments
    ADD CONSTRAINT reservation_amendments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_amendments reservation_amendments_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_amendments
    ADD CONSTRAINT reservation_amendments_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_deposit_receipt_documents reservation_deposit_receipt_documen_reservation_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_deposit_receipt_documents
    ADD CONSTRAINT reservation_deposit_receipt_documen_reservation_payment_id_fkey FOREIGN KEY (reservation_payment_id) REFERENCES public.reservation_payments(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_deposit_receipt_documents reservation_deposit_receipt_documents_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_deposit_receipt_documents
    ADD CONSTRAINT reservation_deposit_receipt_documents_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_deposit_receipt_documents reservation_deposit_receipt_documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_deposit_receipt_documents
    ADD CONSTRAINT reservation_deposit_receipt_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_deposit_receipt_documents reservation_deposit_receipt_documents_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_deposit_receipt_documents
    ADD CONSTRAINT reservation_deposit_receipt_documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservation_deposit_receipt_documents reservation_deposit_receipt_documents_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_deposit_receipt_documents
    ADD CONSTRAINT reservation_deposit_receipt_documents_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservation_deposit_receipt_documents reservation_deposit_receipt_documents_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_deposit_receipt_documents
    ADD CONSTRAINT reservation_deposit_receipt_documents_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_expiry_extensions reservation_expiry_extensions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_expiry_extensions
    ADD CONSTRAINT reservation_expiry_extensions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_expiry_extensions reservation_expiry_extensions_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_expiry_extensions
    ADD CONSTRAINT reservation_expiry_extensions_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_items reservation_items_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_items
    ADD CONSTRAINT reservation_items_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_items reservation_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_items
    ADD CONSTRAINT reservation_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_items reservation_items_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_items
    ADD CONSTRAINT reservation_items_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_payment_applications reservation_payment_applications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_applications
    ADD CONSTRAINT reservation_payment_applications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_payment_applications reservation_payment_applications_final_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_applications
    ADD CONSTRAINT reservation_payment_applications_final_invoice_id_fkey FOREIGN KEY (final_invoice_id) REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payment_applications reservation_payment_applications_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_applications
    ADD CONSTRAINT reservation_payment_applications_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payment_applications reservation_payment_applications_reservation_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_applications
    ADD CONSTRAINT reservation_payment_applications_reservation_payment_id_fkey FOREIGN KEY (reservation_payment_id) REFERENCES public.reservation_payments(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payment_transfers reservation_payment_transfers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_transfers
    ADD CONSTRAINT reservation_payment_transfers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_payment_transfers reservation_payment_transfers_renewal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_transfers
    ADD CONSTRAINT reservation_payment_transfers_renewal_id_fkey FOREIGN KEY (renewal_id) REFERENCES public.reservation_renewals(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payment_transfers reservation_payment_transfers_source_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_transfers
    ADD CONSTRAINT reservation_payment_transfers_source_payment_id_fkey FOREIGN KEY (source_payment_id) REFERENCES public.reservation_payments(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payment_transfers reservation_payment_transfers_source_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_transfers
    ADD CONSTRAINT reservation_payment_transfers_source_reservation_id_fkey FOREIGN KEY (source_reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payment_transfers reservation_payment_transfers_target_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_transfers
    ADD CONSTRAINT reservation_payment_transfers_target_payment_id_fkey FOREIGN KEY (target_payment_id) REFERENCES public.reservation_payments(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservation_payment_transfers reservation_payment_transfers_target_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payment_transfers
    ADD CONSTRAINT reservation_payment_transfers_target_reservation_id_fkey FOREIGN KEY (target_reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payments reservation_payments_advances_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payments
    ADD CONSTRAINT reservation_payments_advances_account_id_fkey FOREIGN KEY (advances_account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payments reservation_payments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payments
    ADD CONSTRAINT reservation_payments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservation_payments reservation_payments_cash_register_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payments
    ADD CONSTRAINT reservation_payments_cash_register_session_id_fkey FOREIGN KEY (cash_register_session_id) REFERENCES public.cash_register_sessions(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payments reservation_payments_cash_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payments
    ADD CONSTRAINT reservation_payments_cash_transaction_id_fkey FOREIGN KEY (cash_transaction_id) REFERENCES public.cash_transactions(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payments reservation_payments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payments
    ADD CONSTRAINT reservation_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_payments reservation_payments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payments
    ADD CONSTRAINT reservation_payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_payments reservation_payments_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payments
    ADD CONSTRAINT reservation_payments_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservation_payments reservation_payments_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_payments
    ADD CONSTRAINT reservation_payments_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_refund_allocations reservation_refund_allocations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refund_allocations
    ADD CONSTRAINT reservation_refund_allocations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_refund_allocations reservation_refund_allocations_reservation_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refund_allocations
    ADD CONSTRAINT reservation_refund_allocations_reservation_payment_id_fkey FOREIGN KEY (reservation_payment_id) REFERENCES public.reservation_payments(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_refund_allocations reservation_refund_allocations_reservation_refund_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refund_allocations
    ADD CONSTRAINT reservation_refund_allocations_reservation_refund_id_fkey FOREIGN KEY (reservation_refund_id) REFERENCES public.reservation_refunds(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_refunds reservation_refunds_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refunds
    ADD CONSTRAINT reservation_refunds_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservation_refunds reservation_refunds_cash_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refunds
    ADD CONSTRAINT reservation_refunds_cash_transaction_id_fkey FOREIGN KEY (cash_transaction_id) REFERENCES public.cash_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservation_refunds reservation_refunds_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refunds
    ADD CONSTRAINT reservation_refunds_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_refunds reservation_refunds_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refunds
    ADD CONSTRAINT reservation_refunds_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_refunds reservation_refunds_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refunds
    ADD CONSTRAINT reservation_refunds_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservation_refunds reservation_refunds_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refunds
    ADD CONSTRAINT reservation_refunds_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_renewals reservation_renewals_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_renewals
    ADD CONSTRAINT reservation_renewals_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reservation_renewals reservation_renewals_source_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_renewals
    ADD CONSTRAINT reservation_renewals_source_reservation_id_fkey FOREIGN KEY (source_reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reservation_renewals reservation_renewals_successor_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_renewals
    ADD CONSTRAINT reservation_renewals_successor_reservation_id_fkey FOREIGN KEY (successor_reservation_id) REFERENCES public.reservations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservations reservations_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reservations reservations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rfid_scan_events rfid_scan_events_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_scan_events
    ADD CONSTRAINT rfid_scan_events_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: rfid_scan_events rfid_scan_events_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_scan_events
    ADD CONSTRAINT rfid_scan_events_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.asset_rfid_assignments(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: rfid_scan_events rfid_scan_events_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_scan_events
    ADD CONSTRAINT rfid_scan_events_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: rfid_scan_events rfid_scan_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_scan_events
    ADD CONSTRAINT rfid_scan_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: roles roles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: settings settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: stock_audit_items stock_audit_items_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_audit_items
    ADD CONSTRAINT stock_audit_items_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: stock_audit_items stock_audit_items_expected_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_audit_items
    ADD CONSTRAINT stock_audit_items_expected_branch_id_fkey FOREIGN KEY (expected_branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: stock_audit_items stock_audit_items_scanned_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_audit_items
    ADD CONSTRAINT stock_audit_items_scanned_branch_id_fkey FOREIGN KEY (scanned_branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: stock_audit_items stock_audit_items_stock_audit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_audit_items
    ADD CONSTRAINT stock_audit_items_stock_audit_id_fkey FOREIGN KEY (stock_audit_id) REFERENCES public.stock_audits(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: stock_audits stock_audits_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_audits
    ADD CONSTRAINT stock_audits_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: stock_audits stock_audits_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_audits
    ADD CONSTRAINT stock_audits_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: stock_audits stock_audits_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_audits
    ADD CONSTRAINT stock_audits_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: stock_movements stock_movements_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: supplier_consignments supplier_consignments_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_consignments
    ADD CONSTRAINT supplier_consignments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: supplier_documents supplier_documents_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_documents
    ADD CONSTRAINT supplier_documents_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: suppliers suppliers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: system_account_roles system_account_roles_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account_roles
    ADD CONSTRAINT system_account_roles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: system_account_roles system_account_roles_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account_roles
    ADD CONSTRAINT system_account_roles_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: system_account_roles system_account_roles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account_roles
    ADD CONSTRAINT system_account_roles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: technical_account_sessions technical_account_sessions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technical_account_sessions
    ADD CONSTRAINT technical_account_sessions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: technical_account_sessions technical_account_sessions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technical_account_sessions
    ADD CONSTRAINT technical_account_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: technical_account_sessions technical_account_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technical_account_sessions
    ADD CONSTRAINT technical_account_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transfer_items transfer_items_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transfer_items transfer_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transfer_items transfer_items_from_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_from_branch_id_fkey FOREIGN KEY (from_branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transfer_items transfer_items_from_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transfer_items transfer_items_to_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_to_branch_id_fkey FOREIGN KEY (to_branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transfer_items transfer_items_to_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transfer_items transfer_items_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transfers transfers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: users users_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_default_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_default_employee_id_fkey FOREIGN KEY (default_employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict aoRGM0UMPTKANgcb1pSnEavroaxW2Qh2n1oX23Jh9TeYaF4oecTYBrHHHzbGGcv

