import { Canvas } from "@/ui/components/canvas";

export default function Home() {
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 p-8">
			<h1 className="font-display font-bold">octodance</h1>
			<Canvas />
		</main>
	);
}
