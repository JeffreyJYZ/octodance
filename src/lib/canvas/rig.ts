import type { AudioFeatures } from "./audio";
import type { Point, Stroke } from "./strokes";

// An endpoint of one stroke this close to another's path counts as a contact.
const JOIN_EPS_PX = 14;

export type Mat = [number, number, number, number, number, number];

/**
 * A rigid group: one or more strokes that move together. Strokes that share
 * more than one contact (or that close a loop) can never articulate relative to
 * each other without tearing a contact apart, so they are merged into a group
 * and only groups articulate.
 */
export type RigGroup = {
	parent: number | null;
	pivot: Point; // normalized point the group rotates about
	swing: number; // radians at full drive
	freq: number;
	phase: number;
	dir: number;
	angle: number; // eased current angle (radians)
	strokes: number[];
};

export type Rig = {
	groups: RigGroup[];
	groupOf: number[]; // stroke index -> group index
	order: number[]; // group indices, parents before children
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

export function buildRig(
	strokes: Stroke[],
	width: number,
	height: number,
): Rig {
	const n = strokes.length;
	const eps2 = JOIN_EPS_PX * JOIN_EPS_PX;

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

	const dx2 = (a: Point, b: Point) => {
		const dx = (a.x - b.x) * width;
		const dy = (a.y - b.y) * height;
		return dx * dx + dy * dy;
	};

	// Find contacts, and how many there are per pair. For each contact we keep
	// the closest point **on each stroke**: a child pivots about its own point,
	// so that point never moves and the joint cannot open or protrude.
	const adjacency: { to: number; pivot: Point; loose: boolean }[][] =
		Array.from({ length: n }, () => []);
	const edgeList: {
		a: number;
		b: number;
		attachA: Point;
		attachB: Point;
		contacts: number;
	}[] = [];

	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const a = boxes[i];
			const b = boxes[j];
			if (a.maxX + JOIN_EPS_PX < b.minX || b.maxX + JOIN_EPS_PX < a.minX)
				continue;
			if (a.maxY + JOIN_EPS_PX < b.minY || b.maxY + JOIN_EPS_PX < a.minY)
				continue;

			let best = Number.POSITIVE_INFINITY;
			let attachA: Point | null = null;
			let attachB: Point | null = null;
			let contacts = 0;
			for (const [fromIndex, from, to] of [
				[0, strokes[i].points, strokes[j].points],
				[1, strokes[j].points, strokes[i].points],
			] as const) {
				for (const e of ends(from)) {
					let hit = false;
					for (const p of to) {
						const d = dx2(e, p);
						if (d < best) {
							best = d;
							if (fromIndex === 0) {
								attachA = e;
								attachB = p;
							} else {
								attachA = p;
								attachB = e;
							}
						}
						if (d <= eps2) hit = true;
					}
					if (hit) contacts++;
				}
			}
			if (attachA && attachB && best <= eps2) {
				edgeList.push({ a: i, b: j, attachA, attachB, contacts });
				// The pivot recorded for each side is that side's own point.
				adjacency[i].push({ to: j, pivot: attachA, loose: false });
				adjacency[j].push({ to: i, pivot: attachB, loose: false });
			}
		}
	}

	// A stroke with no joint of its own still has to ride the part it was drawn
	// on. Two rules, in order:
	//
	// 1. Containment. An eye or mouth is drawn *inside* the head, and distance
	//    alone picks the wrong target there: the nearest stroke to an eye is the
	//    other eye, so the pair becomes an island that never reaches the head.
	//    Attach it to the tightest stroke whose bounding box encloses it instead.
	// 2. Nearest anchor. Anything not enclosed attaches to the nearest stroke
	//    that already reaches the structure — never to another orphan.
	//
	// Both were measured on a real drawing: with rule 2 alone, both eyes still
	// reported parent=null and sat still while the head swung.
	const CONTAIN_PAD_PX = 12;
	const LOOSE_EPS_PX = 90;
	const boxArea = (b: {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}) => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
	const nearestPair = (i: number, j: number): [Point, Point] => {
		let best = Number.POSITIVE_INFINITY;
		let a: Point = strokes[i].points[0];
		let b: Point = strokes[j].points[0];
		for (const p of strokes[i].points) {
			for (const q of strokes[j].points) {
				const d = dx2(p, q);
				if (d < best) {
					best = d;
					a = p;
					b = q;
				}
			}
		}
		return [a, b];
	};
	const attachLoose = (i: number, j: number, a: Point, b: Point) => {
		adjacency[i].push({ to: j, pivot: a, loose: true });
		adjacency[j].push({ to: i, pivot: b, loose: true });
	};

	for (let i = 0; i < n; i++) {
		if (adjacency[i].length > 0) continue;
		const inner = boxes[i];
		let bestArea = Number.POSITIVE_INFINITY;
		let target = -1;
		for (let j = 0; j < n; j++) {
			if (j === i) continue;
			const outer = boxes[j];
			if (
				outer.minX - CONTAIN_PAD_PX > inner.minX ||
				outer.maxX + CONTAIN_PAD_PX < inner.maxX ||
				outer.minY - CONTAIN_PAD_PX > inner.minY ||
				outer.maxY + CONTAIN_PAD_PX < inner.maxY
			)
				continue;
			const size = boxArea(outer);
			if (size <= boxArea(inner) || size >= bestArea) continue;
			bestArea = size;
			target = j;
		}
		if (target >= 0) {
			const [a, b] = nearestPair(i, target);
			attachLoose(i, target, a, b);
		}
	}

	// "Anchored" means *reaches a real joint* — grow that through every edge, so
	// a head is not treated as attached merely because the eyes were drawn on it
	// (attaching the eyes gave the head an edge, which hid it from the bridge
	// below and left the head floating while the body moved).
	const anchored = new Array(n).fill(false);
	const grow: number[] = [];
	for (let i = 0; i < n; i++) {
		if (adjacency[i].some((edge) => !edge.loose)) {
			anchored[i] = true;
			grow.push(i);
		}
	}
	while (grow.length > 0) {
		const i = grow.pop() as number;
		for (const edge of adjacency[i]) {
			if (!anchored[edge.to]) {
				anchored[edge.to] = true;
				grow.push(edge.to);
			}
		}
	}

	// Bridge every island that still reaches no joint to its nearest anchored
	// neighbour, one bridge per island, nearest first.
	const comp = new Array(n).fill(-1);
	const comps: number[][] = [];
	for (let s = 0; s < n; s++) {
		if (comp[s] >= 0) continue;
		const id = comps.length;
		const members: number[] = [];
		comp[s] = id;
		members.push(s);
		for (let q = 0; q < members.length; q++) {
			for (const edge of adjacency[members[q]]) {
				if (comp[edge.to] < 0) {
					comp[edge.to] = id;
					members.push(edge.to);
				}
			}
		}
		comps.push(members);
	}
	const compAnchored = comps.map((members) =>
		members.some((i) => anchored[i]),
	);

	for (let guard = 0; guard < comps.length; guard++) {
		let best = LOOSE_EPS_PX * LOOSE_EPS_PX;
		let from = -1;
		let to = -1;
		let fromPoint: Point | null = null;
		let toPoint: Point | null = null;
		for (let c = 0; c < comps.length; c++) {
			if (compAnchored[c]) continue;
			for (const i of comps[c]) {
				for (let j = 0; j < n; j++) {
					if (comp[j] === c || !compAnchored[comp[j]]) continue;
					const a = boxes[i];
					const b = boxes[j];
					if (
						a.maxX + LOOSE_EPS_PX < b.minX ||
						b.maxX + LOOSE_EPS_PX < a.minX
					)
						continue;
					if (
						a.maxY + LOOSE_EPS_PX < b.minY ||
						b.maxY + LOOSE_EPS_PX < a.minY
					)
						continue;
					for (const p of strokes[i].points) {
						for (const q of strokes[j].points) {
							const d = dx2(p, q);
							if (d < best) {
								best = d;
								from = i;
								to = j;
								fromPoint = p;
								toPoint = q;
							}
						}
					}
				}
			}
		}
		if (from < 0 || to < 0 || !fromPoint || !toPoint) break;
		attachLoose(from, to, fromPoint, toPoint);
		compAnchored[comp[from]] = true;
	}

	// A pair touching at two or more places is rigid together.
	for (const edge of edgeList) {
		if (edge.contacts >= 2) union(edge.a, edge.b);
	}

	// Spanning forest: any edge that closes a loop also has to be rigid, or the
	// loop would tear open.
	const visited = new Array(n).fill(false);
	const parentNode = new Array(n).fill(-1);
	const treeEdges: {
		a: number;
		b: number;
		attachFrom: Point;
		attachTo: Point;
		loose: boolean;
	}[] = [];
	for (let s = 0; s < n; s++) {
		if (visited[s]) continue;
		visited[s] = true;
		const stack = [s];
		while (stack.length > 0) {
			const current = stack.pop() as number;
			for (const link of adjacency[current]) {
				if (!visited[link.to]) {
					visited[link.to] = true;
					parentNode[link.to] = current;
					const back = adjacency[link.to].find(
						(entry) => entry.to === current,
					);
					treeEdges.push({
						a: current,
						b: link.to,
						attachFrom: back ? back.pivot : link.pivot,
						attachTo: link.pivot,
						loose: link.loose,
					});
					stack.push(link.to);
				} else if (link.to !== parentNode[current]) {
					union(current, link.to);
				}
			}
		}
	}

	// Form groups from the union-find result.
	const groupIndexOf = new Map<number, number>();
	const groupOf = new Array(n).fill(-1);
	const memberLists: number[][] = [];
	for (let i = 0; i < n; i++) {
		const root = find(i);
		let index = groupIndexOf.get(root);
		if (index === undefined) {
			index = memberLists.length;
			groupIndexOf.set(root, index);
			memberLists.push([]);
		}
		groupOf[i] = index;
		memberLists[index].push(i);
	}
	const groupCount = memberLists.length;

	// Whole-figure center (ink bounding box).
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

	// Group-level tree (tree edges whose endpoints ended up in different groups).
	const groupAdj: { to: number; pivot: Point; loose: boolean }[][] =
		Array.from({ length: groupCount }, () => []);
	for (const edge of treeEdges) {
		const ga = groupOf[edge.a];
		const gb = groupOf[edge.b];
		if (ga === gb) continue;
		// Each entry's pivot is a point on the destination group, so whichever
		// side ends up as the child rotates about its own point.
		groupAdj[ga].push({ to: gb, pivot: edge.attachTo, loose: edge.loose });
		groupAdj[gb].push({
			to: ga,
			pivot: edge.attachFrom,
			loose: edge.loose,
		});
	}

	const groups: RigGroup[] = new Array(groupCount);
	const order: number[] = [];
	const seenGroup = new Array(groupCount).fill(false);

	const makeGroup = (
		index: number,
		parentGroup: number | null,
		pivot: Point,
		linked: boolean,
		loose: boolean,
	): RigGroup => {
		const members = memberLists[index];
		const allErase = members.every((m) => strokes[m].kind === "erase");

		// Deterministic, coherent parameters — no per-limb randomness, which is
		// what made the drawing jitter on six unrelated clocks. The phase comes
		// from the joint's position (a smooth wave across the figure), and the
		// direction is whichever way moves this limb's far end **away from the
		// figure centre**, so a beat splays every limb outward together.
		let far: Point | null = null;
		let farDistance = -1;
		for (const m of members) {
			for (const p of strokes[m].points) {
				const distance = (p.x - pivot.x) ** 2 + (p.y - pivot.y) ** 2;
				if (distance > farDistance) {
					farDistance = distance;
					far = p;
				}
			}
		}
		let dir = 1;
		if (far) {
			const vx = far.x - center.x;
			const vy = far.y - center.y;
			const px = far.x - pivot.x;
			const py = far.y - pivot.y;
			const cross = vx * -py + vy * px;
			if (cross !== 0) dir = Math.sign(cross);
		}
		const seed = pivot.x * 2.6 + pivot.y * 1.9;

		return {
			parent: parentGroup,
			pivot,
			// A loosely attached part swings 0: it rides its parent rigidly, so an
			// eye drawn inside the head moves exactly with the head.
			swing: loose ? 0 : linked ? (allErase ? 0 : 0.3) : 0.12,
			freq: 2.4,
			phase: seed * Math.PI,
			dir,
			angle: 0,
			strokes: members,
		};
	};

	for (let start = 0; start < groupCount; start++) {
		if (seenGroup[start]) continue;
		// Collect the component, then root it at the best-connected group.
		const component: number[] = [];
		const queue = [start];
		seenGroup[start] = true;
		while (queue.length > 0) {
			const current = queue.shift() as number;
			component.push(current);
			for (const link of groupAdj[current]) {
				if (!seenGroup[link.to]) {
					seenGroup[link.to] = true;
					queue.push(link.to);
				}
			}
		}
		let root = component[0];
		for (const c of component) {
			if (groupAdj[c].length > groupAdj[root].length) root = c;
		}
		const linked = groupAdj[root].length > 0;
		const rootMembers = memberLists[root];
		groups[root] = makeGroup(
			root,
			null,
			linked ? center : centroid(strokes[rootMembers[0]].points),
			linked,
			false,
		);
		order.push(root);

		const placed = new Set<number>([root]);
		const walk = [root];
		while (walk.length > 0) {
			const current = walk.shift() as number;
			for (const link of groupAdj[current]) {
				if (placed.has(link.to)) continue;
				placed.add(link.to);
				groups[link.to] = makeGroup(
					link.to,
					current,
					link.pivot,
					true,
					link.loose,
				);
				order.push(link.to);
				walk.push(link.to);
			}
		}
	}

	return {
		groups,
		groupOf,
		order,
		center,
		swayPhase: 0.9,
	};
}

