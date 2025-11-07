/// Contract endpoints (V1 and V2)

import { Router, type Request, type Response } from "express";
import { store } from "../store.js";
import {
	generateId,
	formatRFC3339,
	parseRFC3339,
	startOfMonth,
	addMonths,
	startOfHour,
} from "../utils.js";
import { setBalanceForProduct } from "./balances.js";
import type {
	ContractV1,
	ContractV2,
	ErrorResponse,
	Subscription,
	Credit,
	RecurringCredit,
	ProductOverride,
} from "../types.js";
import { emitContractEvent, emitPaymentGateStatus } from "../webhooks/dispatcher.js";

const router = Router();

const normalizeRFC3339 = (value: string) => formatRFC3339(startOfHour(parseRFC3339(value)));

/// POST /v1/contracts or /v1/contracts/create
const handleCreateContract = (req: Request, res: Response) => {
	try {
		const {
			name,
			uniqueness_key,
			customer_id,
			starting_at,
			rate_card_id,
			usage_statement_schedule,
			billing_provider_configuration,
		} = req.body;

		if (!name || !customer_id || !starting_at || !rate_card_id) {
			return res.status(400).json({
				error: { message: "Missing required fields", status: 400 },
			} satisfies ErrorResponse);
		}

		/// Check if customer exists
		const customer = store.getCustomer(customer_id);
		if (!customer) {
			return res.status(404).json({
				error: { message: "Customer not found", status: 404 },
			} satisfies ErrorResponse);
		}

		/// Check uniqueness key
		if (uniqueness_key && store.hasUniquenessKey(uniqueness_key)) {
			return res.status(409).json({
				error: {
					message: "Contract already exists with same uniqueness_key",
					status:  409,
				},
			} satisfies ErrorResponse);
		}

		const contract: ContractV1 = {
			id:                       generateId("contract"),
			name,
			uniqueness_key:           uniqueness_key || generateId("uk"),
			customer_id,
			starting_at,
			rate_card_id,
			usage_statement_schedule: usage_statement_schedule || { frequency: "MONTHLY" },
			billing_provider_configuration: billing_provider_configuration || {
				billing_provider: "stripe",
			},
		};

		store.createContractV1(contract);

		/// Also create a V2 contract for compatibility
		const contractV2: ContractV2 = {
			id:                contract.id,
			customer_id:       contract.customer_id,
			starting_at:       contract.starting_at,
			uniqueness_key:    contract.uniqueness_key,
			subscriptions:     [],
			credits:           [],
			recurring_credits: [],
			overrides:         [],
		};
		store.createContractV2(contractV2);
		void emitContractEvent(contractV2, "contract.created");

		res.status(201).json({ data: { id: contract.id } });
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status:  500,
			},
		} satisfies ErrorResponse);
	}
};

router.post("/", handleCreateContract);
router.post("/create", handleCreateContract);

/// GET /v2/contracts
router.get("/", (req, res) => {
	try {
		const { customer_id, covering_date, include_archived } = req.query;

		if (!customer_id || typeof customer_id !== "string") {
			return res.status(400).json({
				error: { message: "customer_id is required", status: 400 },
			} satisfies ErrorResponse);
		}

		let contracts = store.listContractsV2(customer_id);

		/// Filter by covering_date if provided
		if (covering_date && typeof covering_date === "string") {
			const covering = parseRFC3339(covering_date);
			contracts = contracts.filter(contract => {
				const start = parseRFC3339(contract.starting_at);
				return start <= covering;
			});
		}

		/// Filter archived if needed
		if (include_archived !== "true") {
			/// In a real implementation, we'd check for archived status
		}

		res.json({ data: contracts });
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status:  500,
			},
		} satisfies ErrorResponse);
	}
});

/// GET /v2/contracts/:contract_id or POST /v2/contracts/get
const handleGetContract = (req: Request, res: Response) => {
	try {
		/// contract_id can be in params (GET) or body (POST /get)
		const contract_id = req.params.contract_id || req.body.contract_id;
		const customer_id = req.query.customer_id || req.body.customer_id;

		if (!contract_id) {
			return res.status(400).json({
				error: { message: "contract_id is required", status: 400 },
			} satisfies ErrorResponse);
		}

		if (!customer_id || typeof customer_id !== "string") {
			return res.status(400).json({
				error: { message: "customer_id is required", status: 400 },
			} satisfies ErrorResponse);
		}

		const contract = store.getContractV2(contract_id);

		if (!contract || contract.customer_id !== customer_id) {
			return res.status(404).json({
				error: { message: "Contract not found", status: 404 },
			} satisfies ErrorResponse);
		}

		res.json({ data: contract });
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status:  500,
			},
		} satisfies ErrorResponse);
	}
};

