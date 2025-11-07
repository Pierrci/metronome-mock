/// Balance endpoints

import { Router } from "express";
import { store } from "../store.js";
import type { ErrorResponse } from "../types.js";
import { emitLowBalanceAlert } from "../webhooks/dispatcher.js";

const router = Router();

/// GET /v1/contracts/balances
/// This endpoint returns an async iterator in the real API, but for simplicity we'll return an array
router.get("/balances", (req, res) => {
	try {
		const { customer_id, covering_date } = req.query;

		if (!customer_id || typeof customer_id !== "string") {
			return res.status(400).json({
				error: { message: "customer_id is required", status: 400 },
			} satisfies ErrorResponse);
		}

		const balances = store.getAllBalances(customer_id);

		/// If no balances exist, return empty array
		/// In a real implementation, we'd calculate balances from usage and credits

		res.json({
			data: balances,
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

/// Helper function to set balance (called internally)
export function setBalanceForProduct(
	customerId: string,
	productId: string,
	balance: number
): void {
	store.setBalance(customerId, productId, {
		product: {
			id: productId,
			name: `Product ${productId}`,
		},
		balance,
	});

	const contracts = store.listContractsV2(customerId);
	for (const contract of contracts) {
		const config = contract.prepaid_balance_threshold_configuration;
		if (!config?.is_enabled) {
			continue;
		}
		const thresholdAmount = config.threshold_amount ?? 0;
		if (thresholdAmount <= 0) {
			continue;
		}
		if (balance <= thresholdAmount) {
			void emitLowBalanceAlert({
				customerId,
				contractId: contract.id,
				threshold: thresholdAmount,
				remainingBalance: balance,
			});
		}
	}
}

export default router;

