export type Point = { x: number; y: number };

export type InkStroke = {
	id: string;
	kind: "ink";
	color: string;
	width: number; // fraction of min(canvasW, canvasH)
	points: Point[]; // normalized 0..1
};

export type EraseStroke = {
	id: string;
	kind: "erase";
	width: number;
	points: Point[];
};

export type Stroke = InkStroke | EraseStroke;

export function createId(): string {
	return crypto.randomUUID();
}
