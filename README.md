# Creiai Cinema 🎬

Sala virtual para ver películas sincronizadas con amigos.

## Setup local

### Requisitos
- Node 20+, pnpm
- Docker Desktop (para LiveKit)

### 1. Instalar dependencias
```bash
pnpm install
```

### 2. Variables de entorno
```bash
cp server/.env.example server/.env
cp apps/web/.env.local.example apps/web/.env.local
```

### 3. Levantar LiveKit (SFU de video)
```bash
docker compose up -d
```
> ⚠️ WSL2: activa Docker Desktop → Settings → Resources → WSL Integration.

### 4. Correr servidor + web
```bash
pnpm dev
```
- Web: http://localhost:3000
- Server: http://localhost:3001

### 5. Cargar la extensión en Chrome
```bash
pnpm build:ext          # genera apps/extension/dist/
```
1. Abre `chrome://extensions`
2. Activa "Modo de desarrollador"
3. "Cargar descomprimida" → selecciona `apps/extension/dist/`

## Arquitectura

```
cinema/
  apps/web/          # Next.js (viewers + landing)
  apps/extension/    # Chrome MV3 (host: captura + control)
  server/            # Node + Socket.io (salas + relay)
  packages/shared/   # Tipos TS compartidos
  docker-compose.yml # LiveKit SFU
```

## Flujo

1. Host abre película en una pestaña Chrome.
2. Clic en extensión → crear sala → código generado (ej. `ABC123`).
3. Extensión captura la pestaña y publica a LiveKit (1080p + audio).
4. Amigos entran a http://localhost:3000, "Unirse" + código.
5. Ven el stream del host. Cualquiera puede pausar/reanudar/saltar.
6. Comando viaja: viewer → server → extensión → `<video>` real del host.

## Limitaciones

- Solo Chrome/Chromium (host necesita extensión).
- No funciona con Netflix, Disney+, HBO (DRM → pantalla negra).
- Pensado para grupos pequeños (2–8 personas).
