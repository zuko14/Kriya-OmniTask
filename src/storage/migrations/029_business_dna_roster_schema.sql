-- Migration 029: Business DNA Profiles & Versioned Roster Manifests Schema (§3, §4, §23)
-- Supports type-adaptive configuration, agent roster moulding, and rollback-able roster manifests.

CREATE TABLE IF NOT EXISTS dna_profiles (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    business_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    lifecycle_model_json TEXT NOT NULL,
    entity_vocabulary_json TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    required_agents_json TEXT NOT NULL,
    optional_agents_json TEXT NOT NULL,
    forbidden_actions_json TEXT NOT NULL,
    compliance_profile_json TEXT NOT NULL,
    default_kpis_json TEXT NOT NULL,
    knowledge_schema_json TEXT NOT NULL,
    escalation_defaults_json TEXT NOT NULL,
    skill_grants_json TEXT NOT NULL,
    external_retrieval_policy_json TEXT NOT NULL,
    min_tier_requirements_json TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dna_profiles_type ON dna_profiles(business_type);

CREATE TABLE IF NOT EXISTS tenant_roster_manifests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    dna_profile_id TEXT NOT NULL,
    dna_profile_version TEXT NOT NULL,
    entity_vocabulary_json TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    lifecycle_stages_json TEXT NOT NULL,
    agents_json TEXT NOT NULL,
    checksum TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'superseded', 'rolled_back'
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rolled_back_from_version INTEGER,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(dna_profile_id) REFERENCES dna_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_manifests_tenant_ver ON tenant_roster_manifests(tenant_id, version);
CREATE INDEX IF NOT EXISTS idx_manifests_tenant_active ON tenant_roster_manifests(tenant_id, status);

-- Seed Profile 1: Retail & Digital Commerce (Meridian Retail Pilot)
INSERT OR REPLACE INTO dna_profiles (
    id, version, business_type, display_name, description,
    lifecycle_model_json, entity_vocabulary_json, capabilities_json,
    required_agents_json, optional_agents_json, forbidden_actions_json,
    compliance_profile_json, default_kpis_json, knowledge_schema_json,
    escalation_defaults_json, skill_grants_json, external_retrieval_policy_json,
    min_tier_requirements_json, is_active, created_at, updated_at
) VALUES (
    'dna_retail_commerce',
    '1.0.0',
    'retail_commerce',
    'Retail & Digital Commerce',
    'Omnichannel retail and D2C commerce operations, catalog search, order tracking, returns management, and cart recovery.',
    '{"stages":["discovery","evaluation","order_placed","fulfillment","post_purchase","repeat_buyer","dormant"],"initial_stage":"discovery","terminal_stages":["dormant","repeat_buyer"]}',
    '{"customer":"Shopper","customer_plural":"Shoppers","item":"Product","item_plural":"Products","transaction":"Order","transaction_plural":"Orders","appointment":"Delivery Slot","agent_term":"Store Assistant","custom_labels":{"cart":"Shopping Bag","return":"Return Request","catalog":"Product Catalog"}}',
    '["product_catalog","order_tracking","returns_management","cart_recovery","lead_qualification","whatsapp_commerce","promotions"]',
    '[{"id":"agent_retail_support","slug":"customer_support","name":"Store & Order Assistant","role":"Customer Support Specialist","description":"Handles product inquiries, order tracking, and return requests.","min_model_tier":"T2","ceiling_autonomy":"L2","skills":["catalog_search","order_status_lookup","return_policy_check"],"tools":["inventory_lookup","order_tracking_api"],"forbidden_actions":["override_product_price","process_unverified_refund"]},{"id":"agent_retail_logistics","slug":"order_tracking","name":"Logistics & Delivery Specialist","role":"Fulfillment Specialist","description":"Tracks logistics shipments and handles delivery rescheduling.","min_model_tier":"T1","ceiling_autonomy":"L3","skills":["shipping_carrier_track","delivery_window_reschedule"],"tools":["carrier_api"],"forbidden_actions":["reroute_package_cross_border"]},{"id":"agent_retail_sales","slug":"lead_qualification","name":"Sales & Personal Shopper","role":"Lead Qualification Specialist","description":"Qualifies high-intent shoppers and provides personalized recommendations.","min_model_tier":"T2","ceiling_autonomy":"L2","skills":["product_recommendation","bant_scoring"],"tools":["crm_create_lead"],"forbidden_actions":["apply_unapproved_coupon"]}]',
    '[{"id":"agent_retail_retention","slug":"reactivation_retention","name":"VIP Win-Back & Retention","role":"Retention Specialist","description":"Re-engages dormant shoppers with targeted loyalty offers.","min_model_tier":"T3","ceiling_autonomy":"L1","skills":["cart_abandonment_incentive","vip_loyalty_outreach"],"tools":["discount_coupon_issuer"],"forbidden_actions":["discount_exceeding_20pct"]}]',
    '["modify_catalog_pricing","process_unverified_refund","cancel_supplier_po","exceed_max_promotional_discount"]',
    '{"consumer_protection":"e_commerce_rules_2020","data_retention_days":180,"tax_regime":"GST_IN"}',
    '[{"id":"gmv_daily","label":"Daily GMV","unit":"₹","format":"currency"},{"id":"order_fulfillment_sla","label":"Fulfillment SLA","unit":"%","format":"percent"},{"id":"return_rate_pct","label":"Return Rate","unit":"%","format":"percent"},{"id":"cart_conversion_pct","label":"Cart Conversion","unit":"%","format":"percent"}]',
    '["product_catalog_tsv","return_refund_policy_pdf","shipping_sla_matrix","promotional_terms_doc"]',
    '["chargeback_dispute","damaged_goods_claim_exceeding_5000","abusive_customer_sentiment"]',
    '["catalog_search","order_status_lookup","return_policy_check","shipping_carrier_track","product_recommendation","bant_scoring"]',
    '{"allowed":true,"allowed_domains":["shiprocket.in","delhivery.com","bluedart.com"]}',
    '{"customer_support":"T2","order_tracking":"T1","lead_qualification":"T2","reactivation_retention":"T3"}',
    1,
    '2026-08-20T00:00:00.000Z',
    '2026-08-20T00:00:00.000Z'
);

-- Seed Profile 2: Automotive Dealership & Service (Kaveri Motors Pilot)
INSERT OR REPLACE INTO dna_profiles (
    id, version, business_type, display_name, description,
    lifecycle_model_json, entity_vocabulary_json, capabilities_json,
    required_agents_json, optional_agents_json, forbidden_actions_json,
    compliance_profile_json, default_kpis_json, knowledge_schema_json,
    escalation_defaults_json, skill_grants_json, external_retrieval_policy_json,
    min_tier_requirements_json, is_active, created_at, updated_at
) VALUES (
    'dna_automotive_dealership',
    '1.0.0',
    'automotive_dealership',
    'Automotive Dealership & Service',
    'Automotive sales, test drive scheduling, vehicle inventory lookup, service appointment booking, and trade-in inquiries.',
    '{"stages":["inquiry","test_drive_scheduled","quote_negotiation","vehicle_delivered","service_active","trade_in_ready","dormant"],"initial_stage":"inquiry","terminal_stages":["dormant","trade_in_ready"]}',
    '{"customer":"Vehicle Owner","customer_plural":"Vehicle Owners","item":"Vehicle","item_plural":"Vehicles","transaction":"Deal","transaction_plural":"Deals","appointment":"Test Drive / Service Booking","agent_term":"Dealership Concierge","custom_labels":{"service_bay":"Workshop Bay","inventory":"Showroom Inventory","test_drive":"Test Drive Slot"}}',
    '["vehicle_inventory","test_drive_scheduling","service_appointment_booking","lead_qualification","voice_dispatch","quote_generation","service_reminders"]',
    '[{"id":"agent_auto_sales","slug":"lead_qualification","name":"Showroom Sales Consultant","role":"Lead Qualification Specialist","description":"Assists with vehicle selection, feature comparisons, and financing eligibility.","min_model_tier":"T2","ceiling_autonomy":"L2","skills":["vehicle_spec_matching","financing_estimation","bant_scoring"],"tools":["inventory_lookup","crm_create_lead"],"forbidden_actions":["promise_delivery_date_unconfirmed","commit_cash_discount"]},{"id":"agent_auto_booking","slug":"calendar_booking","name":"Test Drive & Service Scheduler","role":"Calendar Booking Specialist","description":"Coordinates demo vehicle test drives and service bay slots.","min_model_tier":"T2","ceiling_autonomy":"L3","skills":["calendar_slot_allocation","service_bay_scheduling"],"tools":["dealership_calendar_api"],"forbidden_actions":["double_book_demo_vehicle"]},{"id":"agent_auto_support","slug":"customer_support","name":"Service Center Advisor","role":"Customer Support Specialist","description":"Provides repair status updates, maintenance cost estimates, and warranty advice.","min_model_tier":"T2","ceiling_autonomy":"L2","skills":["job_card_status","service_cost_estimator"],"tools":["dms_service_api"],"forbidden_actions":["waive_inspection_fee_unapproved"]}]',
    '[{"id":"agent_auto_voice","slug":"voice_outbound_dispatch","name":"Service Reminder & Follow-Up Concierge","role":"Outbound Specialist","description":"Executes automated service schedule reminders and post-delivery satisfaction calls.","min_model_tier":"T3","ceiling_autonomy":"L2","skills":["service_reminder_call","post_service_feedback"],"tools":["voice_gateway_dialer"],"forbidden_actions":["call_outside_business_hours"]}]',
    '["commit_vehicle_discount_exceeding_10pct","waive_service_warranty_fee_unapproved","release_vehicle_without_gatepass","promise_unverified_trade_in_value"]',
    '{"motor_vehicles_act":"form_20_21_compliance","data_retention_days":365,"tax_regime":"GST_IN"}',
    '[{"id":"test_drives_booked","label":"Test Drives Booked","unit":"count","format":"number"},{"id":"service_bay_utilization","label":"Service Bay Utilization","unit":"%","format":"percent"},{"id":"lead_response_time_sec","label":"Lead Response Time","unit":"s","format":"duration"},{"id":"test_drive_to_sale_pct","label":"Test Drive to Sale","unit":"%","format":"percent"}]',
    '["vehicle_specs_matrix","service_rate_card","warranty_terms_pdf","dealership_location_hours","trade_in_valuation_guide"]',
    '["trade_in_valuation_dispute","vehicle_breakdown_emergency","service_billing_discrepancy"]',
    '["vehicle_spec_matching","financing_estimation","bant_scoring","calendar_slot_allocation","service_bay_scheduling","job_card_status","service_cost_estimator"]',
    '{"allowed":true,"allowed_domains":["vahan.parivahan.gov.in","carwale.com","bikewale.com"]}',
    '{"lead_qualification":"T2","calendar_booking":"T2","customer_support":"T2","voice_outbound_dispatch":"T3"}',
    1,
    '2026-08-20T00:00:00.000Z',
    '2026-08-20T00:00:00.000Z'
);
