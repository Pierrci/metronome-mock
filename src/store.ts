/// In-memory data store for mock Metronome server

import type {
	Customer,
	ContractV1,
	ContractV2,
	Invoice,
	UsageEvent,
	Balance,
} from "./types.js";

export class MetronomeStore {
	private customers: Map<string, Customer> = new Map();
	private contractsV1: Map<string, ContractV1> = new Map();
	private contractsV2: Map<string, ContractV2> = new Map();
	private invoices: Map<string, Invoice> = new Map();
	private usageEvents: UsageEvent[] = [];
	private balances: Map<string, Map<string, Balance>> = new Map(); // customer_id -> product_id -> balance
	private uniquenessKeys: Set<string> = new Set();
	private ingestAliasToCustomer: Map<string, string> = new Map(); // alias -> customer_id

	// Customers
	createCustomer(customer: Customer): void {
		this.customers.set(customer.id, customer);
		for (const alias of customer.ingest_aliases) {
			this.ingestAliasToCustomer.set(alias, customer.id);
		}
	}

	getCustomer(customerId: string): Customer | undefined {
		return this.customers.get(customerId);
	}

	findCustomerByIngestAlias(alias: string): Customer | undefined {
		const customerId = this.ingestAliasToCustomer.get(alias);
		return customerId ? this.customers.get(customerId) : undefined;
	}

	// Contracts V1
	createContractV1(contract: ContractV1): void {
		this.contractsV1.set(contract.id, contract);
		if (contract.uniqueness_key) {
			this.uniquenessKeys.add(contract.uniqueness_key);
		}
	}

	getContractV1(contractId: string): ContractV1 | undefined {
		return this.contractsV1.get(contractId);
	}

	hasUniquenessKey(key: string): boolean {
		return this.uniquenessKeys.has(key);
	}

	addUniquenessKey(key: string): void {
		this.uniquenessKeys.add(key);
	}

	// Contracts V2
	createContractV2(contract: ContractV2): void {
		this.contractsV2.set(contract.id, contract);
		if (contract.uniqueness_key) {
			this.uniquenessKeys.add(contract.uniqueness_key);
		}
	}

	getContractV2(contractId: string): ContractV2 | undefined {
		return this.contractsV2.get(contractId);
	}

	listContractsV2(customerId: string): ContractV2[] {
		return Array.from(this.contractsV2.values()).filter(
			c => c.customer_id === customerId
		);
	}

	updateContractV2(contractId: string, updates: Partial<ContractV2>): void {
		const contract = this.contractsV2.get(contractId);
		if (contract) {
			Object.assign(contract, updates);
		}
	}

	// Invoices
	createInvoice(invoice: Invoice): void {
		this.invoices.set(invoice.id, invoice);
	}

	getInvoice(invoiceId: string): Invoice | undefined {
		return this.invoices.get(invoiceId);
	}

	listInvoices(customerId: string): Invoice[] {
		return Array.from(this.invoices.values()).filter(
			i => i.customer_id === customerId
		);
	}

	updateInvoice(invoiceId: string, updates: Partial<Invoice>): void {
		const invoice = this.invoices.get(invoiceId);
		if (invoice) {
			Object.assign(invoice, updates);
		}
	}

	// Usage Events
	addUsageEvent(event: UsageEvent): void {
		this.usageEvents.push(event);
	}

	getUsageEvents(customerId?: string): UsageEvent[] {
		if (customerId) {
			return this.usageEvents.filter(e => e.customer_id === customerId);
		}
		return [...this.usageEvents];
	}

	// Balances
	setBalance(customerId: string, productId: string, balance: Balance): void {
		if (!this.balances.has(customerId)) {
			this.balances.set(customerId, new Map());
		}
		this.balances.get(customerId)!.set(productId, balance);
	}

	getBalance(customerId: string, productId: string): Balance | undefined {
		return this.balances.get(customerId)?.get(productId);
	}

	getAllBalances(customerId: string): Balance[] {
		const customerBalances = this.balances.get(customerId);
		return customerBalances ? Array.from(customerBalances.values()) : [];
	}

	// Reset (for testing)
	reset(): void {
		this.customers.clear();
		this.contractsV1.clear();
		this.contractsV2.clear();
		this.invoices.clear();
		this.usageEvents = [];
		this.balances.clear();
		this.uniquenessKeys.clear();
		this.ingestAliasToCustomer.clear();
	}
}

export const store = new MetronomeStore();

