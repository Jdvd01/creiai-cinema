# Deploy en Railway

Dos servicios en el mismo proyecto Railway: **server** y **web**.

---

## Requisitos previos

- Cuenta en [Railway](https://railway.app)
- Repo en GitHub conectado a Railway
- Credenciales de LiveKit Cloud (URL, API Key, API Secret)

---

## 1. Crear el proyecto

1. Railway → **New Project** → **Deploy from GitHub repo**
2. Selecciona el repo `cinema`
3. Railway detecta el repo — **no desplegues todavía**, primero configura ambos servicios

---

## 2. Servicio: server

### Crear el servicio
1. En el proyecto → **Add Service** → **GitHub Repo** → mismo repo
2. Nombre del servicio: `server`

### Configurar el Dockerfile
Settings del servicio → **Build** → **Dockerfile Path**:
```
Dockerfile.server
```

### Variables de entorno
Settings → **Variables**:

| Variable | Valor |
|---|---|
| `LIVEKIT_URL` | `wss://tu-proyecto.livekit.cloud` |
| `LIVEKIT_API_KEY` | tu API key de LiveKit Cloud |
| `LIVEKIT_API_SECRET` | tu API secret de LiveKit Cloud |
| `CORS_ORIGIN` | URL del servicio web (ver paso 4) |

> `PORT` lo inyecta Railway automáticamente — no lo agregues.

### Generar dominio
Settings → **Networking** → **Generate Domain**  
Copia la URL generada (ej. `https://server-production-xxxx.up.railway.app`) — la necesitas para el siguiente paso.

---

## 3. Servicio: web

### Crear el servicio
1. **Add Service** → **GitHub Repo** → mismo repo
2. Nombre del servicio: `web`

### Configurar el Dockerfile
Settings → **Build** → **Dockerfile Path**:
```
Dockerfile.web
```

### Variables de entorno
Settings → **Variables**:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SERVER_URL` | URL del servicio server (del paso 2) |

### Generar dominio
Settings → **Networking** → **Generate Domain**  
Copia la URL generada (ej. `https://web-production-xxxx.up.railway.app`).

---

## 4. Cerrar el ciclo de URLs

Vuelve al servicio **server** → Variables → actualiza:

```
CORS_ORIGIN=https://web-production-xxxx.up.railway.app
```

Luego redeploy del server: Settings → **Deploy** → **Redeploy**.

---

## 5. Verificar

```bash
# Server health check
curl https://server-production-xxxx.up.railway.app/health
# → {"ok":true}

# Web
# Abre https://web-production-xxxx.up.railway.app en el browser
```

---

## 6. Extensión Chrome en producción

En `apps/extension/` actualiza la URL del server en el build:

```bash
SERVER_URL=https://server-production-xxxx.up.railway.app pnpm build:ext
```

O configura la variable en el bundler (revisa `vite.config.ts` / `webpack.config.js` — busca `__SERVER_URL__`).

---

## Variables de entorno completas — referencia

### server
```env
LIVEKIT_URL=wss://tu-proyecto.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CORS_ORIGIN=https://web-production-xxxx.up.railway.app
# PORT → Railway lo inyecta, no agregar
```

### web
```env
NEXT_PUBLIC_SERVER_URL=https://server-production-xxxx.up.railway.app
```