/**
 * Per-group matrices for this frame. Each group rotates about the joint where
 * it meets its parent; roots add the small rigid motion of the whole figure.
 * `time` is seconds since playback started — everything eases in from the rest
 * pose so starting a track doesn't snap.
 */
export function rigMatrices(
	rig: Rig,
	features: AudioFeatures,
	time: number,
	intensity: number,
	width: number,
	height: number,
): Mat[] {
	const out: Mat[] = new Array(rig.groups.length);
	const cx = rig.center.x * width;
	const cy = rig.center.y * height;
	const ramp = Math.min(1, Math.max(0, time) * 3);

	// Spectrum bins sit low after the gamma curve (~0.2 typical), so normalise
	// them; raw `feature * amplitude` would be effectively nothing.
	const boost = (value: number) => Math.min(1.2, value * 4);
	const bass = boost(features.bass);
	const mid = boost(features.mid);
	const high = boost(features.high);
	const beat = features.beat * ramp;

	const tilt =
		(high * 0.06 + bass * 0.03) *
		intensity *
		ramp *
		Math.sin(time * 1.1 + rig.swayPhase);
	const gx =
		bass * 0.05 * intensity * Math.sin(time * 1.7 + rig.swayPhase) * ramp;
	const gy =
		(mid * 0.04 * intensity * Math.sin(time * 1.3 + rig.swayPhase * 1.7) +
			beat * 0.03 * intensity) *
		ramp;

	const global = mul(
		trans(cx + gx, cy + gy),
		mul(rot(tilt), trans(-cx, -cy)),
	);

	for (const index of rig.order) {
		const group = rig.groups[index];
		const px = group.pivot.x * width;
		const py = group.pivot.y * height;

		const idle =
			bass * 0.15 * Math.sin(time * group.freq + group.phase) +
			mid * 0.1 * Math.sin(time * group.freq * 0.8 + group.phase * 1.3);
		// The beat is the dominant term: one hit splays the limbs outward, then
		// it settles. Idle motion stays small so the music reads as the driver.
		const drive = idle + beat;
		// Clamp so a kick cannot flip a limb right over.
		const target = Math.max(
			-0.4,
			Math.min(0.4, group.swing * group.dir * intensity * drive * ramp),
		);
		// Ease toward the target instead of snapping to it. A beat used to
		// teleport every limb ~25 deg between two frames, which read as jitter.
		group.angle += (target - group.angle) * 0.35;
		const local = mul(
			trans(px, py),
			mul(rot(group.angle), trans(-px, -py)),
		);

		out[index] =
			group.parent === null
				? mul(global, local)
				: mul(out[group.parent], local);
	}

	return out;
}
