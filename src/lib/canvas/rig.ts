import type { AudioFeatures } from "./audio";
import type { Point, Stroke } from "./strokes";

// Two strokes are considered joined when an endpoint of one comes within this
// many pixels of the other's path.
const JOIN_EPS_PX = 14;

export type Mat = [number, number, number, number, number, number];

export type RigNode = {
	stroke: Stroke;
	parent: number | null;
	pivot: Point; // normalized point the stroke rotates about
	swing: number; // radians at full drive
	freq: number;
	phase: number;
	dir: number;
};

export type Rig = {
	nodes: RigNode[]; // indexed like the strokes array
	order: number[]; // parents before children
	center: Point; // normalized
	swayPhase: number;
};

// Canvas matrix helpers: [a b c d e f], applying n first then m.
function mul(m: Mat, n: Mat): Mat {
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5],
	];
}

function rot(angle: number): Mat {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [c, s, -s, c, 0, 0];
}

function trans(x: number, y: number): Mat {
	return [1, 0, 0, 1, x, y];
}

function centroid(points: Point[]): Point {
	let x = 0;
	let y = 0;
	for (const p of points) {
		x += p.x;
		y += p.y;
	}
	const n = Math.max(1, points.length);
	return { x: x / n, y: y / n };
}

function ends(points: Point[]): Point[] {
	if (points.length === 1) return [points[0]];
	return [points[0], points[points.length - 1]];
}

/**
 * Build the articulation tree: strokes become bones that rotate about the
 * joint where they meet a neighbour. Because a joint sits at a fixed point and
 * children inherit the parent's transform, rotation about it can never open a
 * gap, and lengths are preserved (no squashing).
 */
export function buildRig(
	strokes: Stroke[],
	width: number,
	height: number,
): Rig {
	const n = strokes.length;
	const eps2 = JOIN_EPS_PX * JOIN_EPS_PX;

	// Bounding boxes (px) for cheap pair rejection.
	const boxes = strokes.map((stroke) => {
		let minX = 1;
		let minY = 1;
		let maxX = 0;
		let maxY = 0;
		for (const p of stroke.points) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
		return {
			minX: minX * width,
			minY: minY * height,
			maxX: maxX * width,
			maxY: maxY * height,
		};
	});

	const parent = Array.from({ length: n }, (_, i) => i);
	const find = (a: number): number => {
		let root = a;
		while (parent[root] !== root) root = parent[root];
		while (parent[a] !== root) {
			const next = parent[a];
			parent[a] = root;
			a = next;
		}
		return root;
	};
	const union = (a: number, b: number) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[ra] = rb;
	};

	type Edge = { i: number; j: number; pivot: Point };
	const edges: Edge[] = [];
	const dx2 = (a: Point, b: Point) => {
		const dx = (a.x - b.x) * width;
		const dy = (a.y - b.y) * height;
		return dx * dx + dy * dy;
	};

	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const a = boxes[i];
			const b = boxes[j];
			if (a.maxX + JOIN_EPS_PX < b.minX || b.maxX + JOIN_EPS_PX < a.minX)
				continue;
			if (a.maxY + JOIN_EPS_PX < b.minY || b.maxY + JOIN_EPS_PX < a.minY)
				continue;

			let best = Number.POSITIVE_INFINITY;
			let bestPivot: Point | null = null;
			for (const [from, to] of [
				[strokes[i].points, strokes[j].points],
				[strokes[j].points, strokes[i].points],
			] as const) {
				for (const e of ends(from)) {
					for (const p of to) {
						const d = dx2(e, p);
						if (d < best) {
							best = d;
							bestPivot = {
								x: (e.x + p.x) / 2,
								y: (e.y + p.y) / 2,
							};
						}
					}
				}
			}
			if (bestPivot && best <= eps2) {
				edges.push({ i, j, pivot: bestPivot });
				union(i, j);
			}
		}
	}

	// Overall center of the ink, used as the pivot for the whole figure.
	let minX = 1;
	let minY = 1;
	let maxX = 0;
	let maxY = 0;
	for (const stroke of strokes) {
		if (stroke.kind !== "ink") continue;
		for (const p of stroke.points) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
	}
	const center: Point =
		maxX > minX || maxY > minY
			? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
			: { x: 0.5, y: 0.5 };

	const adj: { to: number; pivot: Point }[][] = Array.from(
		{ length: n },
		() => [],
	);
	for (const edge of edges) {
		adj[edge.i].push({ to: edge.j, pivot: edge.pivot });
		adj[edge.j].push({ to: edge.i, pivot: edge.pivot });
	}

	const params = (index: number, linked: boolean) => {
		const stroke = strokes[index];
		const erase = stroke.kind === "erase";
		return {
			stroke,
			swing: erase
				? 0
				: linked
					? 0.35 + Math.random() * 0.45
					: 0.15 + Math.random() * 0.15,
			freq: 2.2 + Math.random() * 3.0,
			phase: Math.random() * Math.PI * 2,
			dir: Math.random() < 0.5 ? -1 : 1,
		};
	};

	const nodes: RigNode[] = new Array(n);
	const order: number[] = [];

	const groups = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const root = find(i);
		const bucket = groups.get(root);
		if (bucket) bucket.push(i);
		else groups.set(root, [i]);
	}

	for (const members of groups.values()) {
		let root = members[0];
		for (const m of members) if (adj[m].length > adj[root].length) root = m;
		const pivot =
			adj[root].length === 0 ? centroid(strokes[root].points) : center;
		nodes[root] = {
			...params(root, adj[root].length > 0),
			parent: null,
			pivot,
		};
		order.push(root);

		const seen = new Set<number>([root]);
		const queue = [root];
		while (queue.length > 0) {
			const current = queue.shift() as number;
			for (const link of adj[current]) {
				if (seen.has(link.to)) continue;
				seen.add(link.to);
				nodes[link.to] = {
					...params(link.to, true),
					parent: current,
					pivot: link.pivot,
				};
				order.push(link.to);
				queue.push(link.to);
			}
		}
	}

	return { nodes, order, center, swayPhase: Math.random() * Math.PI * 2 };
}

