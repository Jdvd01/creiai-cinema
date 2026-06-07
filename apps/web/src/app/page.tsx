import Link from "next/link";
import { HomeForm } from "./home-form";

export default function Home() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-10 p-6">
			{/* Brand */}
			<div className="text-center">
				<h1 className="text-5xl font-bold tracking-tight">🎬 Creiai Cinema</h1>
				<p className="mt-2 text-neutral-400">
					Comparte una película con tus amigos, sincronizados.
				</p>
			</div>
			<div className="max-w-md rounded-lg border border-yellow-600/40 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
				⚠️ Funciona con video HTML5 sin DRM. Netflix, Disney+, HBO y similares
				muestran pantalla negra por protección de contenido.
			</div>
			{/* Form */}
			<HomeForm />
			{/* Extension download */}
			<div className="mt-4 max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-5 text-sm">
				<p className="font-semibold text-white">¿Quieres ser el host?</p>
				<p className="mt-1 text-neutral-400">
					Necesitas la extensión de Chrome para capturar tu pestaña.
				</p>
				<div className="mt-3 flex gap-3">
					<a
						href="https://github.com/Jdvd01/creiai-cinema/releases/download/v1.0.4/cinema-extension.zip"
						download
						className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500"
					>
						Descargar extensión
					</a>
					<Link
						href="/install"
						className="rounded border border-neutral-600 px-3 py-1.5 text-neutral-300 hover:border-neutral-400"
					>
						Cómo instalar
					</Link>
				</div>
			</div>
		</main>
	);
}
