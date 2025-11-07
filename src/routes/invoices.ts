/// Invoice endpoints

import { Router } from "express";
import { store } from "../store.js";
import { generateId, formatRFC3339, parseRFC3339 } from "../utils.js";
import type { ErrorResponse, Invoice, InvoiceLineItem } from "../types.js";

const router = Router();

/// POST /v1/customers/:customer_id/invoices
router.post("/:customer_id/invoices", (req, res) => {
	try {
		const { customer_id } = req.params;
		const {
			contract_id,
			type = "USAGE",
			line_items = [],
			start_timestamp,
			end_timestamp,
			status = "FINALIZED",
			due_date,
		} = req.body;

		if (!contract_id) {
			return res.status(400).json({
				error: { message: "contract_id is required", status: 400 },
			} satisfies ErrorResponse);
		}

		/// Verify customer exists
		const customer = store.getCustomer(customer_id);
		if (!customer) {
			return res.status(404).json({
				error: { message: "Customer not found", status: 404 },
			} satisfies ErrorResponse);
		}

		/// Verify contract exists
		const contract = store.getContractV2(contract_id);
		if (!contract || contract.customer_id !== customer_id) {
			return res.status(404).json({
				error: { message: "Contract not found", status: 404 },
			} satisfies ErrorResponse);
		}

		/// Validate line items
		if (!Array.isArray(line_items) || line_items.length === 0) {
			return res.status(400).json({
				error: { message: "line_items array is required and must not be empty", status: 400 },
			} satisfies ErrorResponse);
		}

		/// Calculate total from line items
		const total = line_items.reduce((sum: number, item: InvoiceLineItem) => {
			return sum + (item.amount || 0);
		}, 0);

		/// Generate invoice ID
		const invoiceId = generateId("inv");

		/// Create invoice line items with IDs
		const invoiceLineItems: InvoiceLineItem[] = line_items.map((item: any) => ({
			id: generateId("line"),
			type: item.type || "usage",
			product_id: item.product_id,
			product_name: item.product_name,
			amount: item.amount || 0,
			is_prorated: item.is_prorated,
		}));

		/// Create invoice
		const now = new Date();
		const invoice: Invoice = {
			id: invoiceId,
			customer_id,
			contract_id,
			type: type === "SUBSCRIPTION" ? "SUBSCRIPTION" : "USAGE",
			status: status as Invoice[ "status" ],
			issued_at: formatRFC3339(now),
			start_timestamp: start_timestamp || formatRFC3339(now),
			end_timestamp: end_timestamp,
			total,
			line_items: invoiceLineItems,
			external_invoice: {
				invoice_id: generateId("stripe_inv"),
				external_status: status === "FINALIZED" ? "FINALIZED" : "DRAFT",
			},
			metadata: {
				metronome_id: invoiceId,
			},
		};

		/// Add due_date if provided (Metronome includes this field)
		if (due_date) {
			(invoice as any).due_date = due_date;
		}

		store.createInvoice(invoice);

		res.status(201).json({ data: invoice });
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status: 500,
			},
		} satisfies ErrorResponse);
	}
});

/// GET /v1/customers/:customer_id/invoices
router.get("/:customer_id/invoices", (req, res) => {
	try {
		const { customer_id } = req.params;
		const {
			status,
			starting_on,
			ending_before,
			sort = "date_desc",
			limit = "100",
		} = req.query;

		let invoices = store.listInvoices(customer_id);

		/// Filter by status
		if (status && typeof status === "string") {
			invoices = invoices.filter(inv => inv.status === status.toUpperCase());
		}

		/// Filter by date range
		if (starting_on && typeof starting_on === "string") {
			const start = parseRFC3339(starting_on);
			invoices = invoices.filter(inv => {
				if (!inv.start_timestamp) return false;
				return parseRFC3339(inv.start_timestamp) >= start;
			});
		}

		if (ending_before && typeof ending_before === "string") {
			const end = parseRFC3339(ending_before);
			invoices = invoices.filter(inv => {
				if (!inv.start_timestamp) return false;
				return parseRFC3339(inv.start_timestamp) < end;
			});
		}

		/// Sort
		if (sort === "date_desc") {
			invoices.sort((a, b) => {
				const dateA = a.issued_at ? parseRFC3339(a.issued_at).getTime() : 0;
				const dateB = b.issued_at ? parseRFC3339(b.issued_at).getTime() : 0;
				return dateB - dateA;
			});
		} else if (sort === "date_asc") {
			invoices.sort((a, b) => {
				const dateA = a.issued_at ? parseRFC3339(a.issued_at).getTime() : 0;
				const dateB = b.issued_at ? parseRFC3339(b.issued_at).getTime() : 0;
				return dateA - dateB;
			});
		}

		/// Limit
		const limitNum = parseInt(limit as string, 10);
		if (!isNaN(limitNum) && limitNum > 0) {
			invoices = invoices.slice(0, limitNum);
		}

		res.json({ data: invoices });
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status: 500,
			},
		} satisfies ErrorResponse);
	}
});

/// GET /v1/customers/:customer_id/invoices/:invoice_id
router.get("/:customer_id/invoices/:invoice_id", (req, res) => {
	try {
		const { customer_id, invoice_id } = req.params;

		const invoice = store.getInvoice(invoice_id);

		if (!invoice || invoice.customer_id !== customer_id) {
			return res.status(404).json({
				error: { message: "Invoice not found", status: 404 },
			} satisfies ErrorResponse);
		}

		res.json({ data: invoice });
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status: 500,
			},
		} satisfies ErrorResponse);
	}
});

/// POST /v1/invoices/:invoice_id/void
router.post("/:invoice_id/void", (req, res) => {
	try {
		const { invoice_id } = req.params;

		const invoice = store.getInvoice(invoice_id);

		if (!invoice) {
			return res.status(404).json({
				error: { message: "Invoice not found", status: 404 },
			} satisfies ErrorResponse);
		}

		/// Update invoice status to VOIDED
		store.updateInvoice(invoice_id, {
			status: "VOIDED",
		});

		res.json({
			data: {
				id: invoice_id,
			},
		});
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status: 500,
			},
		} satisfies ErrorResponse);
	}
});

export default router;

