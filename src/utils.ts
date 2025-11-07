/// Utility functions for the mock Metronome server

import { nanoid } from "nanoid";
import type { Invoice, ContractV2, Subscription } from "./types.js";

export function generateId(prefix = ""): string {
	return prefix ? `${prefix}_${nanoid()}` : nanoid();
}

export function formatRFC3339(date: Date): string {
	return date.toISOString();
}

export function parseRFC3339(dateString: string): Date {
	return new Date(dateString);
}

export function startOfHour(date: Date): Date {
	/// Use UTC to avoid timezone issues
	const d = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), 0, 0, 0)
	);
	return d;
}

export function startOfMonth(date: Date): Date {
	/// Use UTC to avoid timezone issues
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
	return d;
}

export function addMonths(date: Date, months: number): Date {
	/// Use UTC to avoid timezone issues
	const d = new Date(date);
	const newMonth = d.getUTCMonth() + months;
	const newYear = d.getUTCFullYear() + Math.floor(newMonth / 12);
	const finalMonth = ((newMonth % 12) + 12) % 12;
	return new Date(
		Date.UTC(
			newYear,
			finalMonth,
			d.getUTCDate(),
			d.getUTCHours(),
			d.getUTCMinutes(),
			d.getUTCSeconds(),
			d.getUTCMilliseconds()
		)
	);
}

export function endOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function calculateInvoiceTotal(invoice: Invoice): number {
	return invoice.line_items.reduce((sum, item) => sum + item.amount, 0);
}

export function findSubscriptionByProductId(contract: ContractV2, productId: string): Subscription | undefined {
	return contract.subscriptions?.find(sub => sub.subscription_rate.product.id === productId);
}

export function isDateInRange(date: Date, start: Date, end?: Date): boolean {
	if (end) {
		return date >= start && date < end;
	}
	return date >= start;
}

export function createBillingPeriod(
	startDate: Date,
	frequency: "MONTHLY" | "ANNUAL"
): { starting_at: string; ending_before: string } {
	const start = startOfMonth(startDate);
	const end = frequency === "MONTHLY" ? addMonths(start, 1) : addMonths(start, 12);
	return {
		starting_at:   formatRFC3339(start),
		ending_before: formatRFC3339(end),
	};
}

export function isEqualDate(date1: Date, date2: Date): boolean {
	return (
		date1.getFullYear() === date2.getFullYear() &&
		date1.getMonth() === date2.getMonth() &&
		date1.getDate() === date2.getDate()
	);
}
