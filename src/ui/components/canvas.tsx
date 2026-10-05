"use client";

import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { HexColorPicker } from "react-colorful";
import { SILENT, useAudio } from "@/lib/canvas/audio";
import {
	loadDrawing,
	loadPalette,
	saveDrawing,
	savePalette,
} from "@/lib/canvas/persist";
import { renderScene } from "@/lib/canvas/render";
import { createId, type Point, type Stroke } from "@/lib/canvas/strokes";

const DEFAULT_PALETTE = [
	"#000000",
	"#ffffff",
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#06b6d4",
	"#3b82f6",
	"#6366f1",
	"#8b5cf6",
	"#ec4899",
	"#64748b",
];

const MAX_HISTORY = 30;

// Bundled CC0 loops, served from /public/music (provenance in CREDITS.md).
// Beat-heavy on purpose so the audio reactivity reads clearly.
const DEMO_TRACKS = [
	{
		label: "Chiptune 1",
		name: "Chiptune 1 · Juhani Junkala",
		src: "/music/chiptune-1.mp3",
	},
	{
		label: "Chiptune 2",
		name: "Chiptune 2 · Juhani Junkala",
		src: "/music/chiptune-2.mp3",
	},
	{
		label: "Chiptune 3",
		name: "Chiptune 3 · Juhani Junkala",
		src: "/music/chiptune-3.mp3",
	},
] as const;

type Tool = "draw" | "erase";

function getContext(canvas: HTMLCanvasElement | null) {
	return canvas ? canvas.getContext("2d") : null;
}

