import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../index.js";
import { store } from "../store.js";

describe("Mock Metronome Server", () => {
  beforeEach(() => {
    store.reset();
  });

  describe("Basic Endpoints", () => {
    it("should return ok for health check", async () => {
      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: "ok",
        service: "mock-metronome-server",
      });
    });

    it("should return 404 for unknown routes", async () => {
      const response = await request(app).get("/v1/unknown");
      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain("Route not found");
    });
  });

  describe("Customers", () => {
    it("should create and retrieve a customer", async () => {
      const customerData = {
        name: "Test Customer",
        ingest_aliases: ["test-alias"],
      };

      const createRes = await request(app).post("/v1/customers").send(customerData);
      expect(createRes.status).toBe(201);
      const customerId = createRes.body.data.id;

      const getRes = await request(app).get(`/v1/customers/${customerId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.name).toBe("Test Customer");
    });
  });

  describe("Contracts", () => {
    let customerId: string;

    beforeEach(async () => {
      const res = await request(app).post("/v1/customers").send({ name: "Contract Customer" });
      customerId = res.body.data.id;
    });

    it("should create and retrieve a contract", async () => {
      const contractData = {
        name: "Test Contract",
        customer_id: customerId,
        starting_at: "2024-01-01T00:00:00Z",
        rate_card_id: "rc_123",
      };

      const createRes = await request(app).post("/v1/contracts").send(contractData);
      expect(createRes.status).toBe(201);
      const contractId = createRes.body.data.id;

      const getRes = await request(app).get(`/v2/contracts/${contractId}`).query({ customer_id: customerId });
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(contractId);
    });

    it("should edit a contract", async () => {
      const createRes = await request(app).post("/v1/contracts").send({
        name: "Edit Test",
        customer_id: customerId,
        starting_at: "2024-01-01T00:00:00Z",
        rate_card_id: "rc_123",
      });
      const contractId = createRes.body.data.id;

      const editRes = await request(app).post(`/v2/contracts/${contractId}/edit`).send({
        customer_id: customerId,
        add_subscriptions: [{
          temporary_id: "sub_1",
          starting_at: "2024-01-01T00:00:00Z",
          subscription_rate: {
            product_id: "prod_1",
            billing_frequency: "MONTHLY",
          },
        }],
      });
      expect(editRes.status).toBe(200);

      const getRes = await request(app).get(`/v2/contracts/${contractId}`).query({ customer_id: customerId });
      expect(getRes.body.data.subscriptions.length).toBe(1);
    });
  });

  describe("Usage Ingestion", () => {
    it("should ingest usage events", async () => {
      const usageData = {
        usage: [
          {
            customer_id: "cus_123",
            event_type: "api_call",
            timestamp: "2024-01-01T00:00:00Z",
            properties: { count: 1 },
          },
        ],
      };

      const response = await request(app).post("/v1/usage/ingest").send(usageData);
      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
    });
  });

  describe("Invoices", () => {
    let customerId: string;
    let contractId: string;

    beforeEach(async () => {
      const cusRes = await request(app).post("/v1/customers").send({ name: "Invoice Customer" });
      customerId = cusRes.body.data.id;
      const conRes = await request(app).post("/v1/contracts").send({
        name: "Invoice Contract",
        customer_id: customerId,
        starting_at: "2024-01-01T00:00:00Z",
        rate_card_id: "rc_123",
      });
      contractId = conRes.body.data.id;
    });

    it("should create and list invoices", async () => {
      const invoiceData = {
        contract_id: contractId,
        type: "USAGE",
        line_items: [{ product_id: "p1", product_name: "P1", amount: 100 }],
      };

      const createRes = await request(app).post(`/v1/customers/${customerId}/invoices`).send(invoiceData);
      expect(createRes.status).toBe(201);

      const listRes = await request(app).get(`/v1/customers/${customerId}/invoices`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
    });
  });

  describe("Balances", () => {
    it("should return balances", async () => {
      const response = await request(app).get("/v1/contracts/balances").query({ customer_id: "cus_123" });
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe("Dashboards", () => {
    it("should generate embeddable URL", async () => {
      const response = await request(app).post("/v1/dashboards/embeddable-url").send({
        customer_id: "cus_123",
        dashboard: "usage",
      });
      expect(response.status).toBe(200);
      expect(response.body.data.url).toContain("cus_123");
    });
  });

  describe("Webhooks", () => {
    it("should manage subscriptions", async () => {
      const targetUrl = "http://example.com/webhook";
      const subRes = await request(app).post("/webhooks/subscriptions").send({ target: targetUrl });
      expect(subRes.status).toBe(200);

      const normalizedTarget = new URL(targetUrl).toString();
      expect(subRes.body.data).toContain(normalizedTarget);

      const listRes = await request(app).get("/webhooks/subscriptions");
      expect(listRes.body.data).toContain(normalizedTarget);

      const delRes = await request(app).delete("/webhooks/subscriptions").send({ target: targetUrl });
      expect(delRes.body.data).not.toContain(normalizedTarget);
    });
  });
});
