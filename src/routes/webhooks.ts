/// Webhook verification & dispatch utilities

import { Router, type RequestHandler } from "express";
import crypto from "crypto";
import type { ErrorResponse } from "../types.js";
import {
	registerWebhookTarget,
	removeWebhookTarget,
	clearWebhookTargets,
	getWebhookTargets,
	dispatchRawEvent,
} from "../webhooks/dispatcher.js";

const router = Router();
const webhookSecret = process.env.METRONOME_WEBHOOK_SECRET || "test-secret";

function verifySignature(payload: string, dateHeader: string, signature: string): boolean {
	const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(`${dateHeader}\n${payload}`).digest("hex");
	return expectedSignature === signature;
}

const verifyHandler: RequestHandler = (req, res) => {
	try {
		const signatureHeader =
			(req.header("Metronome-Webhook-Signature") || req.header("X-Metronome-Signature")) ?? "";
		if (!signatureHeader) {
			return res.status(401).json({
				error: { message: "Missing signature", status: 401 },
			} satisfies ErrorResponse);
		}

		const dateHeader = req.header("Date") ?? new Date().toUTCString();
		const rawBody = JSON.stringify(req.body);

		if (!verifySignature(rawBody, dateHeader, signatureHeader)) {
			return res.status(401).json({
				error: { message: "Invalid signature", status: 401 },
			} satisfies ErrorResponse);
		}

		res.json(req.body);
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status: 500,
			},
		} satisfies ErrorResponse);
	}
};

router.post("/verify", verifyHandler);
/// Support legacy path used earlier in this mock
router.post("/webhooks/verify", verifyHandler);

router.get("/subscriptions", (_req, res) => {
	res.json({ data: getWebhookTargets() });
});

router.post("/subscriptions", (req, res) => {
	const { target } = req.body ?? {};
	if (typeof target !== "string" || target.trim().length === 0) {
		return res.status(400).json({
			error: { message: "target is required", status: 400 },
		} satisfies ErrorResponse);
	}
	registerWebhookTarget(target);
	res.json({ data: getWebhookTargets() });
});

router.delete("/subscriptions", (req, res) => {
	const { target } = req.body ?? {};
	if (typeof target === "string" && target.trim().length > 0) {
		removeWebhookTarget(target);
	} else {
		clearWebhookTargets();
	}
	res.json({ data: getWebhookTargets() });
});

router.post("/dispatch", async (req, res) => {
	try {
		const payload =
			req.body && typeof req.body === "object" && Object.keys(req.body).length === 1 && req.body.event
			? req.body.event
			: req.body;

		if (!payload || typeof payload !== "object") {
			return res.status(400).json({
				error: { message: "event payload is required", status: 400 },
			} satisfies ErrorResponse);
		}

		await dispatchRawEvent(payload as Record<string, unknown>);
		res.json({ data: payload });
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

