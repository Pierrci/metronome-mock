/// Invoice endpoints

import { Router } from "express";
import { store } from "../store.js";
import { generateId, formatRFC3339, parseRFC3339, startOfMonth, addMonths } from "../utils.js";
import type { Invoice, ErrorResponse } from "../types.js";

const router = Router();

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

/// Helper function to create invoices (called internally)
export function createInvoiceForContract(
	customerId: string,
	contractId: string,
	lineItems: Array<{
		type: "subscription" | "usage" | "credit";
		product_id?: string;
		product_name?: string;
		amount: number;
		is_prorated?: boolean;
	}>,
	periodStart: Date,
	periodEnd: Date
): Invoice {
	const invoiceId = generateId("inv");
	const invoice: Invoice = {
		id: invoiceId,
		customer_id: customerId,
		contract_id: contractId,
		type: "USAGE",
		status: "FINALIZED",
		issued_at: formatRFC3339(new Date()),
		start_timestamp: formatRFC3339(periodStart),
		end_timestamp: formatRFC3339(periodEnd),
		total: lineItems.reduce((sum, item) => sum + item.amount, 0),
		line_items: lineItems.map(item => ({
			id: generateId("line"),
			type: item.type,
			product_id: item.product_id,
			product_name: item.product_name,
			amount: item.amount,
			is_prorated: item.is_prorated,
		})),
		external_invoice: {
			invoice_id: generateId("stripe_inv"),
			external_status: "FINALIZED",
		},
		metadata: {
			metronome_id: invoiceId,
		},
	};

	store.createInvoice(invoice);
	return invoice;
}

export default router;

