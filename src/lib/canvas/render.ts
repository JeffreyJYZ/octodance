import { type AudioFeatures, isStill } from "./audio";
import { buildRig, type Mat, type Rig, rigMatrices } from "./rig";
import type { Point, Stroke } from "./strokes";

// Path2D cache: strokes are static geometry, so a stroke's path is built once
// and reused. The key includes the canvas size and the stroke's point count
// (the in-progress stroke grows while drawing).
const pathCache = new WeakMap<Stroke, { key: string; path: Path2D }>();

// The articulation tree only depends on the strokes and the canvas size.
const rigCache = new WeakMap<Stroke[], { key: string; rig: Rig }>();

export function renderScene(
	ctx: CanvasRenderingContext2D,
	strokes: Stroke[],
	features: AudioFeatures,
	time: number,
	width: number,
	height: number,
	intensity: number,
) {
	ctx.clearRect(0, 0, width, height);
	ctx.globalCompositeOperation = "source-over";
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	// Still = editing (or intensity 0): identity transforms, plain cached paths.
	const still = isStill(features) || intensity === 0;
	let matrices: Mat[] | null = null;
	if (!still && strokes.length > 0) {
		const key = `${Math.round(width)}x${Math.round(height)}:${strokes.length}`;
		const cached = rigCache.get(strokes);
		const entry =
			cached && cached.key === key
				? cached
				: { key, rig: buildRig(strokes, width, height) };
		if (entry !== cached) rigCache.set(strokes, entry);
		const groupMats = rigMatrices(
			entry.rig,
			features,
			time,
			intensity,
			width,
			height,
		);
		matrices = strokes.map(
			(_, index) => groupMats[entry.rig.groupOf[index]],
		);
	}

	strokes.forEach((stroke, index) => {
		if (stroke.kind !== "ink") return;
		ctx.save();
		if (matrices) ctx.transform(...matrices[index]);
		ctx.strokeStyle = stroke.color;
		strokeGeometry(ctx, stroke, width, height);
		ctx.restore();
	});

	// Erase strokes cut holes; they ride the rig too, so a hole follows the ink
	// it was cut from.
	ctx.save();
	ctx.globalCompositeOperation = "destination-out";
	strokes.forEach((stroke, index) => {
		if (stroke.kind !== "erase") return;
		ctx.save();
		if (matrices) ctx.transform(...matrices[index]);
		strokeGeometry(ctx, stroke, width, height);
		ctx.restore();
	});
	ctx.restore();
}

function strokeGeometry(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	width: number,
	height: number,
) {
	const lineWidth = stroke.width * Math.min(width, height);
	ctx.lineWidth = lineWidth;

	if (stroke.points.length === 1) {
		drawDot(ctx, stroke.points[0], lineWidth, width, height);
		return;
	}
	ctx.stroke(getCachedPath(stroke, width, height));
}

function getCachedPath(stroke: Stroke, width: number, height: number): Path2D {
	const key = `${Math.round(width)}x${Math.round(height)}:${stroke.points.length}`;
	const cached = pathCache.get(stroke);
	if (cached && cached.key === key) return cached.path;

	const path = new Path2D();
	stroke.points.forEach((point, index) => {
		const x = point.x * width;
		const y = point.y * height;
		if (index === 0) path.moveTo(x, y);
		else path.lineTo(x, y);
	});
	pathCache.set(stroke, { key, path });
	return path;
}

function drawDot(
	ctx: CanvasRenderingContext2D,
	point: Point,
	lineWidth: number,
	width: number,
	height: number,
) {
	ctx.beginPath();
	ctx.arc(point.x * width, point.y * height, lineWidth / 2, 0, Math.PI * 2);
	ctx.fillStyle = ctx.strokeStyle as string;
	ctx.fill();
}
