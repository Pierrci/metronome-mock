/// Utility functions for the mock Metronome server

import { nanoid } from "nanoid";

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
