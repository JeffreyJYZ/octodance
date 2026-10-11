import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { DEFAULT_PALETTE } from "@/lib/canvas/palette";

export const alt = "octodance — draw a creature, play a track, watch it dance";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BACKGROUND = "#0a0a0a";
const INK = "#fafafa";
const MUTED = "#a3a3a3";

// Code Pro is the app's display face and ships as OTF, which satori can read.
// (Satoshi is woff2-only here, which satori cannot.)
const loadFont = (file: string) =>
	readFile(join(process.cwd(), "public", "fonts", file));

export default async function Image() {
	const [bold, light] = await Promise.all([
		loadFont("CODE-Bold.otf"),
		loadFont("CODE-Light.otf"),
	]);

	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				backgroundColor: BACKGROUND,
				padding: "72px 80px",
				fontFamily: "CODE",
			}}
		>
			<div
				style={{
					fontSize: 148,
					fontWeight: 700,
					color: INK,
					letterSpacing: "-4px",
					lineHeight: 1,
				}}
			>
				octodance
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
				<div style={{ fontSize: 40, fontWeight: 300, color: MUTED }}>
					Draw a creature, drop in a track, watch every stroke dance.
				</div>
				<div style={{ display: "flex", gap: 18 }}>
					{DEFAULT_PALETTE.map((color) => (
						<div
							key={color}
							style={{
								width: 44,
								height: 44,
								borderRadius: 999,
								backgroundColor: color,
							}}
						/>
					))}
				</div>
			</div>
		</div>,
		{
			...size,
			fonts: [
				{ name: "CODE", data: bold, style: "normal", weight: 700 },
				{ name: "CODE", data: light, style: "normal", weight: 300 },
			],
		},
	);
}