/**
 * Per-stroke matrices for this frame. Each bone rotates about its joint; the
 * root bones additionally get a small rigid motion of the whole figure (sway,
 * bob, slight tilt) about the figure center.
 */
export function rigMatrices(
	rig: Rig,
	features: AudioFeatures,
	time: number,
	intensity: number,
	width: number,
	height: number,
): Mat[] {
	const out: Mat[] = new Array(rig.nodes.length);
	const cx = rig.center.x * width;
	const cy = rig.center.y * height;

	// Spectrum bins sit low after the gamma curve (~0.2 typical), so normalise
	// them; raw `feature * amplitude` would be effectively nothing.
	const boost = (value: number) => Math.min(1.2, value * 4);
	const bass = boost(features.bass);
	const mid = boost(features.mid);
	const high = boost(features.high);
	const beat = features.beat;

	const tilt =
		(high * 0.06 + bass * 0.03) *
		intensity *
		Math.sin(time * 1.1 + rig.swayPhase);
	const gx = bass * 0.05 * intensity * Math.sin(time * 1.7 + rig.swayPhase);
	const gy =
		mid * 0.04 * intensity * Math.sin(time * 1.3 + rig.swayPhase * 1.7) +
		beat * 0.03 * intensity;

	const global = mul(
		trans(cx + gx, cy + gy),
		mul(rot(tilt), trans(-cx, -cy)),
	);

	for (const index of rig.order) {
		const node = rig.nodes[index];
		const px = node.pivot.x * width;
		const py = node.pivot.y * height;

		const drive =
			bass * 0.3 * Math.sin(time * node.freq + node.phase) +
			mid * 0.2 * Math.sin(time * node.freq * 0.8 + node.phase * 1.3) +
			beat * 2.5;
		// Clamp so a kick cannot flip a limb right over.
		const angle = Math.max(
			-0.7,
			Math.min(0.7, node.swing * node.dir * intensity * drive),
		);
		const local = mul(trans(px, py), mul(rot(angle), trans(-px, -py)));

		out[index] =
			node.parent === null
				? mul(global, local)
				: mul(out[node.parent], local);
	}

	return out;
}
