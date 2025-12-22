/// Mock Metronome Server
/// A faithful emulation of the Metronome billing API for software engineering exercises

import express from "express";
import cors from "cors";
import customersRouter from "./routes/customers.js";
import contractsRouter from "./routes/contracts.js";
import usageRouter from "./routes/usage.js";
import invoicesRouter from "./routes/invoices.js";
import balancesRouter from "./routes/balances.js";
import dashboardsRouter from "./routes/dashboards.js";
import webhooksRouter from "./routes/webhooks.js";
import { store } from "./store.js";

const app = express();
const PORT = process.env.PORT || 3000;

/// Middleware
app.use(cors());
app.use(express.json());

/// Request logging middleware
app.use((req, res, next) => {
	console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
	next();
});

/// Health check
app.get("/health", (req, res) => {
	res.json({ status: "ok", service: "mock-metronome-server" });
});

/// Reset store (for testing)
app.post("/reset", (req, res) => {
	store.reset();
	res.json({ status: "ok" });
});

/// API Routes
app.use("/v1/customers", customersRouter);
app.use("/v1/contracts", contractsRouter);
app.use("/v2/contracts", contractsRouter);
app.use("/v1/usage", usageRouter);
app.use("/v1/customers", invoicesRouter); /// Invoices are nested under customers
app.use("/v1/invoices", invoicesRouter);
app.use("/v1/contracts", balancesRouter);
app.use("/v1/dashboards", dashboardsRouter);
app.use("/webhooks", webhooksRouter);

/// 404 handler
app.use((req, res) => {
	res.status(404).json({
		error: {
			message: `Route not found: ${req.method} ${req.path}`,
			status: 404,
		},
	});
});

/// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
	console.error("Error:", err);
	res.status(500).json({
		error: {
			message: err.message || "Internal server error",
			status: 500,
		},
	});
});

/// Start server
app.listen(PORT, () => {
	console.log(`🚀 Mock Metronome Server running on http://localhost:${PORT}`);
	console.log(`📚 API Documentation: See README.md for endpoint details`);
	console.log(`💡 Health check: http://localhost:${PORT}/health`);
});

