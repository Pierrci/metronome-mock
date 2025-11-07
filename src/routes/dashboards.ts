/// Dashboard endpoints

import { Router } from "express";
import type { DashboardEmbeddableURL, ErrorResponse } from "../types.js";

const router = Router();

/// POST /v1/dashboards/embeddable-url
router.post("/v1/dashboards/embeddable-url", (req, res) => {
	try {
		const { customer_id, dashboard, dashboard_options } = req.body;

		if (!customer_id || !dashboard) {
			return res.status(400).json({
				error: { message: "customer_id and dashboard are required", status: 400 },
			} satisfies ErrorResponse);
		}

		/// Generate a mock embeddable URL
		/// In a real implementation, this would generate a signed URL for the Metronome dashboard
		const baseUrl = process.env.MOCK_METRONOME_URL || "http://localhost:3000";
		const url = `${baseUrl}/dashboards/${dashboard}?customer_id=${customer_id}&${dashboard_options?.map((opt: any) => `${opt.key}=${opt.value}`).join("&") || ""}`;

		res.json({
			data: {
				url,
			} satisfies DashboardEmbeddableURL,
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

