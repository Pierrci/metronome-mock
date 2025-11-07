import { createHmac } from "crypto";
import { store } from "../store.js";
import { generateId } from "../utils.js";
import type { ContractV2 } from "../types.js";

type PaymentStatus = "paid" | "failed";

const DEFAULT_SECRET = process.env.METRONOME_WEBHOOK_SECRET || "test-secret";
const DEFAULT_PATH = process.env.MOCK_METRONOME_WEBHOOK_PATH;
const ENVIRONMENT_TYPE = process.env.MOCK_METRONOME_ENVIRONMENT_TYPE || "SANDBOX";

const webhookTargets = new Set<string>();

for (const target of parseTargets(process.env.MOCK_METRONOME_WEBHOOK_TARGET)) {
	if (target) {
		webhookTargets.add(target);
	}
}

let cachedAlertId: string | undefined;

function parseTargets(targets?: string): string[] {
	if (!targets) {
		return [];
	}
	return targets
		.split(",")
		.map(target => target.trim())
		.filter(Boolean)
		.map(resolveTargetUrl)
		.filter(Boolean);
}

function resolveTargetUrl(target: string): string {
	const trimmed = target.trim();
	if (!trimmed) {
		return trimmed;
	}
	try {
		const url = new URL(trimmed);
		if ((url.pathname === "/" || url.pathname === "") && DEFAULT_PATH) {
			url.pathname = DEFAULT_PATH.startsWith("/") ? DEFAULT_PATH : `/${DEFAULT_PATH}`;
		}
		return url.toString();
	} catch {
		if (!DEFAULT_PATH) {
			return trimmed;
		}
		const normalizedBase = trimmed.replace(/\/$/, "");
		const normalizedPath = DEFAULT_PATH.startsWith("/") ? DEFAULT_PATH : `/${DEFAULT_PATH}`;
		return `${normalizedBase}${normalizedPath}`;
	}
}

function buildSignature(dateHeader: string, payload: string): string {
	return createHmac("sha256", DEFAULT_SECRET).update(`${dateHeader}\n${payload}`).digest("hex");
}

function getAlertId(): string {
	if (cachedAlertId) {
		return cachedAlertId;
	}
	const explicit = process.env.MOCK_METRONOME_ALERT_CUSTOMER_BALANCE_DEPLETED;
	if (explicit) {
		cachedAlertId = explicit;
		return cachedAlertId;
	}
	const configRaw = process.env.NODE_METRONOME_CONFIG;
	if (configRaw) {
		try {
			const parsed = JSON.parse(configRaw);
			const alertId = parsed?.alerts?.customerBalanceDepleted;
			if (typeof alertId === "string" && alertId.length > 0) {
				cachedAlertId = alertId;
				return cachedAlertId;
			}
		} catch (error) {
			console.warn("[mock-metronome][webhooks] Failed to parse NODE_METRONOME_CONFIG:", error);
		}
	}
	cachedAlertId = "customerBalanceDepleted";
	return cachedAlertId;
}

function hasFetch(): boolean {
	return typeof globalThis.fetch === "function";
}

async function dispatchEvent(event: Record<string, unknown>): Promise<void> {
	if (webhookTargets.size === 0) {
		if (process.env.DEBUG_METRONOME === "true") {
			console.log("[mock-metronome][webhooks] No webhook targets configured, skipping event", event.type);
		}
		return;
	}
	if (!hasFetch()) {
		console.warn("[mock-metronome][webhooks] fetch is not available in this runtime – cannot dispatch webhooks");
		return;
	}
	const payload = JSON.stringify(event);
	const dateHeader = new Date().toUTCString();
	const signature = buildSignature(dateHeader, payload);

	await Promise.all(
		[...webhookTargets].map(async target => {
			try {
				const response = await fetch(target, {
					method:  "POST",
					headers: {
						"Content-Type":                "application/json",
						"Date":                        dateHeader,
						"Metronome-Webhook-Signature": signature,
					},
					body: payload,
				});

				if (!response.ok) {
					console.warn(
						"[mock-metronome][webhooks] Target responded with status",
						response.status,
						"for event",
						event.type,
						"->",
						target
					);
				}
			} catch (error) {
				console.error("[mock-metronome][webhooks] Failed to dispatch event", event.type, "->", target, error);
			}
		})
	);

	if (process.env.DEBUG_METRONOME === "true") {
		console.log("[mock-metronome][webhooks] Dispatched event", JSON.stringify(event, null, 2));
	}
}

export function registerWebhookTarget(target: string): void {
	if (!target) {
		return;
	}
	webhookTargets.add(resolveTargetUrl(target));
}

export function removeWebhookTarget(target: string): void {
	if (!target) {
		return;
	}
	webhookTargets.delete(resolveTargetUrl(target));
}

export function clearWebhookTargets(): void {
	webhookTargets.clear();
}

export function getWebhookTargets(): string[] {
	return [...webhookTargets];
}

export async function dispatchRawEvent(event: Record<string, unknown>): Promise<void> {
	const enrichedEvent = {
		id: typeof event.id === "string" && event.id.length > 0 ? event.id : generateId("evt"),
		...event,
	};
	await dispatchEvent(enrichedEvent);
}

export async function emitContractEvent(
	contract: ContractV2,
	eventType: "contract.created" | "contract.updated"
): Promise<void> {
	const customer = store.getCustomer(contract.customer_id);
	const event: Record<string, unknown> = {
		id:               generateId("evt"),
		type:             eventType,
		contract_id:      contract.id,
		customer_id:      contract.customer_id,
		environment_type: ENVIRONMENT_TYPE,
	};

	if (customer?.custom_fields && Object.keys(customer.custom_fields).length > 0) {
		event.customer_custom_fields = customer.custom_fields;
	}

	await dispatchEvent(event);
}

export async function emitPaymentGateStatus(params: {
	customerId:    string;
	contractId:    string;
	paymentStatus: PaymentStatus;
}): Promise<void> {
	const event = {
		id:         generateId("evt"),
		type:       "payment_gate.payment_status" as const,
		properties: {
			contract_id:    params.contractId,
			customer_id:    params.customerId,
			payment_status: params.paymentStatus,
		},
	};
	await dispatchEvent(event);
}

export async function emitLowBalanceAlert(params: {
	customerId:       string;
	contractId:       string;
	threshold:        number;
	remainingBalance: number;
}): Promise<void> {
	const event = {
		id:         generateId("evt"),
		type:       "alerts.low_remaining_contract_credit_and_commit_balance_reached" as const,
		properties: {
			alert_id:          getAlertId(),
			customer_id:       params.customerId,
			threshold:         params.threshold,
			remaining_balance: params.remainingBalance,
			contract_id:       params.contractId,
		},
	};
	await dispatchEvent(event);
}

export async function emitInvoiceBillingProviderError(params: {
	customerId:   string;
	invoiceId:    string;
	errorMessage: string;
}): Promise<void> {
	const event = {
		id:         generateId("evt"),
		type:       "invoice.billing_provider_error" as const,
		properties: {
			invoice_id:             params.invoiceId,
			customer_id:            params.customerId,
			billing_provider_error: params.errorMessage,
		},
	};
	await dispatchEvent(event);
}