export function Canvas({ className = "" }: { className?: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const drawingRef = useRef(false);
	const lastRef = useRef<Point | null>(null);
	const currentRef = useRef<Stroke | null>(null);
	const strokesRef = useRef<Stroke[]>([]);
	const historyRef = useRef<Stroke[][]>([]);
	const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
	const intensityRef = useRef(0.7);

	const [, forceRender] = useState(0);
	const bump = useCallback(() => forceRender((n) => n + 1), []);

	const [color, setColor] = useState(DEFAULT_PALETTE[0]);
	const [thickness, setThickness] = useState(8);
	const [palette, setPalette] = useState<string[]>(DEFAULT_PALETTE);
	const [tool, setTool] = useState<Tool>("draw");
	const [intensity, setIntensity] = useState(0.7);

	const audio = useAudio();
	const sampleRef = useRef(audio.sample);
	sampleRef.current = audio.sample;
	const { isPlaying } = audio;

	// Redraw the whole scene from the stroke model. `time`/`features` drive the
	// animation; the silent defaults render the static editing view.
	const render = useCallback((features = SILENT, time = 0) => {
		const canvas = canvasRef.current;
		const ctx = getContext(canvas);
		if (!canvas || !ctx) return;
		const { w, h, dpr } = sizeRef.current;
		// Include the in-progress stroke so the live view is exactly what the
		// committed model renders — releasing a stroke never changes it.
		const strokes = currentRef.current
			? [...strokesRef.current, currentRef.current]
			: strokesRef.current;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		renderScene(ctx, strokes, features, time, w, h, intensityRef.current);
	}, []);

	useEffect(() => {
		intensityRef.current = intensity;
	}, [intensity]);

	// DPR-aware sizing. Unlike the old pixel-copy version, resize just redraws
	// from the model, so history survives.
	useEffect(() => {
		const canvas = canvasRef.current;
		const parent = canvas?.parentElement;
		if (!canvas || !parent) return;

		const resize = () => {
			const dpr = window.devicePixelRatio || 1;
			const w = Math.max(1, parent.clientWidth);
			const h = Math.max(1, parent.clientHeight);
			sizeRef.current = { w, h, dpr };
			canvas.width = Math.floor(w * dpr);
			canvas.height = Math.floor(h * dpr);
			render();
		};

		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(parent);
		return () => observer.disconnect();
	}, [render]);

	// Restore the saved drawing. On a fast refresh the in-memory strokes can be
	// newer than storage, so keep them and write them back instead of clobbering.
	useEffect(() => {
		const stored = loadDrawing();
		if (strokesRef.current.length > 0) {
			saveDrawing(strokesRef.current);
		} else if (stored.length > 0) {
			strokesRef.current = stored;
			historyRef.current = [];
			render();
			bump();
		}
		const storedPalette = loadPalette();
		if (storedPalette) setPalette(storedPalette);
	}, [render, bump]);

	// Flush on the way out so a reload never drops the drawing.
	useEffect(() => {
		const flush = () => saveDrawing(strokesRef.current);
		window.addEventListener("beforeunload", flush);
		window.addEventListener("pagehide", flush);
		return () => {
			window.removeEventListener("beforeunload", flush);
			window.removeEventListener("pagehide", flush);
		};
	}, []);

	// Animation loop: only runs during playback. Everything lives in refs, so
	// nothing triggers a React render per frame.
	useEffect(() => {
		if (!isPlaying) {
			render();
			return;
		}
		let raf = 0;
		// `time` is seconds since playback began, so the rig can ease in from
		// the rest pose instead of snapping to an arbitrary phase.
		const startedAt = performance.now();
		const loop = (time: number) => {
			render(sampleRef.current(), (time - startedAt) / 1000);
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [isPlaying, render]);

	const commit = (stroke: Stroke) => {
		historyRef.current.push(strokesRef.current);
		if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
		strokesRef.current = [...strokesRef.current, stroke];
		saveDrawing(strokesRef.current);
		bump();
	};

	const normalizedFromEvent = (
		event: ReactPointerEvent<HTMLCanvasElement>,
	): Point => {
		const rect = event.currentTarget.getBoundingClientRect();
		return {
			x: (event.clientX - rect.left) / rect.width,
			y: (event.clientY - rect.top) / rect.height,
		};
	};

	const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (isPlaying) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		drawingRef.current = true;

		const point = normalizedFromEvent(event);
		lastRef.current = point;

		const minDim = Math.min(sizeRef.current.w, sizeRef.current.h) || 1;
		const width = thickness / minDim;
		currentRef.current =
			tool === "erase"
				? { id: createId(), kind: "erase", width, points: [point] }
				: {
						id: createId(),
						kind: "ink",
						color,
						width,
						points: [point],
					};
		render();
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const stroke = currentRef.current;
		if (!drawingRef.current || !stroke) return;

		const point = normalizedFromEvent(event);
		const last = lastRef.current;
		if (last) {
			const dx = point.x - last.x;
			const dy = point.y - last.y;
			// Drop sub-pixel moves: fewer points, fewer redraws.
			if (dx * dx + dy * dy < 0.0000016) return;
		}
		stroke.points.push(point);
		lastRef.current = point;
		render();
	};

	const stopDrawing = () => {
		if (!drawingRef.current) return;
		drawingRef.current = false;
		lastRef.current = null;
		const stroke = currentRef.current;
		currentRef.current = null;
		if (stroke) {
			commit(stroke);
			render();
		}
	};

	const undo = useCallback(() => {
		const previous = historyRef.current.pop();
		if (!previous) return;
		strokesRef.current = previous;
		saveDrawing(strokesRef.current);
		render();
		bump();
	}, [render, bump]);

	const clear = useCallback(() => {
		if (strokesRef.current.length === 0) return;
		historyRef.current.push(strokesRef.current);
		if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
		strokesRef.current = [];
		saveDrawing(strokesRef.current);
		render();
		bump();
	}, [render, bump]);

	const addColor = () => {
		if (palette.includes(color)) return;
		const next = [...palette, color];
		setPalette(next);
		savePalette(next);
	};

	const removeColor = (target: string) => {
		const next = palette.filter((entry) => entry !== target);
		setPalette(next);
		savePalette(next);
	};

	const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (file) void audio.load(file);
	};

	// Load a bundled demo and start it in one gesture (also unlocks audio).
	const playDemo = async (src: string, name: string) => {
		if (isPlaying) audio.pause();
		await audio.loadUrl(src, name);
		await audio.play();
	};

	const canUndo = historyRef.current.length > 0;
	const hasStrokes = strokesRef.current.length > 0;

	const toggleClass = (active: boolean) =>
		`rounded-md border px-2 py-1 text-sm whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 ${
			active
				? "border-black/20 bg-neutral-900 text-white"
				: "border-black/10 hover:bg-neutral-100 disabled:hover:bg-transparent"
		}`;

	const actionClass =
		"rounded-md border border-black/10 px-2 py-1 text-sm whitespace-nowrap hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

	return (
		<div
			className={`grid gap-6 md:grid-cols-[minmax(0,1fr)_320px] ${className}`}
		>
			<div className="relative min-h-[420px] w-full overflow-hidden rounded-xl border border-black/10 bg-white">
				<canvas
					ref={canvasRef}
					aria-label="Drawing canvas"
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={stopDrawing}
					onPointerCancel={stopDrawing}
					onPointerLeave={stopDrawing}
					className={`absolute inset-0 touch-none ${
						isPlaying
							? "cursor-default"
							: tool === "erase"
								? "cursor-cell"
								: "cursor-crosshair"
					}`}
				/>
			</div>

			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<span className="text-sm text-neutral-600">Music</span>
					<div className="grid grid-cols-3 gap-2">
						{DEMO_TRACKS.map((track) => (
							<button
								key={track.src}
								type="button"
								onClick={() =>
									void playDemo(track.src, track.name)
								}
								aria-pressed={audio.trackName === track.name}
								className={toggleClass(
									audio.trackName === track.name,
								)}
							>
								{track.label}
							</button>
						))}
					</div>
					<div className="flex items-center gap-2">
						<label className="flex-1 cursor-pointer truncate rounded-md border border-black/10 px-2 py-1 text-center text-sm hover:bg-neutral-100">
							<input
								type="file"
								accept="audio/*"
								className="hidden"
								onChange={onFile}
							/>
							{audio.hasTrack ? "Replace track" : "Choose file"}
						</label>
						<button
							type="button"
							onClick={() =>
								audio.isPlaying
									? audio.pause()
									: void audio.play()
							}
							disabled={!audio.hasTrack}
							className={`${actionClass} min-w-16`}
						>
							{audio.isPlaying ? "Pause" : "Play"}
						</button>
					</div>
					{audio.trackName && (
						<span className="truncate text-xs text-neutral-500">
							{audio.trackName}
						</span>
					)}
					{audio.error && (
						<span className="text-xs text-red-500">
							{audio.error}
						</span>
					)}
					<label className="flex items-center gap-2 text-sm">
						<span className="text-neutral-600">Intensity</span>
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={intensity}
							onChange={(event) =>
								setIntensity(Number(event.target.value))
							}
							className="min-w-0 flex-1"
						/>
					</label>
				</div>

				<div className="flex flex-col gap-2">
					<span className="text-sm text-neutral-600">Color</span>
					<HexColorPicker
						color={color}
						onChange={setColor}
						style={{ width: "100%" }}
					/>
					<div className="flex items-center gap-2">
						<span
							className="size-7 rounded-full border border-black/10"
							style={{ backgroundColor: color }}
						/>
						<span className="font-mono text-sm text-neutral-600">
							{color.toUpperCase()}
						</span>
						<button
							type="button"
							onClick={addColor}
							disabled={palette.includes(color)}
							className={`${actionClass} ml-auto`}
						>
							Add
						</button>
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<span className="text-sm text-neutral-600">Palette</span>
					<div className="flex flex-wrap gap-2">
						{palette.map((entry) => (
							<div key={entry} className="relative">
								<button
									type="button"
									aria-label={`Use ${entry}`}
									aria-pressed={color === entry}
									onClick={() => setColor(entry)}
									className={`size-7 rounded-full border border-black/10 outline-offset-2 ${
										color === entry
											? "outline-2 outline-blue-500"
											: ""
									}`}
									style={{ backgroundColor: entry }}
								/>
								{!DEFAULT_PALETTE.includes(entry) && (
									<button
										type="button"
										aria-label={`Remove ${entry}`}
										onClick={() => removeColor(entry)}
										className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border border-black/10 bg-white text-[10px] leading-none text-neutral-600 hover:bg-neutral-100"
									>
										×
									</button>
								)}
							</div>
						))}
					</div>
				</div>

				<label className="flex flex-col gap-2">
					<span className="text-sm text-neutral-600">
						Thickness
						<span className="ml-2 tabular-nums text-neutral-400">
							{thickness}
						</span>
					</span>
					<div className="flex items-center gap-3">
						<input
							type="range"
							min={1}
							max={64}
							value={thickness}
							onChange={(event) =>
								setThickness(Number(event.target.value))
							}
							className="min-w-0 flex-1"
						/>
						<div
							className="grid size-16 shrink-0 place-items-center rounded-md border border-black/10 bg-white"
							aria-hidden="true"
						>
							<span
								className="rounded-full"
								style={{
									width: thickness,
									height: thickness,
									backgroundColor: color,
								}}
							/>
						</div>
					</div>
				</label>

				<div className="grid grid-cols-4 gap-2">
					<button
						type="button"
						onClick={() => setTool("draw")}
						aria-pressed={tool === "draw"}
						disabled={isPlaying}
						className={toggleClass(tool === "draw")}
					>
						Draw
					</button>
					<button
						type="button"
						onClick={() => setTool("erase")}
						aria-pressed={tool === "erase"}
						disabled={isPlaying}
						className={toggleClass(tool === "erase")}
					>
						Eraser
					</button>
					<button
						type="button"
						onClick={undo}
						disabled={!canUndo}
						className={actionClass}
					>
						Undo
					</button>
					<button
						type="button"
						onClick={clear}
						disabled={!hasStrokes}
						className={actionClass}
					>
						Clear
					</button>
				</div>
			</div>
		</div>
	);
}
