/// Usage ingestion endpoint

import { Router } from "express";
import { store } from "../store.js";
import { generateId } from "../utils.js";
import type { UsageEvent, ErrorResponse } from "../types.js";

const router = Router();

/// POST /v1/usage/ingest
router.post("/v1/usage/ingest", (req, res) => {
	try {
		const { usage } = req.body;

		if (!usage || !Array.isArray(usage)) {
			return res.status(400).json({
				error: { message: "usage array is required", status: 400 },
			} satisfies ErrorResponse);
		}

		const events: UsageEvent[] = usage.map((event: any) => {
			/// Validate required fields
			if (!event.customer_id || !event.event_type || !event.timestamp) {
				throw new Error("Missing required fields: customer_id, event_type, or timestamp");
			}

			return {
				customer_id: event.customer_id,
				event_type: event.event_type,
				timestamp: event.timestamp,
				transaction_id: event.transaction_id || generateId("txn"),
				properties: event.properties || {},
			};
		});

		/// Store all events
		for (const event of events) {
			store.addUsageEvent(event);
		}

		/// In a real implementation, we'd process usage and update invoices/balances
		/// For the mock, we just acknowledge receipt

		res.status(200).json({
			message: "Usage events ingested successfully",
			count: events.length,
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

