import localFont from "next/font/local";

export const satoshiFont = localFont({
	src: [
		{
			path: "../../public/fonts/Satoshi-Variable.woff2",
			weight: "300 900",
			style: "normal",
		},
		{
			path: "../../public/fonts/Satoshi-VariableItalic.woff2",
			weight: "300 900",
			style: "italic",
		},
	],
	variable: "--font-satoshi",
	display: "swap",
});

export const codeFont = localFont({
	src: [
		{
			path: "../../public/fonts/CODE-Light.otf",
			weight: "300",
			style: "normal",
		},
		{
			path: "../../public/fonts/CODE-Bold.otf",
			weight: "700",
			style: "normal",
		},
	],
	variable: "--font-code",
	display: "swap",
});
