import type { Metadata } from "next";
import type { ReactNode } from "react";
import { codeFont, satoshiFont } from "@/ui/fonts";
import "./globals.css";

const DESCRIPTION =
	"Draw a creature, drop in a track, and watch every stroke dance to the beat.";

export const metadata: Metadata = {
	// Vercel exposes the production host, so social-card URLs resolve without a
	// hardcoded domain. Local dev falls back to localhost.
	metadataBase: new URL(
		process.env.VERCEL_PROJECT_PRODUCTION_URL
			? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
			: "http://localhost:3000",
	),
	title: "octodance",
	description: DESCRIPTION,
	openGraph: {
		type: "website",
		title: "octodance",
		description: DESCRIPTION,
	},
	twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html
			lang="en"
			className={`${satoshiFont.variable} ${codeFont.variable}`}
		>
			<body>{children}</body>
		</html>
	);
}
