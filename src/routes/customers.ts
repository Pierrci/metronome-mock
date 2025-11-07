/// Customer endpoints

import { Router } from "express";
import { store } from "../store.js";
import { generateId, formatRFC3339 } from "../utils.js";
import type { Customer, ErrorResponse } from "../types.js";

const router = Router();

/// POST /v1/customers
router.post("/", (req, res) => {
	try {
		const {
			name,
			ingest_aliases = [],
			customer_billing_provider_configurations = [],
		} = req.body;

		if (!name) {
			return res.status(400).json({
				error: { message: "name is required", status: 400 },
			} satisfies ErrorResponse);
		}

		/// Check for existing customer with same ingest_aliases
		for (const alias of ingest_aliases) {
			const existing = store.findCustomerByIngestAlias(alias);
			if (existing) {
				return res.status(409).json({
					error: {
						message: "Customer already exists with same ingest_aliases",
						conflicting_id: existing.id,
						status: 409,
					},
				} satisfies ErrorResponse);
			}
		}

		const now = formatRFC3339(new Date());
		const customer: Customer = {
			id: generateId("cus"),
			name,
			ingest_aliases,
			customer_billing_provider_configurations,
			created_at: now,
			updated_at: now,
			custom_fields: {},
		};

		store.createCustomer(customer);

		res.status(201).json({ data: customer });
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status: 500,
			},
		} satisfies ErrorResponse);
	}
});

/// GET /v1/customers/:customer_id
router.get("/:customer_id", (req, res) => {
	try {
		const { customer_id } = req.params;
		const customer = store.getCustomer(customer_id);

		if (!customer) {
			return res.status(404).json({
				error: { message: "Customer not found", status: 404 },
			} satisfies ErrorResponse);
		}

		res.json({ data: customer });
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status: 500,
			},
		} satisfies ErrorResponse);
	}
});

/// POST /v1/customers/:customer_id/archive
/// Also supports POST /v1/customers/archive with { id: customer_id } in body
router.post("/archive", (req, res) => {
	try {
		const { id: customer_id } = req.body;
		if (!customer_id) {
			return res.status(400).json({
				error: { message: "id is required", status: 400 },
			} satisfies ErrorResponse);
		}
		const customer = store.getCustomer(customer_id);

		if (!customer) {
			return res.status(404).json({
				error: { message: "Customer not found", status: 404 },
			} satisfies ErrorResponse);
		}

		/// In a real implementation, this would archive the customer
		/// For the mock, we'll just return success
		res.json({
			data: {
				id: customer_id,
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

/// POST /v1/customers/:customer_id/archive (alternative route)
router.post("/:customer_id/archive", (req, res) => {
	try {
		const { customer_id } = req.params;
		const customer = store.getCustomer(customer_id);

		if (!customer) {
			return res.status(404).json({
				error: { message: "Customer not found", status: 404 },
			} satisfies ErrorResponse);
		}

		/// In a real implementation, this would archive the customer
		/// For the mock, we'll just return success
		res.json({
			data: {
				id: customer_id,
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

