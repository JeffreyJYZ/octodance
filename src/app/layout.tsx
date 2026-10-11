import type { Metadata } from "next";
import type { ReactNode } from "react";
import { codeFont, satoshiFont } from "@/ui/fonts";
import "./globals.css";

const DESCRIPTION =
	"Draw a creature, drop in a track, and watch every stroke dance to the beat.";

// The canonical production origin, used to make social-card URLs absolute.
// Deliberately NOT read from VERCEL_PROJECT_PRODUCTION_URL: on this project
// that resolved to the *.vercel.app host, so cards advertised the wrong domain.
const SITE_URL = "https://octodance.jyz.land";

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
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
