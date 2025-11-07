/// Type definitions matching Metronome API structures

export interface Customer {
	id: string;
	name: string;
	ingest_aliases: string[];
	customer_billing_provider_configurations: BillingProviderConfiguration[];
	created_at: string;
	updated_at: string;
	custom_fields?: Record<string, string>;
}

export interface BillingProviderConfiguration {
	billing_provider: "stripe";
	delivery_method: "direct_to_billing_provider";
	configuration: {
		stripe_customer_id: string;
		stripe_collection_method: "charge_automatically";
		leave_stripe_invoices_in_draft?: boolean;
	};
}

export interface ContractV1 {
	id: string;
	customer_id: string;
	name: string;
	uniqueness_key: string;
	starting_at: string;
	rate_card_id: string;
	usage_statement_schedule: {
		frequency: "MONTHLY" | "ANNUAL";
	};
	billing_provider_configuration: {
		billing_provider: "stripe";
	};
}

export interface ContractV2 {
	id: string;
	customer_id: string;
	starting_at: string;
	uniqueness_key?: string;
	subscriptions?: Subscription[];
	credits?: Credit[];
	recurring_credits?: RecurringCredit[];
	overrides?: ProductOverride[];
	prepaid_balance_threshold_configuration?: PrepaidBalanceThresholdConfiguration;
}

export interface Subscription {
	id: string;
	starting_at: string;
	ending_before?: string;
	subscription_rate: {
		product: {
			id: string;
			name: string;
		};
		billing_frequency: "MONTHLY" | "ANNUAL";
	};
	quantity_schedule: Array<{
		quantity: number;
		starting_at: string;
		ending_before?: string;
	}>;
	custom_fields?: {
		tier_id?: string;
	};
	billing_periods?: {
		current?: {
			starting_at: string;
			ending_before?: string;
		};
		next?: {
			starting_at: string;
			ending_before?: string;
		};
	};
}

export interface Credit {
	id: string;
	product: {
		id: string;
		name: string;
	};
	access_schedule?: {
		credit_type_id: string;
		schedule_items: Array<{
			starting_at: string;
			ending_before: string;
			amount: number;
		}>;
	};
	custom_fields?: {
		tier_id?: string;
	};
	archived_at?: string;
	subscription_config?: {
		subscription_id: string;
	};
}

export interface RecurringCredit {
	id: string;
	product: {
		id: string;
		name: string;
	};
	starting_at: string;
	ending_before?: string;
	subscription_config?: {
		subscription_id: string;
	};
}

export interface ProductOverride {
	id: string;
	product_id: string;
	starting_at: string;
	entitled: boolean;
}

export interface PrepaidBalanceThresholdConfiguration {
	is_enabled: boolean;
	threshold_amount: number;
	recharge_to_amount: number;
	payment_gate_config?: {
		payment_gate_type: "STRIPE";
		stripe_config: {
			payment_type: "INVOICE";
		};
	};
	commit?: {
		product_id: string;
		applicable_product_tags: string[];
	};
}

export interface Invoice {
	id: string;
	customer_id: string;
	contract_id: string;
	type: "USAGE" | "SUBSCRIPTION";
	status: "DRAFT" | "FINALIZED" | "PAID" | "UNCOLLECTIBLE" | "VOIDED" | "DELETED" | "PAYMENT_FAILED" | "INVALID_REQUEST_ERROR" | "SKIPPED" | "SENT" | "QUEUED";
	issued_at?: string;
	start_timestamp?: string;
	end_timestamp?: string;
	total: number;
	line_items: InvoiceLineItem[];
	external_invoice?: {
		invoice_id: string;
		external_status: "DRAFT" | "FINALIZED" | "PAID" | "UNCOLLECTIBLE" | "VOIDED";
	};
	metadata?: {
		metronome_id?: string;
	};
}

export interface InvoiceLineItem {
	id: string;
	type: "subscription" | "usage" | "credit";
	product_id?: string;
	product_name?: string;
	amount: number;
	is_prorated?: boolean;
}

export interface Balance {
	product: {
		id: string;
		name: string;
	};
	balance?: number;
}

export interface UsageEvent {
	customer_id: string;
	event_type: string;
	timestamp: string;
	transaction_id: string;
	properties: Record<string, unknown>;
}

export interface DashboardEmbeddableURL {
	url: string;
}

export interface ContractEditResponse {
	data: {
		id: string;
	};
}

export interface ErrorResponse {
	error: {
		message: string;
		conflicting_id?: string;
		status?: number;
	};
}

