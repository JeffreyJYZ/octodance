import type { Metadata } from "next";
import type { ReactNode } from "react";
import { codeFont, satoshiFont } from "@/ui/fonts";
import "./globals.css";

export const metadata: Metadata = {
	title: "octodance",
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
