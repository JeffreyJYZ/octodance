import { createId, type Point, type Stroke } from "./strokes";

// The drawing lives in refs (no per-frame React state), so it is gone the moment
// the tab reloads. Mirror it into localStorage; a drawing is the user's work, so
// a reload must never drop it.
const DRAWING_KEY = "octodance:drawing:v1";
const PALETTE_KEY = "octodance:palette:v1";
const VERSION = 1;
// Points are normalized 0..1, so 4 decimals is well under a pixel on a 600 px
// canvas and keeps the stored JSON small.
const COORD_DECIMALS = 4;
const MAX_POINTS_PER_STROKE = 20000;
const MAX_PALETTE = 64;
const MAX_COLOR_LENGTH = 32;

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isColor = (value: unknown): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= MAX_COLOR_LENGTH;

const round = (value: number) => {
	const factor = 10 ** COORD_DECIMALS;
	return Math.round(value * factor) / factor;
};

function encode(strokes: Stroke[]) {
	return strokes.map((stroke) => {
		// Flattened [x, y, x, y, …] halves the size of `{x, y}` objects.
		const points: number[] = [];
		for (const point of stroke.points) {
			points.push(round(point.x), round(point.y));
		}
		return stroke.kind === "ink"
			? { k: "i", c: stroke.color, w: stroke.width, p: points }
			: { k: "e", w: stroke.width, p: points };
	});
}

function decodeStroke(raw: unknown): Stroke | null {
	if (typeof raw !== "object" || raw === null) return null;
	const entry = raw as { k?: unknown; c?: unknown; w?: unknown; p?: unknown };
	if (!isFiniteNumber(entry.w) || entry.w <= 0) return null;
	if (!Array.isArray(entry.p)) return null;
	if (entry.p.length < 2 || entry.p.length % 2 !== 0) return null;
	if (entry.p.length > MAX_POINTS_PER_STROKE * 2) return null;

	const points: Point[] = [];
	for (let i = 0; i < entry.p.length; i += 2) {
		const x = entry.p[i];
		const y = entry.p[i + 1];
		if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
		points.push({ x, y });
	}

	if (entry.k === "e") {
		return { id: createId(), kind: "erase", width: entry.w, points };
	}
	if (entry.k === "i" && isColor(entry.c)) {
		return {
			id: createId(),
			kind: "ink",
			color: entry.c,
			width: entry.w,
			points,
		};
	}
	return null;
}

export function loadDrawing(): Stroke[] {
	try {
		const raw = window.localStorage.getItem(DRAWING_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return [];
		const payload = parsed as { v?: unknown; strokes?: unknown };
		if (payload.v !== VERSION || !Array.isArray(payload.strokes)) return [];
		const strokes: Stroke[] = [];
		for (const entry of payload.strokes) {
			const stroke = decodeStroke(entry);
			if (stroke) strokes.push(stroke);
		}
		return strokes;
	} catch {
		return [];
	}
}

export function saveDrawing(strokes: Stroke[]): void {
	try {
		// A cleared drawing must stay cleared, so remove the key rather than
		// storing an empty array.
		if (strokes.length === 0) {
			window.localStorage.removeItem(DRAWING_KEY);
			return;
		}
		window.localStorage.setItem(
			DRAWING_KEY,
			JSON.stringify({ v: VERSION, strokes: encode(strokes) }),
		);
	} catch {
		// Storage can be unavailable (private mode) or full. Persistence is a
		// convenience, never a reason to break drawing.
	}
}

export function loadPalette(): string[] | null {
	try {
		const raw = window.localStorage.getItem(PALETTE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const palette = parsed.filter(isColor).slice(0, MAX_PALETTE);
		return palette.length > 0 ? palette : null;
	} catch {
		return null;
	}
}

export function savePalette(palette: string[]): void {
	try {
		window.localStorage.setItem(
			PALETTE_KEY,
			JSON.stringify(palette.filter(isColor).slice(0, MAX_PALETTE)),
		);
	} catch {
		// see saveDrawing
	}
}