router.get("/:contract_id", handleGetContract);
router.post("/get", handleGetContract);

/// Handle contract edit - support POST, PUT, and PATCH
const handleContractEdit = (req: Request, res: Response) => {
	try {
		/// contract_id can be in params or body
		const contract_id = req.params.contract_id || req.body.contract_id;
		const {
			customer_id,
			uniqueness_key,
			update_subscriptions = [],
			update_recurring_credits = [],
			archive_credits = [],
			add_subscriptions = [],
			add_recurring_credits = [],
			add_credits = [],
			add_overrides = [],
			update_prepaid_balance_threshold_configuration,
			add_prepaid_balance_threshold_configuration,
		} = req.body;

		if (process.env.DEBUG_METRONOME === "true") {
			console.log(
				"[DEBUG contracts/edit request]",
				JSON.stringify(
					{
						contract_id,
						customer_id,
						update_subscriptions,
						add_subscriptions,
						add_recurring_credits,
						add_credits,
					},
					null,
					2
				)
			);
		}

		if (!contract_id) {
			return res.status(400).json({
				error: { message: "contract_id is required", status: 400 },
			} satisfies ErrorResponse);
		}

		if (!customer_id) {
			return res.status(400).json({
				error: { message: "customer_id is required", status: 400 },
			} satisfies ErrorResponse);
		}

		const contract = store.getContractV2(contract_id);
		if (!contract || contract.customer_id !== customer_id) {
			return res.status(404).json({
				error: { message: "Contract not found", status: 404 },
			} satisfies ErrorResponse);
		}

		let pendingPaymentGateStatus: "paid" | "failed" | undefined;

		/// Check uniqueness key if provided
		if (uniqueness_key && store.hasUniquenessKey(uniqueness_key)) {
			return res.status(409).json({
				error: {
					message: "Uniqueness key already used",
					status:  409,
				},
			} satisfies ErrorResponse);
		}

		/// Update subscriptions
		if (update_subscriptions.length > 0 && contract.subscriptions) {
			for (const update of update_subscriptions) {
				const sub = contract.subscriptions.find(s => s.id === update.subscription_id);
				if (sub) {
					if (update.ending_before) {
						sub.ending_before = update.ending_before;
					}
					/// Recalculate billing periods if needed
					if (sub.billing_periods?.current) {
						const currentStart = parseRFC3339(sub.billing_periods.current.starting_at);
						const currentEnd = sub.billing_periods.current.ending_before
							? parseRFC3339(sub.billing_periods.current.ending_before)
							: null;
						/// Ensure ending_before is at start of month for future dates
						if (currentEnd && currentEnd > new Date()) {
							const normalizedEnd = startOfHour(startOfMonth(currentEnd));
							sub.billing_periods.current.ending_before = formatRFC3339(normalizedEnd);
						}
					}
				}
			}
		}

		/// Update recurring credits
		if (update_recurring_credits.length > 0 && contract.recurring_credits) {
			for (const update of update_recurring_credits) {
				const credit = contract.recurring_credits.find(c => c.id === update.recurring_credit_id);
				if (credit && update.ending_before) {
					credit.ending_before = update.ending_before;
				}
			}
		}

		/// Archive credits
		if (archive_credits.length > 0 && contract.credits) {
			for (const archive of archive_credits) {
				const credit = contract.credits.find(c => c.id === archive.id);
				if (credit) {
					credit.archived_at = formatRFC3339(new Date());
				}
			}
		}

		/// Add subscriptions
		if (add_subscriptions.length > 0) {
			if (!contract.subscriptions) {
				contract.subscriptions = [];
			}
			for (const subData of add_subscriptions) {
				const now = new Date();
				const subStart = parseRFC3339(subData.starting_at);
				/// Calculate billing periods properly - ending_before must be at start of next period (start of month)
				/// This is critical for validation: future transition dates MUST be at the start of the month
				const isMonthly = subData.subscription_rate.billing_frequency === "MONTHLY";
				/// Normalize to start of month, then to hour boundary
				const periodStartMonth = startOfMonth(subStart);
				const periodStart = startOfHour(periodStartMonth);
				/// Period end is start of next month (for monthly) or next year (for annual)
				const periodEndMonth = isMonthly ? addMonths(periodStartMonth, 1) : addMonths(periodStartMonth, 12);
				const periodEnd = startOfHour(periodEndMonth);
				/// Next period
				const nextPeriodStartMonth = periodEndMonth;
				const nextPeriodEndMonth = isMonthly ? addMonths(nextPeriodStartMonth, 1) : addMonths(nextPeriodStartMonth, 12);
				const nextPeriodStart = periodEnd;
				const nextPeriodEnd = startOfHour(nextPeriodEndMonth);

				const sub: Subscription = {
					id:                subData.temporary_id || generateId("sub"),
					starting_at:       subData.starting_at,
					subscription_rate: {
						product: {
							id:   subData.subscription_rate.product_id,
							name: `Product ${subData.subscription_rate.product_id}`,
						},
						billing_frequency: subData.subscription_rate.billing_frequency,
					},
					quantity_schedule: [
						{
							quantity:    subData.initial_quantity || 1,
							starting_at: subData.starting_at,
						},
					],
					custom_fields:   subData.custom_fields || {},
					billing_periods: {
						current: {
							starting_at:   formatRFC3339(periodStart),
							ending_before: formatRFC3339(periodEnd),
						},
						next: {
							starting_at:   formatRFC3339(nextPeriodStart),
							ending_before: formatRFC3339(nextPeriodEnd),
						},
					},
				};
				contract.subscriptions.push(sub);
			}
		}

		/// Add recurring credits first (needed for credit creation logic)
		const addedRecurringCredits: RecurringCredit[] = [];
		const now = new Date();
		const endingSubIds = new Set(
			update_subscriptions.map((update: (typeof update_subscriptions)[number]) => update.subscription_id)
		);
		const endingSubs = contract.subscriptions?.filter((sub: Subscription) => endingSubIds.has(sub.id));
		if (add_recurring_credits.length > 0) {
			if (!contract.recurring_credits) {
				contract.recurring_credits = [];
			}
			for (const creditData of add_recurring_credits) {
				const rcStart = startOfHour(parseRFC3339(creditData.starting_at));
				const normalizedRcStart = formatRFC3339(rcStart);
				const targetSubId = creditData.subscription_config?.subscription_id ?? null;

				const isActiveRecurring = (
					recurring: RecurringCredit,
					productId: string,
					normalizedStart: string,
					subscriptionId: string | null
				): boolean => {
					if (recurring.product.id !== productId) {
						return false;
					}
					const recurringStart = normalizeRFC3339(recurring.starting_at);
					if (recurringStart !== normalizedStart) {
						return false;
					}
					const recurringSubId = recurring.subscription_config?.subscription_id ?? null;
					if (recurringSubId !== subscriptionId) {
						return false;
					}
					if (recurring.ending_before) {
						const recurringEnd = startOfHour(parseRFC3339(recurring.ending_before));
						if (recurringEnd <= rcStart) {
							return false;
						}
					}
					return true;
				};

				const existingActiveRecurring =
					(contract.recurring_credits || []).find(recurring =>
						isActiveRecurring(recurring, creditData.product_id, normalizedRcStart, targetSubId)
					) ?? null;

				if (!existingActiveRecurring) {
					const recurring: RecurringCredit = {
						id:      generateId("rc"),
						product: {
							id:   creditData.product_id,
							name: `Product ${creditData.product_id}`,
						},
						starting_at:         normalizedRcStart,
						subscription_config: targetSubId
							? {
									subscription_id: targetSubId,
								}
							: undefined,
					};
					contract.recurring_credits!.push(recurring);
					addedRecurringCredits.push(recurring);
				}

				if (rcStart <= now || !targetSubId) {
					continue;
				}

				const targetSub =
					contract.subscriptions?.find((sub: Subscription) => sub.id === targetSubId) ||
					add_subscriptions.find((sub: (typeof add_subscriptions)[0]) => sub.temporary_id === targetSubId);

				const hasMatchingAddCredit = add_credits.some(
					(credit: (typeof add_credits)[number]) => credit.product_id === creditData.product_id
				);

				if (process.env.DEBUG_METRONOME === "true") {
					console.log(
						"[DEBUG recurring credit]",
						JSON.stringify(
							{
								productId:          creditData.product_id,
								startingAt:         creditData.starting_at,
								hasMatchingAddCredit,
								addCreditsProducts: add_credits.map((credit: (typeof add_credits)[number]) => credit.product_id),
							},
							null,
							2
						)
					);
				}

				const newSub = add_subscriptions.find((sub: (typeof add_subscriptions)[0]) => sub.temporary_id === targetSubId);
				const newSubTierId = newSub?.custom_fields?.tier_id;

				let matchingSub =
					contract.subscriptions?.find((sub: Subscription) => {
						return (
							sub.id === targetSubId &&
							parseRFC3339(sub.starting_at) <= now &&
							(!sub.ending_before || parseRFC3339(sub.ending_before) > now)
						);
					}) ||
					add_subscriptions.find((sub: (typeof add_subscriptions)[0]) => {
						return sub.temporary_id === targetSubId && parseRFC3339(sub.starting_at) <= now;
					});

				if (!matchingSub && newSubTierId) {
					const activeSubsWithTier = contract.subscriptions?.filter((sub: Subscription) => {
						return (
							sub.custom_fields?.tier_id === newSubTierId &&
							parseRFC3339(sub.starting_at) <= now &&
							(!sub.ending_before || parseRFC3339(sub.ending_before) > now)
						);
					});
					if (activeSubsWithTier && activeSubsWithTier.length > 0) {
						matchingSub = activeSubsWithTier.find((sub: Subscription) => sub.ending_before) || activeSubsWithTier[0];
					}
				}

				if (matchingSub && matchingSub.id === targetSubId && newSubTierId) {
					const activeSubsWithTier = contract.subscriptions?.filter((sub: Subscription) => {
						return (
							sub.custom_fields?.tier_id === newSubTierId &&
							parseRFC3339(sub.starting_at) <= now &&
							(!sub.ending_before || parseRFC3339(sub.ending_before) > now)
						);
					});
					if (activeSubsWithTier && activeSubsWithTier.length > 0) {
						const preferred =
							activeSubsWithTier.find((sub: Subscription) => sub.ending_before) || activeSubsWithTier[0];
						if (preferred && preferred.id !== targetSubId) {
							if (process.env.DEBUG_METRONOME === "true") {
								console.log(
									"[DEBUG uncancel match reassigned]",
									JSON.stringify(
										{
											product:        creditData.product_id,
											targetSubId,
											preferredSubId: preferred.id,
											preferredTier:  preferred.custom_fields?.tier_id,
										},
										null,
										2
									)
								);
							}
							matchingSub = preferred;
						}
					}
				}

				if (!matchingSub && endingSubs && endingSubs.length > 0) {
					const candidate = endingSubs.find(sub => {
						return (
							parseRFC3339(sub.starting_at) <= now && (!sub.ending_before || parseRFC3339(sub.ending_before) > now)
						);
					});
					if (candidate) {
						if (process.env.DEBUG_METRONOME === "true") {
							console.log(
								"[DEBUG uncancel match from ending subs]",
								JSON.stringify(
									{
										product:        creditData.product_id,
										targetSubId,
										candidateSubId: candidate.id,
										candidateTier:  candidate.custom_fields?.tier_id,
									},
									null,
									2
								)
							);
						}
						matchingSub = candidate;
					}
				}

				if (!matchingSub && newSub?.subscription_rate?.product_id) {
					const activeSameProductSub = contract.subscriptions?.find((sub: Subscription) => {
						return (
							sub.subscription_rate?.product?.id === newSub.subscription_rate.product_id &&
							parseRFC3339(sub.starting_at) <= now &&
							(!sub.ending_before || parseRFC3339(sub.ending_before) > now)
						);
					});
					if (activeSameProductSub) {
						if (process.env.DEBUG_METRONOME === "true") {
							console.log(
								"[DEBUG uncancel match from same product]",
								JSON.stringify(
									{
										product:        creditData.product_id,
										targetSubId,
										candidateSubId: activeSameProductSub.id,
										candidateTier:  activeSameProductSub.custom_fields?.tier_id,
									},
									null,
									2
								)
							);
						}
						matchingSub = activeSameProductSub;
					}
				}

				if (!matchingSub) {
					if (process.env.DEBUG_METRONOME === "true") {
						console.log(
							"[DEBUG uncancel skip - no matching sub]",
							JSON.stringify(
								{
									product:        creditData.product_id,
									targetSubId,
									newSubTierId,
									recurringStart: creditData.starting_at,
									now,
								},
								null,
								2
							)
						);
					}
					continue;
				}

				const isUncancelScenario =
					rcStart > now && targetSubId !== null && (endingSubIds.has(targetSubId) || matchingSub.id !== targetSubId);
				if (!isUncancelScenario) {
					if (process.env.DEBUG_METRONOME === "true") {
						console.log(
							"[DEBUG uncancel skip - condition]",
							JSON.stringify(
								{
									product:           creditData.product_id,
									targetSubId,
									matchingSubId:     matchingSub.id,
									matchingSubTierId: matchingSub.custom_fields?.tier_id,
									newSubTierId,
									rcStart,
									now,
								},
								null,
								2
							)
						);
					}
					continue;
				}

				if (process.env.DEBUG_METRONOME === "true") {
					console.log(
						"[DEBUG uncancel scenario]",
						JSON.stringify(
							{
								product:           creditData.product_id,
								targetSubId,
								matchingSubId:     matchingSub.id,
								matchingSubTierId: matchingSub.custom_fields?.tier_id,
								newSubTierId,
								rcStart,
								now,
							},
							null,
							2
						)
					);
				}

				const activeSub = matchingSub;

				const contractStart = parseRFC3339(contract.starting_at);
				const periodAnchor = contractStart > startOfMonth(now) ? contractStart : startOfMonth(now);
				const currentPeriodStart = startOfHour(periodAnchor);
				const currentPeriodEnd = startOfHour(startOfMonth(rcStart));
				if (currentPeriodEnd <= currentPeriodStart) {
					continue;
				}

				const relevantAddCredits = add_credits.filter((credit: (typeof add_credits)[number]) => {
					return Boolean(credit.access_schedule?.schedule_items?.length);
				});

				if (process.env.DEBUG_METRONOME === "true" && relevantAddCredits.length > 0) {
					console.log(
						"[DEBUG add credits for bridging]",
						JSON.stringify(
							relevantAddCredits.map((credit: (typeof add_credits)[number]) => ({
								product_id:      credit.product_id,
								subscription_id: credit.subscription_config?.subscription_id,
								credit_type_id:  credit.access_schedule?.credit_type_id,
								schedule_start:  credit.access_schedule?.schedule_items?.[0]?.starting_at,
								schedule_ending: credit.access_schedule?.schedule_items?.[0]?.ending_before,
								amount:          credit.access_schedule?.schedule_items?.[0]?.amount,
							})),
							null,
							2
						)
					);
				}

				const existingCreditsForMatching = (contract.credits || []).filter(credit => {
					if (credit.subscription_config?.subscription_id === activeSub.id) {
						return true;
					}
					return credit.custom_fields?.tier_id === activeSub.custom_fields?.tier_id;
				});

				type ProductContext = {
					productId:            string;
					creditAmount:         number;
					creditTypeId:         string;
					hasMatchingAddCredit: boolean;
				};

				const productContexts: ProductContext[] = [
					{
						productId:    creditData.product_id,
						creditAmount: creditData.access_amount?.unit_price || 0,
						creditTypeId: creditData.access_amount?.credit_type_id || "",
						hasMatchingAddCredit,
					},
				];

				for (const addCredit of relevantAddCredits) {
					if (!addCredit.access_schedule?.schedule_items?.[0]) {
						continue;
					}
					if (productContexts.some(ctx => ctx.productId === addCredit.product_id)) {
						continue;
					}
					const scheduleItem = addCredit.access_schedule.schedule_items[0];
					productContexts.push({
						productId:            addCredit.product_id,
						creditAmount:         scheduleItem.amount ?? 0,
						creditTypeId:         addCredit.access_schedule?.credit_type_id || "",
						hasMatchingAddCredit: true,
					});
				}

				for (const credit of existingCreditsForMatching) {
					const scheduleItem = credit.access_schedule?.schedule_items?.[0];
					if (!scheduleItem) {
						continue;
					}
					if (productContexts.some(ctx => ctx.productId === credit.product.id)) {
						continue;
					}
					productContexts.push({
						productId:            credit.product.id,
						creditAmount:         scheduleItem.amount ?? 0,
						creditTypeId:         credit.access_schedule?.credit_type_id || "",
						hasMatchingAddCredit: true,
					});
				}

				const currentTierId = activeSub.custom_fields?.tier_id ?? targetSub?.custom_fields?.tier_id ?? newSubTierId;
				const nextTierId = targetSub?.custom_fields?.tier_id ?? newSubTierId ?? currentTierId;

				const applyCurrentMetadata = (credit: Credit) => {
					if (!credit.custom_fields) {
						credit.custom_fields = {};
					}
					if (currentTierId) {
						credit.custom_fields.tier_id = currentTierId;
					}
					if (activeSub.id) {
						credit.subscription_config = { subscription_id: activeSub.id };
					} else if (targetSubId) {
						credit.subscription_config = { subscription_id: targetSubId };
					}
				};

				const applyNextMetadata = (credit: Credit) => {
					if (!credit.custom_fields) {
						credit.custom_fields = {};
					}
					if (nextTierId) {
						credit.custom_fields.tier_id = nextTierId;
					}
					if (targetSubId) {
						credit.subscription_config = { subscription_id: targetSubId };
					}
				};

				for (const context of productContexts) {
					if (process.env.DEBUG_METRONOME === "true") {
						console.log(
							"[DEBUG bridging context]",
							JSON.stringify(
								{
									productId:            context.productId,
									creditAmount:         context.creditAmount,
									creditTypeId:         context.creditTypeId,
									hasMatchingAddCredit: context.hasMatchingAddCredit,
									matchingSubId:        matchingSub?.id,
									targetSubId,
								},
								null,
								2
							)
						);
					}

					if (!matchingSub || !isUncancelScenario) {
						continue;
					}

					const { productId, creditAmount, creditTypeId, hasMatchingAddCredit: contextHasAddCredit } = context;

					const normalizedBridgingStart = formatRFC3339(startOfHour(rcStart));
					const activeRecurring =
						(contract.recurring_credits || []).find(existing =>
							isActiveRecurring(existing, productId, normalizedBridgingStart, targetSubId ?? null)
						) ?? null;

					if (activeRecurring && contextHasAddCredit) {
						continue;
					}

					if (!activeRecurring) {
						const recurring: RecurringCredit = {
							id:      generateId("rc"),
							product: {
								id:   productId,
								name: `Product ${productId}`,
							},
							starting_at:         normalizedBridgingStart,
							subscription_config: targetSubId
								? {
										subscription_id: targetSubId,
									}
								: undefined,
						};
						contract.recurring_credits!.push(recurring);
						addedRecurringCredits.push(recurring);
					}

					if (process.env.DEBUG_METRONOME === "true") {
						console.log(
							"[DEBUG credit link]",
							JSON.stringify(
								{
									product:           productId,
									targetSubId,
									matchingSubId:     activeSub.id,
									matchingSubTierId: activeSub.custom_fields?.tier_id,
									targetSubTierId:   targetSub?.custom_fields?.tier_id,
									currentTierId,
									nextTierId,
									periodStart:       formatRFC3339(currentPeriodStart),
									periodEnd:         formatRFC3339(currentPeriodEnd),
								},
								null,
								2
							)
						);
					}

					const existingCredit = contract.credits?.find(c => {
						if (c.archived_at) return false;
						if (c.product.id !== productId) return false;
						const cSchedule = c.access_schedule?.schedule_items?.[0];
						if (!cSchedule) return false;
						const cStart = parseRFC3339(cSchedule.starting_at);
						const cEnd = parseRFC3339(cSchedule.ending_before);
						const sameSchedule =
							cStart.getTime() === currentPeriodStart.getTime() && cEnd.getTime() === currentPeriodEnd.getTime();
						if (!sameSchedule) return false;
						const sameSubscription = c.subscription_config?.subscription_id === activeSub.id;
						const sameTier = c.custom_fields?.tier_id === currentTierId;
						return sameSubscription || sameTier;
					});

					if (existingCredit) {
						applyCurrentMetadata(existingCredit);
					} else {
						const currentCredit: Credit = {
							id:      generateId("credit"),
							product: {
								id:   productId,
								name: `Product ${productId}`,
							},
							access_schedule: {
								credit_type_id: creditTypeId,
								schedule_items: [
									{
										starting_at:   formatRFC3339(currentPeriodStart),
										ending_before: formatRFC3339(currentPeriodEnd),
										amount:        creditAmount,
									},
								],
							},
							custom_fields:       {},
							subscription_config: undefined,
						};
						applyCurrentMetadata(currentCredit);
						if (!contract.credits) {
							contract.credits = [];
						}
						contract.credits.push(currentCredit);
					}

					const nextPeriodStart = startOfHour(startOfMonth(currentPeriodEnd));
					const nextPeriodEnd = startOfHour(startOfMonth(addMonths(nextPeriodStart, 1)));
					const existingNextCredit = contract.credits?.find(c => {
						if (c.archived_at) return false;
						if (c.product.id !== productId) return false;
						const cSchedule = c.access_schedule?.schedule_items?.[0];
						if (!cSchedule) return false;
						const cStart = parseRFC3339(cSchedule.starting_at);
						const cEnd = parseRFC3339(cSchedule.ending_before);
						const sameSchedule =
							cStart.getTime() === nextPeriodStart.getTime() && cEnd.getTime() === nextPeriodEnd.getTime();
						if (!sameSchedule) return false;
						const sameSubscription = c.subscription_config?.subscription_id === targetSubId;
						const sameTier = c.custom_fields?.tier_id === nextTierId;
						return sameSubscription || sameTier;
					});

					if (existingNextCredit) {
						applyNextMetadata(existingNextCredit);
					} else {
						const nextPeriodCredit: Credit = {
							id:      generateId("credit"),
							product: {
								id:   productId,
								name: `Product ${productId}`,
							},
							access_schedule: {
								credit_type_id: creditTypeId,
								schedule_items: [
									{
										starting_at:   formatRFC3339(nextPeriodStart),
										ending_before: formatRFC3339(nextPeriodEnd),
										amount:        creditAmount,
									},
								],
							},
							custom_fields:       {},
							subscription_config: undefined,
						};
						applyNextMetadata(nextPeriodCredit);
						if (!contract.credits) {
							contract.credits = [];
						}
						contract.credits.push(nextPeriodCredit);
					}
				}
			}
		}

		/// Add credits
		if (add_credits.length > 0) {
			if (!contract.credits) {
				contract.credits = [];
			}
			for (const creditData of add_credits) {
				/// Create one credit per schedule_item
				if (creditData.access_schedule?.schedule_items) {
					for (const scheduleItem of creditData.access_schedule.schedule_items) {
						const credit: Credit = {
							id:      generateId("credit"),
							product: {
								id:   creditData.product_id,
								name: `Product ${creditData.product_id}`,
							},
							access_schedule: {
								credit_type_id: creditData.access_schedule.credit_type_id,
								schedule_items: [scheduleItem],
							},
							custom_fields:       creditData.custom_fields || {},
							subscription_config: creditData.subscription_config
								? {
										subscription_id: creditData.subscription_config.subscription_id,
									}
								: undefined,
						};
						contract.credits.push(credit);

						/// If there's a corresponding recurring credit starting at the end of this credit's period,
						/// automatically create a credit for that next period (Metronome behavior)
						const endingBefore = parseRFC3339(scheduleItem.ending_before);
						/// Check ALL recurring credits (both newly added and existing) for a match
						const allRecurringCredits = [...addedRecurringCredits, ...(contract.recurring_credits || [])];
						const matchingRecurring = allRecurringCredits.find(rc => {
							const rcStart = startOfHour(parseRFC3339(rc.starting_at));
							const endingBeforeHour = startOfHour(endingBefore);
							/// Match on product_id and date
							/// subscription_id must match if both have it, but if credit doesn't have it, match anyway
							const productMatches = rc.product.id === creditData.product_id;
							const dateMatches = rcStart.getTime() === endingBeforeHour.getTime();
							const subscriptionMatches =
								!creditData.subscription_config?.subscription_id ||
								!rc.subscription_config?.subscription_id ||
								rc.subscription_config.subscription_id === creditData.subscription_config.subscription_id;
							return productMatches && dateMatches && subscriptionMatches;
						});

						if (matchingRecurring) {
							/// Create a credit for the next period (from ending_before to one month later)
							/// ending_before should be at start of month, so next period end is start of month after that
							const nextPeriodStart = startOfHour(startOfMonth(endingBefore));
							const nextPeriodEnd = startOfHour(startOfMonth(addMonths(nextPeriodStart, 1)));
							const nextCustomFields: Record<string, unknown> = { ...(creditData.custom_fields || {}) };
							let nextSubscriptionId = creditData.subscription_config?.subscription_id;

							if (matchingRecurring.subscription_config?.subscription_id) {
								nextSubscriptionId = matchingRecurring.subscription_config.subscription_id;
								const targetSub =
									contract.subscriptions?.find(sub => sub.id === nextSubscriptionId) ||
									add_subscriptions.find(
										(sub: (typeof add_subscriptions)[number]) => sub.temporary_id === nextSubscriptionId
									);
								if (targetSub?.custom_fields?.tier_id) {
									nextCustomFields.tier_id = targetSub.custom_fields.tier_id;
								}
							}
							const nextCredit: Credit = {
								id:      generateId("credit"),
								product: {
									id:   creditData.product_id,
									name: `Product ${creditData.product_id}`,
								},
								access_schedule: {
									credit_type_id: creditData.access_schedule.credit_type_id,
									schedule_items: [
										{
											starting_at:   formatRFC3339(nextPeriodStart),
											ending_before: formatRFC3339(nextPeriodEnd),
											amount:        scheduleItem.amount,
										},
									],
								},
								custom_fields:       nextCustomFields,
								subscription_config: nextSubscriptionId
									? {
											subscription_id: nextSubscriptionId,
										}
									: undefined,
							};
							contract.credits.push(nextCredit);
						}
					}
				} else {
					/// Fallback if no schedule_items
					const credit: Credit = {
						id:      generateId("credit"),
						product: {
							id:   creditData.product_id,
							name: `Product ${creditData.product_id}`,
						},
						access_schedule:     creditData.access_schedule,
						custom_fields:       creditData.custom_fields || {},
						subscription_config: creditData.subscription_config
							? {
									subscription_id: creditData.subscription_config.subscription_id,
								}
							: undefined,
					};
					contract.credits.push(credit);
				}
			}
		}

		/// Add overrides
		if (add_overrides.length > 0) {
			if (!contract.overrides) {
				contract.overrides = [];
			}
			for (const overrideData of add_overrides) {
				const override: ProductOverride = {
					id:          generateId("override"),
					product_id:  overrideData.product_id,
					starting_at: overrideData.starting_at,
					entitled:    overrideData.entitled,
				};
				contract.overrides.push(override);
			}
		}

		/// Update prepaid balance threshold configuration
		if (update_prepaid_balance_threshold_configuration) {
			if (!contract.prepaid_balance_threshold_configuration) {
				contract.prepaid_balance_threshold_configuration = {
					is_enabled:         false,
					threshold_amount:   0,
					recharge_to_amount: 0,
				};
			}
			Object.assign(contract.prepaid_balance_threshold_configuration, update_prepaid_balance_threshold_configuration);

			const requestedStatus = (update_prepaid_balance_threshold_configuration as { mock_payment_status?: string })
				.mock_payment_status;
			if (requestedStatus && contract.prepaid_balance_threshold_configuration.commit) {
				pendingPaymentGateStatus = requestedStatus === "failed" ? "failed" : "paid";
			}
		}

		/// Add prepaid balance threshold configuration
		if (add_prepaid_balance_threshold_configuration) {
			contract.prepaid_balance_threshold_configuration = {
				is_enabled:          add_prepaid_balance_threshold_configuration.is_enabled,
				threshold_amount:    add_prepaid_balance_threshold_configuration.threshold_amount,
				recharge_to_amount:  add_prepaid_balance_threshold_configuration.recharge_to_amount,
				payment_gate_config: add_prepaid_balance_threshold_configuration.payment_gate_config,
				commit:              add_prepaid_balance_threshold_configuration.commit,
			};

			if (add_prepaid_balance_threshold_configuration.commit) {
				const requestedStatus = (add_prepaid_balance_threshold_configuration as { mock_payment_status?: string })
					.mock_payment_status;
				pendingPaymentGateStatus = requestedStatus === "failed" ? "failed" : "paid";
			}
		}

		/// Store uniqueness key if provided
		if (uniqueness_key) {
			store.addUniquenessKey(uniqueness_key);
		}

		store.updateContractV2(contract_id, contract);

		if (pendingPaymentGateStatus) {
			const prepaidConfig = contract.prepaid_balance_threshold_configuration;
			const productId = prepaidConfig?.commit?.product_id;
			if (productId) {
				const targetAmount =
					pendingPaymentGateStatus === "failed"
						? Math.min(prepaidConfig.recharge_to_amount ?? 0, prepaidConfig.threshold_amount ?? 0)
						: (prepaidConfig.recharge_to_amount ?? prepaidConfig.threshold_amount ?? 0);
				setBalanceForProduct(contract.customer_id, productId, targetAmount);
			}

			void emitPaymentGateStatus({
				customerId:    contract.customer_id,
				contractId:    contract.id,
				paymentStatus: pendingPaymentGateStatus,
			});
		}

		void emitContractEvent(contract, "contract.updated");

		if (process.env.DEBUG_METRONOME === "true") {
			const summarizeCredits = (credits?: Credit[]) =>
				credits?.map(credit => {
					const schedule = credit.access_schedule?.schedule_items?.[0];
					return {
						product: credit.product.id,
						start:   schedule?.starting_at,
						end:     schedule?.ending_before,
						amount:  schedule?.amount,
						tierId:  credit.custom_fields?.tier_id,
						subId:   credit.subscription_config?.subscription_id,
					};
				});

			console.log(
				"[DEBUG contract]",
				JSON.stringify(
					{
						contractId:       contract.id,
						credits:          summarizeCredits(contract.credits),
						recurringCredits: contract.recurring_credits?.map(credit => ({
							product: credit.product.id,
							start:   credit.starting_at,
							end:     (credit as any).ending_before,
							subId:   credit.subscription_config?.subscription_id,
						})),
						subscriptions: contract.subscriptions?.map(sub => ({
							id:            sub.id,
							start:         sub.starting_at,
							end:           sub.ending_before,
							custom_fields: sub.custom_fields,
						})),
						addedRecurringCount: addedRecurringCredits.length,
					},
					null,
					2
				)
			);
		}

		res.json({
			data: {
				id: generateId("edit"),
			},
		});
	} catch (error) {
		res.status(500).json({
			error: {
				message: error instanceof Error ? error.message : "Internal server error",
				status:  500,
			},
		} satisfies ErrorResponse);
	}
};

/// Support multiple HTTP methods for contract edit
/// SDK calls /v2/contracts/edit with contract_id in body, not path
router.post("/edit", handleContractEdit);
router.put("/edit", handleContractEdit);
router.patch("/edit", handleContractEdit);
/// Also support path-based contract_id for compatibility
router.post("/:contract_id/edit", handleContractEdit);
router.put("/:contract_id/edit", handleContractEdit);
router.patch("/:contract_id/edit", handleContractEdit);

export default router;
