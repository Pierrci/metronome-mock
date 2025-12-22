# Metronome Server Mock

![CI](https://github.com/grant/metronome-mock/actions/workflows/ci.yml/badge.svg)

A partial emulation of the Metronome billing API that passes internal tests we have at HF (for the covered portion), initially created for coding exercises since one can't create a dev Metronome account on their own.

## Features

- ✅ **Customer Management**: Create and retrieve customers
- ✅ **Contract Management**: V1 and V2 contract operations (create, list, retrieve, edit)
- ✅ **Credit Bridging Logic**: Mirrors Metronome's behavior for recurring credits, cancel/un-cancel flows, and next-period credit creation
- ✅ **Webhook Dispatch**: Emits contract/payment/alert events and supports manual webhook triggering
- ✅ **Usage Ingestion**: Accept and store usage events
- ✅ **Invoice Management**: List, retrieve, void, and create invoices (manual creation for testing)
- ✅ **Balance Tracking**: Query customer balances
- ✅ **Dashboard URLs**: Generate embeddable dashboard URLs
- ✅ **Webhook Verification**: Verify webhook signatures
- ✅ **In-Memory Storage**: All data stored in memory (resets on restart)

## Installation

```bash
npm install
```

## Running the Server

```bash
# Production mode
npm start

# Development mode (with auto-reload)
npm run dev
```

The server will start on `http://localhost:3000` by default. You can change the port by setting the `PORT` environment variable.

### Webhook Dispatch & Integration

The mock can deliver Metronome-style webhooks:

- Set `MOCK_METRONOME_WEBHOOK_TARGET` to the full webhook URL.
- Optionally set `MOCK_METRONOME_WEBHOOK_PATH` if you only want to provide the origin/host.
- Alternatively, register targets at runtime:

  ```bash
  curl -X POST http://localhost:3199/webhooks/subscriptions \
    -H "Content-Type: application/json" \
    -d '{ "target": "http://localhost:5564/api/webhooks/metronome" }'
  ```

- Inspect/clear subscriptions via `GET /webhooks/subscriptions` and `DELETE /webhooks/subscriptions` (with optional `{ "target": "..." }` body).
- Manually dispatch a custom event using `POST /webhooks/dispatch` with a JSON body containing the event payload (`{ "type": "payment_gate.payment_status", ... }`).
- Automatic events:
  - `contract.created` and `contract.updated` fire on contract creation/edits.
  - `payment_gate.payment_status` fires when a contract edit includes `add_prepaid_balance_threshold_configuration.commit`. Add `mock_payment_status: "failed"` to simulate failures.
  - `alerts.low_remaining_contract_credit_and_commit_balance_reached` fires when a balance (set via helper APIs) drops below the configured threshold. Configure `MOCK_METRONOME_ALERT_CUSTOMER_BALANCE_DEPLETED` or rely on `NODE_METRONOME_CONFIG` to match the Hub config.

## API Endpoints

### Customers
- POST /v1/customers
- GET /v1/customers/:customer_id

### Contracts
- POST /v1/contracts
- GET /v1/contracts/:contract_id
- POST /v1/contracts/:contract_id/edit
- GET /v2/contracts
- GET /v2/contracts/:contract_id
- POST /v2/contracts/:contract_id/edit
- POST /v2/contracts/edit

### Usage
- POST /v1/usage/ingest

### Invoices
- POST /v1/customers/:customer_id/invoices (create invoice for mocking purposes)
- GET /v1/customers/:customer_id/invoices
- GET /v1/customers/:customer_id/invoices/:invoice_id
- POST /v1/invoices/:invoice_id/void

### Balances
- GET /v1/contracts/balances

### Dashboards
- POST /v1/dashboards/embeddable-url

### Webhooks
- POST /webhooks/verify
- GET /webhooks/subscriptions
- POST /webhooks/subscriptions
- DELETE /webhooks/subscriptions
- POST /webhooks/dispatch

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "message": "Error message",
    "status": 400,
    "conflicting_id": "id_123"  // Optional, for 409 conflicts
  }
}
```

## Common Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `404` - Not Found
- `409` - Conflict (e.g., uniqueness key already used)
- `500` - Internal Server Error

## Implementation Notes

### Data Persistence

This mock server uses in-memory storage. All data is lost when the server restarts.

### Invoice Generation

The mock server does not automatically generate invoices from usage events. In a real implementation, Metronome would:
1. Process usage events
2. Apply credits and subscriptions
3. Generate invoices at billing period boundaries
4. Create external invoices in Stripe

The mock provides a basic invoice creation endpoint (`POST /v1/customers/:customer_id/invoices`) that allows you to fake/manually create invoices with line items.

**Request body example:**
```json
{
  "contract_id": "contract_123",
  "type": "USAGE",
  "status": "FINALIZED",
  "line_items": [
    {
      "type": "usage",
      "product_id": "prod_123",
      "product_name": "API Calls",
      "amount": 100.50,
      "is_prorated": false
    }
  ],
  "start_timestamp": "2024-01-01T00:00:00Z",
  "end_timestamp": "2024-01-31T23:59:59Z",
  "due_date": "2024-02-15T00:00:00Z"
}
``` 

### Balance Calculation

Balances are not automatically calculated from usage and credits. The mock provides an endpoint to retrieve balances, but you may need to implement balance calculation logic if needed (or hardcode/fake it).

### Webhook Verification

The webhook verification is simplified. In production, Metronome uses HMAC-SHA256 signatures. The mock verifies signatures but uses a simplified algorithm.

## Environment Variables

- `PORT` - Server port (default: 3000)
- `METRONOME_WEBHOOK_SECRET` - Webhook secret for signature verification (default: "test-secret")
- `MOCK_METRONOME_URL` - Base URL for dashboard embeddable URLs (default: "http://localhost:3000")

## Contributing

If you find bugs or missing features, feel free to update the implementation locally to match the real Metronome API behavior (and open PRs if you want).

## License

MIT

