import Link from "next/link";

const steps = [
  {
    n: 1,
    title: "Descargar el archivo",
    body: "Descarga el archivo cinema-extension.zip haciendo clic en el botón:",
    download: "https://github.com/Jdvd01/creiai-cinema/releases/download/v1.0.1/cinema-extension.zip",
  },
  {
    n: 2,
    title: "Descomprimir el ZIP",
    body: "Windows: clic derecho → 'Extraer todo'. Mac: doble clic. Queda una carpeta cinema-extension. No la borres después, Chrome la necesita.",
    note: "Recomendado: muévela a Documentos para no perderla.",
  },
  {
    n: 3,
    title: "Abrir la página de extensiones",
    body: "Abre Chrome y escribe en la barra de direcciones:",
    code: "chrome://extensions",
  },
  {
    n: 4,
    title: "Activar Modo de desarrollador",
    body: "En la esquina superior derecha, activa el interruptor Modo de desarrollador.",
  },
  {
    n: 5,
    title: "Cargar la extensión",
    body: 'Haz clic en "Cargar descomprimida" (botón arriba a la izquierda). Selecciona la carpeta cinema-extension que descomprimiste → "Seleccionar carpeta".',
  },
  {
    n: 6,
    title: "Fijar el icono",
    body: "Haz clic en el icono de pieza de rompecabezas (🧩) a la derecha de la barra de Chrome. Busca Creiai Cinema y haz clic en el pin para que siempre sea visible.",
  },
  {
    n: 7,
    title: "¡Listo para compartir!",
    body: "Abre la película en una pestaña de Chrome (video HTML5, sin Netflix/Disney+). Haz clic en el icono de Creiai Cinema, escribe el código de sala y presiona Compartir.",
  },
];

export default function InstallPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <Link href="/" className="mb-8 inline-block text-sm text-neutral-400 hover:text-white">
        ← Volver
      </Link>

      <h1 className="mb-2 text-3xl font-bold">Cómo instalar la extensión</h1>
      <p className="mb-10 text-neutral-400">
        Solo si vas a ser host (compartir pantalla). Los que solo miran no necesitan nada.
      </p>

      <div className="flex flex-col gap-6">
        {steps.map((s) => (
          <div key={s.n} className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold text-sm">
              {s.n}
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-white">{s.title}</h2>
              <p className="mt-1 text-sm text-neutral-400">{s.body}</p>
              {s.download && (
                <a
                  href={s.download}
                  download
                  className="mt-3 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Descargar extensión
                </a>
              )}
              {s.code && (
                <code className="mt-2 block rounded bg-neutral-800 px-3 py-2 font-mono text-sm text-blue-300">
                  {s.code}
                </code>
              )}
              {s.note && (
                <p className="mt-1 text-xs text-neutral-500">{s.note}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-400">
        <p className="font-semibold text-neutral-300">Notas importantes</p>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>Solo funciona en Chrome, Edge o Brave (Chromium).</li>
          <li>Si Chrome muestra aviso sobre "extensión en modo desarrollador", es normal — ignóralo.</li>
          <li>Al actualizar: descarga el ZIP nuevo, reemplaza la carpeta y pulsa ↻ en chrome://extensions.</li>
          <li>No funciona con Netflix, Disney+, HBO ni otros servicios DRM.</li>
        </ul>
      </div>
    </main>
  );
}
